from __future__ import annotations

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from python_app.models import AppUser, AuditLog, Base
from python_app.services.auth import (
    authenticate_user,
    bootstrap_first_admin,
    change_own_password,
    create_user,
    reset_user_password,
    list_users,
    set_user_active,
    set_user_role,
)


@pytest.fixture()
def session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    db = factory()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_bootstrap_creates_one_admin_with_hashed_password(session: Session) -> None:
    admin = bootstrap_first_admin(
        session, "Primary.Admin", "مدير النظام", "Secure-Password-2026!"
    )
    assert admin.role == "admin"
    assert admin.is_active is True
    assert admin.password_hash != "Secure-Password-2026!"
    assert admin.password_hash.startswith("scrypt$")
    assert len(list_users(session)) == 1
    assert session.scalar(select(AuditLog).where(
        AuditLog.entity_type == "app_user", AuditLog.action == "bootstrap_admin"
    )) is not None
    # End the read transaction opened by the assertions before starting a new unit of work.
    session.rollback()

    with pytest.raises(ValueError, match="مسبقاً"):
        bootstrap_first_admin(
            session, "another.admin", "مدير آخر", "Secure-Password-2026!"
        )


def test_authentication_accepts_correct_password_and_rejects_wrong_password(session: Session) -> None:
    bootstrap_first_admin(session, "supervisor", "مسؤول النظام", "Secure-Password-2026!")

    user = authenticate_user(session, "SUPERVISOR", "Secure-Password-2026!")
    assert user.username == "supervisor"
    assert user.last_login_at is not None

    with pytest.raises(ValueError, match="غير صحيحة"):
        authenticate_user(session, "supervisor", "Incorrect-Password-2026")


def test_five_failed_logins_trigger_temporary_lockout(session: Session) -> None:
    bootstrap_first_admin(session, "rootuser", "مدير", "Secure-Password-2026!")

    for _ in range(4):
        with pytest.raises(ValueError, match="غير صحيحة"):
            authenticate_user(session, "rootuser", "incorrect-password")

    with pytest.raises(ValueError, match="10 دقائق"):
        authenticate_user(session, "rootuser", "incorrect-password")

    with pytest.raises(ValueError, match="مؤقتاً"):
        authenticate_user(session, "rootuser", "Secure-Password-2026!")


def test_inactive_user_cannot_sign_in(session: Session) -> None:
    admin = bootstrap_first_admin(session, "rootuser", "مدير", "Secure-Password-2026!")
    user = create_user(
        session, admin, "asset.operator", "مشغل الأصول",
        "Operator-Password-2026!", "it_manager",
    )
    set_user_active(session, admin, user.id, False)

    with pytest.raises(ValueError, match="موقوف"):
        authenticate_user(session, "asset.operator", "Operator-Password-2026!")


def test_only_active_admin_can_create_users(session: Session) -> None:
    admin = bootstrap_first_admin(session, "rootuser", "مدير", "Secure-Password-2026!")
    operator = create_user(
        session, admin, "operator", "المشغل",
        "Operator-Password-2026!", "it_manager",
    )

    with pytest.raises(PermissionError, match="مدير النظام"):
        create_user(
            session, operator, "another", "مستخدم آخر",
            "Another-Password-2026!", "it_manager",
        )


def test_stale_admin_object_cannot_create_users_after_deactivation(session: Session) -> None:
    admin = bootstrap_first_admin(session, "rootuser", "مدير أول", "Secure-Password-2026!")
    second_admin = create_user(
        session, admin, "second.admin", "مدير ثان",
        "Second-Admin-Password-2026!", "admin",
    )
    stale_admin = admin
    session.expunge(stale_admin)
    set_user_active(session, second_admin, stale_admin.id, False)

    # The detached object still carries the previously authenticated role.
    assert stale_admin.is_active is True
    assert stale_admin.role == "admin"

    with pytest.raises(PermissionError, match="مدير النظام نشط"):
        create_user(
            session, admin, "blocked.user", "حساب غير مسموح",
            "Blocked-Password-2026!", "it_manager",
        )

    assert session.scalar(select(AppUser).where(AppUser.username == "blocked.user")) is None


def test_require_active_user_rejects_disabled_account(session: Session) -> None:
    from python_app.services.auth import require_active_user

    admin = bootstrap_first_admin(session, "rootuser", "مدير النظام", "Secure-Password-2026!")
    second = create_user(
        session, admin, "second.admin", "مدير ثان",
        "Second-Admin-Password-2026!", "admin",
    )
    detached_admin = admin
    session.expunge(detached_admin)
    set_user_active(session, second, detached_admin.id, False)

    with pytest.raises(PermissionError, match="تم إيقاف هذا الحساب"):
        require_active_user(session, detached_admin)


def test_require_active_user_returns_latest_database_profile(session: Session) -> None:
    from python_app.services.auth import require_active_user

    admin = bootstrap_first_admin(session, "rootuser", "مدير النظام", "Secure-Password-2026!")
    second = create_user(
        session, admin, "second.admin", "مدير ثان",
        "Second-Admin-Password-2026!", "admin",
    )
    detached_admin = admin
    session.expunge(detached_admin)

    with session.begin():
        db_admin = session.get(AppUser, detached_admin.id)
        assert db_admin is not None
        db_admin.display_name = "المدير المحدّث"

    current = require_active_user(session, detached_admin)

    assert current.display_name == "المدير المحدّث"
    assert current.is_active is True
    session.rollback()


def test_admin_password_reset_forces_change_and_clears_lockout(session: Session) -> None:
    admin = bootstrap_first_admin(session, "rootuser", "مدير النظام", "Secure-Password-2026!")
    operator = create_user(
        session, admin, "asset.operator", "مشغل الأصول",
        "Operator-Password-2026!", "it_manager",
    )
    for _ in range(4):
        with pytest.raises(ValueError):
            authenticate_user(session, "asset.operator", "incorrect-password")
    with pytest.raises(ValueError, match="10 دقائق"):
        authenticate_user(session, "asset.operator", "incorrect-password")

    reset_user_password(
        session, admin, operator.id, "Temporary-Password-2027!"
    )

    refreshed = session.get(AppUser, operator.id)
    assert refreshed is not None
    assert refreshed.must_change_password is True
    assert refreshed.failed_login_attempts == 0
    assert refreshed.locked_until is None
    assert authenticate_user(
        session, "asset.operator", "Temporary-Password-2027!"
    ).must_change_password is True

    audit = session.scalar(select(AuditLog).where(
        AuditLog.entity_type == "app_user",
        AuditLog.entity_id == operator.id,
        AuditLog.action == "password_reset",
    ))
    assert audit is not None


def test_admin_cannot_reset_password_for_disabled_account(session: Session) -> None:
    admin = bootstrap_first_admin(session, "rootuser", "مدير النظام", "Secure-Password-2026!")
    operator = create_user(
        session, admin, "asset.operator", "مشغل الأصول",
        "Operator-Password-2026!", "it_manager",
    )
    set_user_active(session, admin, operator.id, False)

    with pytest.raises(ValueError, match="حساب موقوف"):
        reset_user_password(
            session, admin, operator.id, "Temporary-Password-2027!"
        )


def test_admin_can_change_user_role_and_audit_the_change(session: Session) -> None:
    admin = bootstrap_first_admin(session, "rootuser", "مدير النظام", "Secure-Password-2026!")
    operator = create_user(
        session, admin, "asset.operator", "مشغل الأصول",
        "Operator-Password-2026!", "it_manager",
    )

    promoted = set_user_role(session, admin, operator.id, "admin")
    assert promoted.role == "admin"
    assert session.scalar(select(AuditLog).where(
        AuditLog.entity_type == "app_user",
        AuditLog.entity_id == operator.id,
        AuditLog.action == "role_changed",
    )) is not None
    session.rollback()

    demoted = set_user_role(session, admin, operator.id, "it_manager")
    assert demoted.role == "it_manager"


def test_last_active_admin_cannot_be_demoted(session: Session) -> None:
    admin = bootstrap_first_admin(session, "rootuser", "مدير النظام", "Secure-Password-2026!")

    with pytest.raises(ValueError, match="آخر مدير نظام"):
        set_user_role(session, admin, admin.id, "it_manager")

    assert session.get(AppUser, admin.id).role == "admin"


def test_disabled_user_cannot_be_promoted_or_demoted(session: Session) -> None:
    admin = bootstrap_first_admin(session, "rootuser", "مدير النظام", "Secure-Password-2026!")
    operator = create_user(
        session, admin, "asset.operator", "مشغل الأصول",
        "Operator-Password-2026!", "it_manager",
    )
    set_user_active(session, admin, operator.id, False)

    with pytest.raises(ValueError, match="حساب موقوف"):
        set_user_role(session, admin, operator.id, "admin")


def test_last_active_admin_cannot_be_deactivated(session: Session) -> None:
    admin = bootstrap_first_admin(session, "rootuser", "مدير", "Secure-Password-2026!")

    with pytest.raises(ValueError, match="آخر حساب مدير"):
        set_user_active(session, admin, admin.id, False)

    assert session.get(AppUser, admin.id).is_active is True


def test_admin_can_deactivate_self_when_another_admin_exists(session: Session) -> None:
    admin = bootstrap_first_admin(session, "rootuser", "مدير أول", "Secure-Password-2026!")
    second = create_user(
        session, admin, "second.admin", "مدير ثان",
        "Second-Admin-Password-2026!", "admin",
    )

    set_user_active(session, admin, admin.id, False)

    assert session.get(AppUser, admin.id).is_active is False
    assert session.get(AppUser, second.id).is_active is True


def test_user_can_change_own_password(session: Session) -> None:
    admin = bootstrap_first_admin(session, "rootuser", "مدير النظام", "Secure-Password-2026!")

    change_own_password(
        session, admin.id, "Secure-Password-2026!", "New-Secure-Password-2027!"
    )

    user = authenticate_user(session, "rootuser", "New-Secure-Password-2027!")
    assert user.must_change_password is False

    with pytest.raises(ValueError, match="غير صحيحة"):
        authenticate_user(session, "rootuser", "Secure-Password-2026!")


def test_password_policy_rejects_short_password(session: Session) -> None:
    with pytest.raises(ValueError, match="12 محرفاً"):
        bootstrap_first_admin(session, "rootuser", "مدير النظام", "short")
    assert len(list_users(session)) == 0
