from __future__ import annotations

from sqlalchemy.orm import Session

from python_app.models import AppUser, Office
from python_app.services.authorization_policy import build_role_baseline_context


def _user(role: str) -> AppUser:
    return AppUser(
        username=f"{role}-user",
        display_name="مستخدم اختبار",
        password_hash="unused",
        role=role,
        is_active=True,
    )


def test_admin_baseline_is_database_scoped_to_active_offices(session: Session) -> None:
    active = Office(name="مكتب فعال", is_active=True)
    inactive = Office(name="مكتب متوقف", is_active=False)
    session.add_all([active, inactive])
    admin = _user("admin")
    session.add(admin)
    session.commit()

    context = build_role_baseline_context(session, admin)

    assert context.user.id == admin.id
    assert context.office_ids == frozenset({active.id})
    assert "assets.read" in context.permissions
    assert "assets.transfer" in context.permissions
    assert context.warehouse_ids == frozenset()


def test_non_admin_role_gets_no_implicit_permissions_or_scopes(session: Session) -> None:
    office = Office(name="مكتب")
    manager = _user("it_manager")
    session.add_all([office, manager])
    session.commit()

    context = build_role_baseline_context(session, manager)

    assert context.permissions == frozenset()
    assert context.office_ids == frozenset()
    assert context.warehouse_ids == frozenset()


def test_role_baseline_revalidates_current_user(session: Session) -> None:
    manager = _user("it_manager")
    session.add(manager)
    session.commit()
    session.expunge(manager)

    stored = session.query(AppUser).filter_by(username="it_manager-user").one()
    stored.is_active = False
    session.commit()

    try:
        build_role_baseline_context(session, manager)
    except PermissionError:
        pass
    else:
        raise AssertionError("inactive user must not receive an authorization context")
