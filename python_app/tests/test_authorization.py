from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from python_app.models import AppUser, Base
from python_app.services.authorization import (
    AuthorizationContext,
    build_authorization_context,
    require_office_scope,
    require_permission,
    require_transfer_scope,
    require_warehouse_scope,
)


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


def _context(
    *,
    permissions: frozenset[str] = frozenset({"assets.read", "assets.transfer"}),
    offices: frozenset[str] = frozenset({"office-a"}),
    warehouses: frozenset[str] = frozenset({"warehouse-a"}),
) -> AuthorizationContext:
    # Unit tests exercise the policy with a server-assembled context.
    user = AppUser(
        id="user-1",
        username="tester",
        display_name="مختبر",
        password_hash="not-used-in-policy-tests",
        role="it_manager",
        is_active=True,
    )
    return AuthorizationContext(user, permissions, offices, warehouses)


def test_missing_permission_denies_access() -> None:
    with pytest.raises(PermissionError):
        require_permission(_context(permissions=frozenset()), "assets.read")


def test_empty_or_missing_office_scope_denies_access() -> None:
    context = _context(offices=frozenset())
    with pytest.raises(PermissionError):
        require_office_scope(context, "office-a", permission="assets.read")
    with pytest.raises(PermissionError):
        require_office_scope(context, None, permission="assets.read")


def test_office_outside_scope_is_denied() -> None:
    with pytest.raises(PermissionError, match="خارج نطاق"):
        require_office_scope(_context(), "office-b", permission="assets.read")


def test_warehouse_outside_scope_is_denied() -> None:
    with pytest.raises(PermissionError, match="خارج نطاق"):
        require_warehouse_scope(_context(), "warehouse-b", permission="assets.read")


def test_transfer_requires_access_to_source_and_destination() -> None:
    context = _context()
    require_transfer_scope(context, "office-a", "office-a")
    with pytest.raises(PermissionError):
        require_transfer_scope(context, "office-b", "office-a")
    with pytest.raises(PermissionError):
        require_transfer_scope(context, "office-a", "office-b")


def test_context_reloads_active_user_from_database(session: Session) -> None:
    user = AppUser(
        username="tester",
        display_name="مختبر",
        password_hash="not-used-in-policy-tests",
        role="it_manager",
        is_active=True,
    )
    session.add(user)
    session.commit()
    detached = user
    session.expunge(detached)

    context = build_authorization_context(
        session,
        detached,
        permissions=frozenset({"assets.read"}),
        office_ids=frozenset({"office-a"}),
        warehouse_ids=frozenset(),
    )
    assert context.user.id == user.id
    assert context.user.is_active is True

    session.get(AppUser, user.id).is_active = False
    session.commit()
    with pytest.raises(PermissionError, match="تم إيقاف"):
        build_authorization_context(
            session,
            detached,
            permissions=frozenset({"assets.read"}),
            office_ids=frozenset({"office-a"}),
            warehouse_ids=frozenset(),
        )



def test_typed_permission_enum_uses_existing_permission_contract() -> None:
    from python_app.services.authorization import Permission

    context = _context()
    assert context.has_permission(Permission.ASSET_READ)
    context.require_permission(Permission.ASSET_TRANSFER)
    with pytest.raises(PermissionError):
        context.require_permission(Permission.ASSET_DELETE)


def test_context_office_helpers_reject_missing_and_out_of_scope_ids() -> None:
    from python_app.services.authorization import Permission

    context = _context()
    context.require_offices(["office-a"], permission=Permission.ASSET_READ)
    assert context.filter_offices(["office-a", "office-b"]) == ["office-a"]
    with pytest.raises(PermissionError):
        context.require_offices(["office-a", "office-b"], permission=Permission.ASSET_READ)
    with pytest.raises(PermissionError):
        context.require_office(None, permission=Permission.ASSET_READ)


def test_context_warehouse_helper_rejects_unassigned_warehouse() -> None:
    from python_app.services.authorization import Permission

    with pytest.raises(PermissionError):
        _context().require_warehouse("warehouse-b", permission=Permission.ASSET_READ)
