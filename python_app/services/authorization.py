from __future__ import annotations

from dataclasses import dataclass
from typing import FrozenSet

from sqlalchemy.orm import Session

from ..models import AppUser
from .auth import require_active_user


@dataclass(frozen=True, slots=True)
class AuthorizationContext:
    """Trusted, server-assembled authorization data for one request.

    Do not construct this object from form fields, query parameters, or other
    client-controlled values. Until persisted scope grants are implemented,
    callers must not synthesize office_ids / warehouse_ids from UI selections.
    """

    user: AppUser
    permissions: FrozenSet[str]
    office_ids: FrozenSet[str]
    warehouse_ids: FrozenSet[str]


def build_authorization_context(
    session: Session,
    actor: AppUser,
    *,
    permissions: FrozenSet[str],
    office_ids: FrozenSet[str],
    warehouse_ids: FrozenSet[str],
) -> AuthorizationContext:
    """Revalidate identity, then bind trusted grants supplied by the session layer."""
    current_user = require_active_user(session, actor)
    return AuthorizationContext(
        user=current_user,
        permissions=frozenset(permissions),
        office_ids=frozenset(office_ids),
        warehouse_ids=frozenset(warehouse_ids),
    )


def require_permission(context: AuthorizationContext, permission: str) -> None:
    if not permission or permission not in context.permissions:
        raise PermissionError("ليس لديك الإذن لتنفيذ هذه العملية.")


def require_office_scope(
    context: AuthorizationContext,
    office_id: str | None,
    *,
    permission: str,
) -> None:
    require_permission(context, permission)
    if not office_id or office_id not in context.office_ids:
        raise PermissionError("المكتب المطلوب خارج نطاق صلاحيات حسابك.")


def require_warehouse_scope(
    context: AuthorizationContext,
    warehouse_id: str | None,
    *,
    permission: str,
) -> None:
    require_permission(context, permission)
    if not warehouse_id or warehouse_id not in context.warehouse_ids:
        raise PermissionError("المستودع المطلوب خارج نطاق صلاحيات حسابك.")


def require_transfer_scope(
    context: AuthorizationContext,
    source_office_id: str | None,
    destination_office_id: str | None,
    *,
    permission: str = "assets.transfer",
) -> None:
    """A transfer requires permission and access to both ends, independently."""
    require_office_scope(context, source_office_id, permission=permission)
    require_office_scope(context, destination_office_id, permission=permission)
