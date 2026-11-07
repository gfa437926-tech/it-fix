from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import AppUser, Office
from .authorization import AuthorizationContext
from .auth import require_active_user

# Temporary, deliberately conservative baseline while per-user grants are not
# persisted. Admin access is explicit; every other role is denied by default.
_ADMIN_PERMISSIONS = frozenset({
    "assets.read",
    "assets.create",
    "assets.update",
    "assets.transfer",
    "assets.retire",
    "offices.read",
    "offices.manage",
    "custody.read",
    "custody.create",
    "custody.approve",
    "custody.reject",
    "custody.return",
    "maintenance.read",
    "maintenance.create",
    "maintenance.update",
    "spares.read",
    "spares.manage",
})


def build_role_baseline_context(session: Session, actor: AppUser) -> AuthorizationContext:
    """Build trusted grants from the current DB role, never from UI selections.

    Until office/warehouse grants are persisted and reviewed, non-admin roles
    receive no scoped permissions. Admins receive the existing system-wide
    baseline for compatibility. This function does not create or alter schema.
    """
    current_user = require_active_user(session, actor)
    if current_user.role != "admin":
        return AuthorizationContext(
            user=current_user,
            permissions=frozenset(),
            office_ids=frozenset(),
            warehouse_ids=frozenset(),
        )

    office_ids = frozenset(session.scalars(
        select(Office.id).where(Office.is_active.is_(True))
    ).all())
    return AuthorizationContext(
        user=current_user,
        permissions=_ADMIN_PERMISSIONS,
        office_ids=office_ids,
        warehouse_ids=frozenset(),
    )
