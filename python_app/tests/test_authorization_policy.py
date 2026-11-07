from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from python_app.models import AppUser, Base, Office
from python_app.services.authorization import (
    AuthorizationContext,
    require_office_scope,
    require_permission,
    require_transfer_scope,
    require_warehouse_scope,
)
from python_app.services.authorization_policy import build_role_baseline_context


@pytest.fixture()
def session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def _user(role: str, *, active: bool = True) -> AppUser:
    return AppUser(
        username=f"{role}-user",
        display_name="مستخدم اختبار",
        password_hash="unused",
        role=role,
        is_active=active,
    )


def _context(
    *,
    permissions: frozenset[str] = frozenset({"assets.read", "assets.transfer"}),
    offices: frozenset[str] = frozenset({"office-a"}),
    warehouses: frozenset[str] = frozenset({"warehouse-a"}),
) -> AuthorizationContext:
    user = _user("it_manager")
    return AuthorizationContext(user, permissions, offices, warehouses)


def test_admin_baseline_is_database_scoped_to_active_offices(session: Session) -> None:
    active = Office(name="مكتب فعال", is_active=True)
    inactive = Office(name="مكتب متوقف", is_active=False)
    admin = _user("admin")
    session.add_all([active, inactive, admin])
    session.commit()

    context = build_role_baseline_context(session, admin)

    assert context.user.id == admin.id
    assert context.office_ids == frozenset({active.id})
    assert "assets.read" in context.permissions
    assert "assets.transfer" in context.permissions
    # No warehouse grants exist yet; admin must not get fabricated warehouse IDs.
    assert context.warehouse_ids == frozenset()


def test_non_admin_role_receives_no_implicit_permissions_or_scopes(session: Session) -> None:
    # The current database CHECK constraint intentionally supports only admin/it_manager.
    # Proposed granular roles remain design-only until an approved schema migration.
    actor = _user("it_manager")
    session.add(actor)
    session.commit()

    context = build_role_baseline_context(session, actor)

    assert context.permissions == frozenset()
    assert context.office_ids == frozenset()
    assert context.warehouse_ids == frozenset()


def test_inactive_user_cannot_receive_authorization_context(session: Session) -> None:
    actor = _user("admin")
    session.add(actor)
    session.commit()
    session.expunge(actor)
    stored = session.query(AppUser).filter_by(username="admin-user").one()
    stored.is_active = False
    session.commit()

    with pytest.raises(PermissionError):
        build_role_baseline_context(session, actor)


def test_missing_permission_is_denied() -> None:
    with pytest.raises(PermissionError):
        require_permission(_context(permissions=frozenset()), "assets.read")


def test_unknown_permission_is_denied() -> None:
    with pytest.raises(PermissionError):
        require_permission(_context(), "system.root")


def test_office_outside_scope_is_denied() -> None:
    with pytest.raises(PermissionError, match="خارج نطاق"):
        require_office_scope(_context(), "office-b", permission="assets.read")


def test_missing_office_scope_is_denied() -> None:
    with pytest.raises(PermissionError):
        require_office_scope(_context(offices=frozenset()), "office-a", permission="assets.read")


def test_warehouse_outside_scope_is_denied() -> None:
    with pytest.raises(PermissionError, match="خارج نطاق"):
        require_warehouse_scope(_context(), "warehouse-b", permission="assets.read")


def test_missing_warehouse_scope_is_denied() -> None:
    with pytest.raises(PermissionError):
        require_warehouse_scope(_context(warehouses=frozenset()), "warehouse-a", permission="assets.read")


def test_transfer_requires_permission_and_both_office_scopes() -> None:
    context = _context()
    require_transfer_scope(context, "office-a", "office-a")
    with pytest.raises(PermissionError):
        require_transfer_scope(context, "office-b", "office-a")
    with pytest.raises(PermissionError):
        require_transfer_scope(context, "office-a", "office-b")
    with pytest.raises(PermissionError):
        require_transfer_scope(_context(permissions=frozenset({"assets.read"})), "office-a", "office-a")
