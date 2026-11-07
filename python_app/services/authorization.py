from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import FrozenSet, Iterable

from sqlalchemy.orm import Session

from ..models import AppUser
from .auth import require_active_user


class Permission(str, Enum):
    """Stable permission identifiers; values preserve the existing service API."""

    ASSET_READ = "assets.read"
    ASSET_CREATE = "assets.create"
    ASSET_UPDATE = "assets.update"
    ASSET_DELETE = "assets.delete"
    ASSET_TRANSFER = "assets.transfer"
    ASSET_RETIRE = "assets.retire"
    OFFICE_READ = "offices.read"
    OFFICE_MANAGE = "offices.manage"
    CUSTODY_READ = "custody.read"
    CUSTODY_CREATE = "custody.create"
    CUSTODY_APPROVE = "custody.approve"
    CUSTODY_REJECT = "custody.reject"
    CUSTODY_RETURN = "custody.return"
    MAINTENANCE_READ = "maintenance.read"
    MAINTENANCE_CREATE = "maintenance.create"
    MAINTENANCE_UPDATE = "maintenance.update"
    SPARE_READ = "spares.read"
    SPARE_MANAGE = "spares.manage"
    SPARE_CONSUME = "spares.consume"
    PURCHASE_READ = "purchases.read"
    PURCHASE_CREATE = "purchases.create"
    PURCHASE_UPDATE = "purchases.update"
    ATTACHMENT_READ = "attachments.read"
    ATTACHMENT_UPLOAD = "attachments.upload"
    ATTACHMENT_DELETE = "attachments.delete"
    REPORT_VIEW = "reports.view"
    REPORT_EXPORT = "reports.export"
    AUDIT_VIEW = "audit.view"
    USER_MANAGE = "users.manage"
    WAREHOUSE_MANAGE = "warehouses.manage"
    BACKUP = "system.backup"
    SYSTEM_SETTINGS = "system.settings"


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

    def has_permission(self, permission: str | Permission) -> bool:
        # Never authorize work for a disabled account, even through a stale context.
        if not self.user.is_active:
            return False
        value = permission.value if isinstance(permission, Permission) else permission
        return bool(value) and value in self.permissions

    def require_permission(self, permission: str | Permission) -> None:
        require_permission(self, permission.value if isinstance(permission, Permission) else permission)

    def require_office(self, office_id: str | None, *, permission: str | Permission) -> None:
        require_office_scope(
            self, office_id,
            permission=permission.value if isinstance(permission, Permission) else permission,
        )

    def require_warehouse(self, warehouse_id: str | None, *, permission: str | Permission) -> None:
        require_warehouse_scope(
            self, warehouse_id,
            permission=permission.value if isinstance(permission, Permission) else permission,
        )

    def require_offices(
        self, office_ids: Iterable[str | None], *, permission: str | Permission
    ) -> None:
        for office_id in office_ids:
            self.require_office(office_id, permission=permission)

    def filter_offices(self, office_ids: Iterable[str]) -> list[str]:
        """Return only IDs in the trusted scope; never infer scope from UI state."""
        if not self.user.is_active:
            return []
        allowed = self.office_ids
        return [office_id for office_id in office_ids if office_id in allowed]


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
    if not context.has_permission(permission):
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
