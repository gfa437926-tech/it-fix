from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import AppUser, AuditLog, utc_now

_SCRYPT_N = 1 << 14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SALT_BYTES = 16
_KEY_BYTES = 32
_USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$")
_DUMMY_SALT = bytes.fromhex("9f86d081884c7d659a2feaa0c55ad015")
_DUMMY_KEY = hashlib.scrypt(
    b"not-a-real-user-password",
    salt=_DUMMY_SALT,
    n=_SCRYPT_N,
    r=_SCRYPT_R,
    p=_SCRYPT_P,
    dklen=_KEY_BYTES,
    maxmem=64 * 1024 * 1024,
)


def _password_hash(password: str) -> str:
    salt = secrets.token_bytes(_SALT_BYTES)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_KEY_BYTES,
        maxmem=64 * 1024 * 1024,
    )
    return (
        "scrypt$" + str(_SCRYPT_N) + "$" + str(_SCRYPT_R) + "$"
        + str(_SCRYPT_P) + "$" + salt.hex() + "$" + derived.hex()
    )


def _dummy_encoded() -> str:
    return (
        "scrypt$" + str(_SCRYPT_N) + "$" + str(_SCRYPT_R) + "$"
        + str(_SCRYPT_P) + "$" + _DUMMY_SALT.hex() + "$" + _DUMMY_KEY.hex()
    )


def _verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, n_text, r_text, p_text, salt_text, key_text = encoded.split("$", 5)
        n, r, p = int(n_text), int(r_text), int(p_text)
        if algorithm != "scrypt" or n != _SCRYPT_N or r != _SCRYPT_R or p != _SCRYPT_P:
            return False
        salt = bytes.fromhex(salt_text)
        expected = bytes.fromhex(key_text)
        if len(salt) != _SALT_BYTES or len(expected) != _KEY_BYTES:
            return False
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=n,
            r=r,
            p=p,
            dklen=len(expected),
            maxmem=64 * 1024 * 1024,
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def validate_username(username: str) -> str:
    normalized = username.strip().lower()
    if not _USERNAME_PATTERN.fullmatch(normalized):
        raise ValueError("اسم الدخول يجب أن يكون 3–64 محرفاً إنجليزياً، ويقبل النقطة والشرطة والشرطة السفلية.")
    return normalized


def validate_password(password: str) -> None:
    if len(password) < 12:
        raise ValueError("كلمة المرور يجب ألا تقل عن 12 محرفاً.")
    if len(password) > 256:
        raise ValueError("كلمة المرور أطول من الحد المسموح.")


def count_users(session: Session) -> int:
    return int(session.scalar(select(func.count()).select_from(AppUser)) or 0)


def bootstrap_first_admin(
    session: Session,
    username: str,
    display_name: str,
    password: str,
) -> AppUser:
    username = validate_username(username)
    display_name = display_name.strip()
    validate_password(password)
    if not display_name or len(display_name) > 160:
        raise ValueError("الاسم الظاهر مطلوب ولا يجوز أن يتجاوز 160 محرفاً.")

    try:
        with session.begin():
            if count_users(session) != 0:
                raise ValueError("تم إعداد حساب النظام مسبقاً؛ لا يمكن إنشاء مدير أول جديد.")
            user = AppUser(
                username=username,
                display_name=display_name,
                password_hash=_password_hash(password),
                role="admin",
                is_active=True,
                must_change_password=False,
            )
            session.add(user)
            session.flush()
            session.add(AuditLog(
                entity_type="app_user",
                entity_id=user.id,
                action="bootstrap_admin",
                actor_name=display_name,
                details="إنشاء حساب مدير النظام الأول.",
            ))
            session.flush()
        return user
    except IntegrityError as exc:
        session.rollback()
        raise ValueError("اسم الدخول مستخدم مسبقاً.") from exc


def authenticate_user(session: Session, username: str, password: str) -> AppUser:
    normalized = (username or "").strip().lower()
    if not password or len(password) > 256:
        _verify_password("invalid-placeholder", _dummy_encoded())
        raise ValueError("اسم المستخدم أو كلمة المرور غير صحيحة.")

    failure_message: str | None = None
    authenticated: AppUser | None = None
    now = utc_now()

    with session.begin():
        user = session.scalar(select(AppUser).where(AppUser.username == normalized).limit(1))
        if user is None:
            _verify_password(password, _dummy_encoded())
            failure_message = "اسم المستخدم أو كلمة المرور غير صحيحة."
        else:
            valid_password = _verify_password(password, user.password_hash)
            if not user.is_active:
                failure_message = "هذا الحساب موقوف. راجع مدير النظام."
            elif user.locked_until is not None:
                locked_until = user.locked_until
                if locked_until.tzinfo is None:
                    locked_until = locked_until.replace(tzinfo=timezone.utc)
                if locked_until > now:
                    remaining = max(1, int((locked_until - now).total_seconds() // 60) + 1)
                    failure_message = "تم تعليق تسجيل الدخول مؤقتاً. حاول بعد " + str(remaining) + " دقيقة."
                else:
                    user.locked_until = None

            if failure_message is None and not valid_password:
                user.failed_login_attempts += 1
                if user.failed_login_attempts >= 5:
                    user.failed_login_attempts = 0
                    user.locked_until = now + timedelta(minutes=10)
                    failure_message = "تم تعليق تسجيل الدخول 10 دقائق بعد خمس محاولات فاشلة."
                else:
                    failure_message = "اسم المستخدم أو كلمة المرور غير صحيحة."
            elif failure_message is None:
                user.failed_login_attempts = 0
                user.locked_until = None
                user.last_login_at = now
                authenticated = user

    if failure_message is not None:
        raise ValueError(failure_message)
    if authenticated is None:
        raise ValueError("تعذر إنشاء جلسة المستخدم.")
    return authenticated


def list_users(session: Session) -> list[AppUser]:
    return list(session.scalars(
        select(AppUser).order_by(AppUser.role, AppUser.display_name)
    ).all())


def _require_active_admin(session: Session, actor: AppUser) -> AppUser:
    # Do not trust the role/active flags on a possibly stale ORM instance.
    current_actor = session.scalar(
        select(AppUser)
        .where(AppUser.id == actor.id)
        .execution_options(populate_existing=True)
    )
    if current_actor is None or not current_actor.is_active or current_actor.role != "admin":
        raise PermissionError("هذه العملية تتطلب حساب مدير النظام نشطاً.")
    return current_actor


def require_active_user(session: Session, actor: AppUser) -> AppUser:
    """Re-read a session user from the database before trusting the session."""
    current_actor = session.scalar(
        select(AppUser)
        .where(AppUser.id == actor.id)
        .execution_options(populate_existing=True)
    )
    if current_actor is None or not current_actor.is_active:
        raise PermissionError("تم إيقاف هذا الحساب أو حذفه. سجّل الدخول بحساب نشط.")
    return current_actor


def require_active_admin(session: Session, actor: AppUser) -> AppUser:
    """Return the current database-backed admin record or reject stale sessions."""
    return _require_active_admin(session, actor)


def create_user(
    session: Session,
    actor: AppUser,
    username: str,
    display_name: str,
    password: str,
    role: str = "it_manager",
) -> AppUser:
    username = validate_username(username)
    display_name = display_name.strip()
    validate_password(password)
    if not display_name or len(display_name) > 160:
        raise ValueError("الاسم الظاهر مطلوب.")
    if role not in {"admin", "it_manager"}:
        raise ValueError("الدور المحدد غير معروف.")

    try:
        with session.begin():
            actor = _require_active_admin(session, actor)
            user = AppUser(
                username=username,
                display_name=display_name,
                password_hash=_password_hash(password),
                role=role,
                is_active=True,
                must_change_password=True,
            )
            session.add(user)
            session.flush()
            session.add(AuditLog(
                entity_type="app_user",
                entity_id=user.id,
                action="created",
                actor_name=actor.display_name,
                details="إنشاء حساب " + username + " بدور " + role + ".",
            ))
            session.flush()
        return user
    except IntegrityError as exc:
        session.rollback()
        raise ValueError("اسم الدخول مستخدم مسبقاً.") from exc


def set_user_active(
    session: Session,
    actor: AppUser,
    target_user_id: str,
    is_active: bool,
) -> AppUser:
    with session.begin():
        actor = _require_active_admin(session, actor)
        user = session.get(AppUser, target_user_id)
        if user is None:
            raise ValueError("الحساب المطلوب غير موجود.")
        if not is_active and user.role == "admin" and user.is_active:
            other_admins = session.scalar(
                select(func.count()).select_from(AppUser).where(
                    AppUser.role == "admin",
                    AppUser.is_active.is_(True),
                    AppUser.id != user.id,
                )
            ) or 0
            if other_admins == 0:
                raise ValueError("لا يمكن إيقاف آخر حساب مدير نشط.")
        user.is_active = is_active
        if not is_active:
            user.locked_until = None
        session.add(AuditLog(
            entity_type="app_user",
            entity_id=user.id,
            action="activated" if is_active else "deactivated",
            actor_name=actor.display_name,
            details="تغيير حالة حساب " + user.username + ".",
        ))
        session.flush()
    return user


def reset_user_password(
    session: Session,
    actor: AppUser,
    target_user_id: str,
    temporary_password: str,
) -> AppUser:
    """Admin-only reset; the affected user must change it at next sign-in."""
    validate_password(temporary_password)
    with session.begin():
        current_actor = _require_active_admin(session, actor)
        user = session.get(AppUser, target_user_id)
        if user is None:
            raise ValueError("الحساب المطلوب غير موجود.")
        if not user.is_active:
            raise ValueError("لا يمكن تعيين كلمة مرور لحساب موقوف؛ فعّل الحساب أولاً.")
        if user.id == current_actor.id:
            raise ValueError("استخدم شاشة تغيير كلمة المرور لحسابك الشخصي.")
        user.password_hash = _password_hash(temporary_password)
        user.must_change_password = True
        user.failed_login_attempts = 0
        user.locked_until = None
        user.updated_at = utc_now()
        session.add(AuditLog(
            entity_type="app_user",
            entity_id=user.id,
            action="password_reset",
            actor_name=current_actor.display_name,
            details="إعادة تعيين كلمة المرور للحساب " + user.username
            + " مع فرض تغييرها عند تسجيل الدخول التالي.",
        ))
        session.flush()
    return user


def change_own_password(
    session: Session,
    user_id: str,
    current_password: str,
    new_password: str,
) -> None:
    validate_password(new_password)
    with session.begin():
        user = session.get(AppUser, user_id)
        if user is None or not user.is_active:
            raise ValueError("الحساب غير متاح.")
        if not _verify_password(current_password, user.password_hash):
            raise ValueError("كلمة المرور الحالية غير صحيحة.")
        if _verify_password(new_password, user.password_hash):
            raise ValueError("اختر كلمة مرور جديدة تختلف عن الحالية.")
        user.password_hash = _password_hash(new_password)
        user.must_change_password = False
        user.updated_at = utc_now()
        session.add(AuditLog(
            entity_type="app_user",
            entity_id=user.id,
            action="password_changed",
            actor_name=user.display_name,
            details="تغيير كلمة مرور الحساب.",
        ))
        session.flush()
