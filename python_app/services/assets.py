from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from ..models import Asset, AssetMovement, AuditLog, Office, utc_now
from .authorization import AuthorizationContext, require_permission

ASSET_CATEGORIES = {
    "desktop", "laptop", "monitor", "printer", "scanner",
    "network", "storage", "ups", "accessory", "other",
}
ASSET_STATUSES = {"available", "assigned", "maintenance", "damaged", "retired", "returned"}


@dataclass(frozen=True, slots=True)
class AssetInput:
    category: str
    brand: str
    model: str
    serial_number: str = ""
    status: str = "available"
    cpu: str = ""
    ram: str = ""
    storage: str = ""
    office_name: str = ""
    office_id: str | None = None


@dataclass(frozen=True, slots=True)
class DashboardSummary:
    total_assets: int
    available: int
    assigned: int
    maintenance: int
    damaged: int
    retired: int
    active_offices: int


def normalize_serial(value: str | None) -> tuple[str | None, str | None]:
    serial = (value or "").strip().upper()
    return (serial or None, serial or None)


def validate_asset(data: AssetInput) -> AssetInput:
    category = data.category.strip().lower()
    status = data.status.strip().lower()
    brand = data.brand.strip()
    model = data.model.strip()
    if category not in ASSET_CATEGORIES:
        raise ValueError("فئة الأصل غير معروفة.")
    if status not in ASSET_STATUSES:
        raise ValueError("حالة الأصل غير معروفة.")
    if not brand or not model:
        raise ValueError("الشركة المصنعة والطراز حقول إلزامية.")
    if len(brand) > 120 or len(model) > 160:
        raise ValueError("اسم الشركة أو الطراز أطول من الحد المسموح.")
    if len((data.serial_number or "").strip()) > 160:
        raise ValueError("الرقم التسلسلي أطول من الحد المسموح.")
    return AssetInput(
        category=category,
        brand=brand,
        model=model,
        serial_number=(data.serial_number or "").strip(),
        status=status,
        cpu=(data.cpu or "").strip(),
        ram=(data.ram or "").strip(),
        storage=(data.storage or "").strip(),
        office_name=(data.office_name or "").strip(),
        office_id=data.office_id,
    )


def _find_office(session: Session, office_id: str | None, office_name: str | None) -> Office | None:
    if office_id:
        office = session.get(Office, office_id)
        if office is None or not office.is_active:
            raise ValueError("المكتب المحدد غير موجود أو غير فعال.")
        return office
    if office_name:
        return session.scalar(
            select(Office).where(Office.name == office_name, Office.is_active.is_(True)).limit(1)
        )
    return None


def _record_movement(
    session: Session,
    asset: Asset,
    movement_type: str,
    actor_name: str,
    notes: str,
    *,
    from_office: Office | None = None,
    to_office: Office | None = None,
) -> None:
    session.add(AssetMovement(
        asset_id=asset.id,
        asset_label=f"{asset.brand} {asset.model}".strip(),
        movement_type=movement_type,
        occurred_at=utc_now(),
        from_office_id=from_office.id if from_office else None,
        from_office_name=from_office.name if from_office else None,
        to_office_id=to_office.id if to_office else None,
        to_office_name=to_office.name if to_office else asset.office_name,
        notes=(notes or f"بواسطة {actor_name or 'المسؤول'}").strip(),
    ))


def list_assets(session: Session, search: str = "", status: str = "all") -> list[Asset]:
    query = select(Asset).options(joinedload(Asset.office)).order_by(Asset.brand, Asset.model)
    term = search.strip()
    if term:
        pattern = f"%{term}%"
        query = query.where(or_(
            Asset.brand.ilike(pattern),
            Asset.model.ilike(pattern),
            Asset.serial_number.ilike(pattern),
            Asset.office_name.ilike(pattern),
        ))
    if status != "all":
        query = query.where(Asset.status == status)
    return list(session.scalars(query).unique().all())


def list_assets_for_scope(
    session: Session,
    context: AuthorizationContext,
    search: str = "",
    status: str = "all",
) -> list[Asset]:
    """List only assets assigned to offices in a trusted authorization context.

    Assets without an office are intentionally excluded: until warehouse
    grants are persisted, a UI selection must not be used to infer warehouse
    access or expose unassigned inventory.
    """
    require_permission(context, "assets.read")
    if not context.office_ids:
        raise PermissionError("لا توجد مكاتب مسموح بها لهذا الحساب.")

    query = (
        select(Asset)
        .options(joinedload(Asset.office))
        .where(Asset.office_id.in_(context.office_ids))
        .order_by(Asset.brand, Asset.model)
    )
    term = (search or "").strip()
    if term:
        pattern = f"%{term}%"
        query = query.where(or_(
            Asset.brand.ilike(pattern),
            Asset.model.ilike(pattern),
            Asset.serial_number.ilike(pattern),
            Asset.office_name.ilike(pattern),
        ))
    if status != "all":
        query = query.where(Asset.status == status)
    return list(session.scalars(query).unique().all())


def create_asset(session: Session, data: AssetInput, actor_name: str = "المسؤول") -> Asset:
    cleaned = validate_asset(data)
    serial, serial_key = normalize_serial(cleaned.serial_number)
    try:
        with session.begin():
            office = _find_office(session, cleaned.office_id, cleaned.office_name)
            if serial_key and session.scalar(
                select(Asset.id).where(Asset.serial_key == serial_key).limit(1)
            ):
                raise ValueError(f"الرقم التسلسلي ({serial}) مسجل مسبقاً.")

            asset = Asset(
                category=cleaned.category,
                brand=cleaned.brand,
                model=cleaned.model,
                serial_number=serial,
                serial_key=serial_key,
                status=cleaned.status,
                cpu=cleaned.cpu or None,
                ram=cleaned.ram or None,
                storage=cleaned.storage or None,
                office_id=office.id if office else None,
                office_name=office.name if office else (cleaned.office_name or "المستودع الرئيسي"),
            )
            session.add(asset)
            session.flush()
            _record_movement(session, asset, "registered", actor_name, "تسجيل أصل جديد في المستودع.")
            session.add(AuditLog(
                entity_type="asset", entity_id=asset.id, action="created",
                actor_name=actor_name or "المسؤول",
                details=f"إضافة {asset.brand} {asset.model} — الرقم التسلسلي: {serial or 'غير مسجل'}",
            ))
            session.flush()
        return asset
    except IntegrityError as exc:
        session.rollback()
        raise ValueError("تعذر إضافة الأصل: الرقم التسلسلي أو المعرّف مستخدم مسبقاً.") from exc


def update_asset(session: Session, asset_id: str, data: AssetInput, actor_name: str = "المسؤول") -> Asset:
    cleaned = validate_asset(data)
    serial, serial_key = normalize_serial(cleaned.serial_number)
    try:
        with session.begin():
            office = _find_office(session, cleaned.office_id, cleaned.office_name)
            asset = session.get(Asset, asset_id)
            if asset is None:
                raise ValueError("الأصل المطلوب تعديله غير موجود.")
            if cleaned.status != asset.status:
                raise ValueError(
                    "تغيير حالة الأصل يتم حصراً عبر إجراءات العهدة والصيانة والإرجاع والاستبعاد."
                )
            if serial_key and session.scalar(
                select(Asset.id).where(Asset.serial_key == serial_key, Asset.id != asset_id).limit(1)
            ):
                raise ValueError(f"الرقم التسلسلي ({serial}) مسجل لأصل آخر.")

            old_office = session.get(Office, asset.office_id) if asset.office_id else None
            old_status = asset.status
            asset.category = cleaned.category
            asset.brand = cleaned.brand
            asset.model = cleaned.model
            asset.serial_number = serial
            asset.serial_key = serial_key
            asset.status = cleaned.status
            asset.cpu = cleaned.cpu or None
            asset.ram = cleaned.ram or None
            asset.storage = cleaned.storage or None
            asset.office_id = office.id if office else None
            asset.office_name = office.name if office else (cleaned.office_name or "المستودع الرئيسي")
            old_office_id = old_office.id if old_office else None
            new_office_id = office.id if office else None
            if old_office_id != new_office_id:
                asset.transferred_at = utc_now()
                _record_movement(
                    session, asset, "transferred", actor_name, "تغيير موقع الأصل من بطاقة الأصل.",
                    from_office=old_office, to_office=office,
                )
            session.add(AuditLog(
                entity_type="asset", entity_id=asset.id, action="updated",
                actor_name=actor_name or "المسؤول",
                details=f"تحديث الأصل؛ الحالة السابقة: {old_status}، الحالة الجديدة: {asset.status}",
            ))
            session.flush()
        return asset
    except IntegrityError as exc:
        session.rollback()
        raise ValueError("تعذر حفظ التعديلات بسبب تعارض في الرقم التسلسلي.") from exc


def transfer_asset(
    session: Session, asset_id: str, destination_office_id: str,
    notes: str = "", actor_name: str = "المسؤول",
) -> Asset:
    with session.begin():
        asset = session.get(Asset, asset_id)
        destination = session.get(Office, destination_office_id)
        if asset is None:
            raise ValueError("الأصل غير موجود.")
        if destination is None or not destination.is_active:
            raise ValueError("المكتب الوجهة غير موجود أو غير فعال.")
        if asset.status not in {"available", "returned"}:
            raise ValueError("لا يمكن نقل الأصل إلا إذا كان متاحاً أو معاداً للمستودع.")
        if asset.office_id == destination.id:
            raise ValueError("الأصل موجود بالفعل في هذا المكتب.")
        previous = session.get(Office, asset.office_id) if asset.office_id else None
        asset.office_id = destination.id
        asset.office_name = destination.name
        asset.transferred_at = utc_now()
        _record_movement(
            session, asset, "transferred", actor_name,
            notes.strip() or f"نقل الأصل بواسطة {actor_name or 'المسؤول'}.",
            from_office=previous, to_office=destination,
        )
        session.add(AuditLog(
            entity_type="asset", entity_id=asset.id, action="transferred",
            actor_name=actor_name or "المسؤول",
            details=f"نقل الأصل إلى المكتب: {destination.name}",
        ))
        session.flush()
    return asset


def retire_asset(session: Session, asset_id: str, reason: str, actor_name: str = "المسؤول") -> Asset:
    reason = reason.strip()
    if not reason:
        raise ValueError("يجب إدخال سبب الاستبعاد.")
    with session.begin():
        asset = session.get(Asset, asset_id)
        if asset is None:
            raise ValueError("الأصل غير موجود.")
        if asset.status == "retired":
            raise ValueError("الأصل مستبعد مسبقاً.")
        if asset.status in {"assigned", "maintenance"}:
            raise ValueError("يجب إغلاق العهدة أو الصيانة قبل استبعاد الأصل.")
        asset.status = "retired"
        asset.retired_at = utc_now()
        asset.retirement_reason = reason
        _record_movement(session, asset, "retired", actor_name, f"سبب الاستبعاد: {reason}")
        session.add(AuditLog(
            entity_type="asset", entity_id=asset.id, action="retired",
            actor_name=actor_name or "المسؤول", details=reason,
        ))
        session.flush()
    return asset



def create_asset_for_scope(
    session: Session,
    context: AuthorizationContext,
    data: AssetInput,
) -> Asset:
    """Create an asset only inside an explicitly granted office."""
    require_permission(context, "assets.create")
    cleaned = validate_asset(data)
    if not cleaned.office_id:
        raise PermissionError("يجب تحديد مكتب مصرح به لتسجيل الأصل.")
    require_permission(context, "assets.create")
    if cleaned.office_id not in context.office_ids:
        raise PermissionError("لا يمكن تسجيل الأصل خارج نطاق مكاتب حسابك.")
    return create_asset(session, cleaned, actor_name=context.user.display_name)


def update_asset_for_scope(
    session: Session,
    context: AuthorizationContext,
    asset_id: str,
    data: AssetInput,
) -> Asset:
    """Update an asset only when both its current and target offices are allowed."""
    asset = session.get(Asset, asset_id)
    if asset is None:
        raise ValueError("الأصل المطلوب تعديله غير موجود.")
    if asset.office_id not in context.office_ids:
        raise PermissionError("الأصل الحالي خارج نطاق مكاتب حسابك.")
    cleaned = validate_asset(data)
    if cleaned.office_id != asset.office_id:
        from .authorization import require_transfer_scope
        require_transfer_scope(
            context, asset.office_id, cleaned.office_id,
            permission="assets.transfer",
        )
    else:
        require_permission(context, "assets.update")
    if not cleaned.office_id:
        raise PermissionError("لا يمكن نقل الأصل إلى موقع غير محدد.")
    return update_asset(session, asset_id, cleaned, actor_name=context.user.display_name)


def transfer_asset_for_scope(
    session: Session,
    context: AuthorizationContext,
    asset_id: str,
    destination_office_id: str,
    notes: str = "",
) -> Asset:
    asset = session.get(Asset, asset_id)
    if asset is None:
        raise ValueError("الأصل غير موجود.")
    from .authorization import require_transfer_scope
    require_transfer_scope(
        context, asset.office_id, destination_office_id,
        permission="assets.transfer",
    )
    return transfer_asset(
        session, asset_id, destination_office_id, notes,
        actor_name=context.user.display_name,
    )


def retire_asset_for_scope(
    session: Session,
    context: AuthorizationContext,
    asset_id: str,
    reason: str,
) -> Asset:
    asset = session.get(Asset, asset_id)
    if asset is None:
        raise ValueError("الأصل غير موجود.")
    require_permission(context, "assets.retire")
    if asset.office_id not in context.office_ids:
        raise PermissionError("الأصل خارج نطاق مكاتب حسابك.")
    return retire_asset(session, asset_id, reason, actor_name=context.user.display_name)


def create_office(
    session: Session, name: str, building: str = "", department: str = "",
    room: str = "", manager: str = "", actor_name: str = "المسؤول",
) -> Office:
    name = name.strip()
    if not name:
        raise ValueError("اسم المكتب مطلوب.")
    if len(name) > 180 or len(building) > 120 or len(room) > 80:
        raise ValueError("بيانات الموقع تتجاوز الحدود المسموح بها.")
    try:
        with session.begin():
            duplicate = session.scalar(select(Office.id).where(
                Office.name == name,
                Office.building == (building.strip() or None),
                Office.room == (room.strip() or None),
            ).limit(1))
            if duplicate:
                raise ValueError("المكتب أو الموقع مسجل مسبقاً.")
            office = Office(
                name=name,
                building=building.strip() or None,
                department=department.strip() or None,
                room=room.strip() or None,
                manager=manager.strip() or None,
                is_active=True,
            )
            session.add(office)
            session.flush()
            session.add(AuditLog(
                entity_type="office", entity_id=office.id, action="created",
                actor_name=actor_name or "المسؤول", details=f"إنشاء مكتب: {name}",
            ))
            session.flush()
        return office
    except IntegrityError as exc:
        session.rollback()
        raise ValueError("تعذر إنشاء المكتب بسبب تكرار بيانات الموقع.") from exc


def update_office(
    session: Session,
    office_id: str,
    name: str,
    building: str = "",
    department: str = "",
    room: str = "",
    manager: str = "",
    actor_name: str = "المسؤول",
) -> Office:
    values = {
        "name": name.strip(),
        "building": building.strip() or None,
        "department": department.strip() or None,
        "room": room.strip() or None,
        "manager": manager.strip() or None,
    }
    if not values["name"]:
        raise ValueError("اسم المكتب مطلوب.")
    limits = {
        "name": 180, "building": 120, "department": 160,
        "room": 80, "manager": 160,
    }
    if any(value is not None and len(value) > limits[key] for key, value in values.items()):
        raise ValueError("أحد حقول المكتب يتجاوز الحد المسموح.")

    try:
        with session.begin():
            office = session.get(Office, office_id)
            if office is None:
                raise ValueError("المكتب المطلوب تعديله غير موجود.")
            duplicate = session.scalar(
                select(Office.id).where(
                    Office.id != office_id,
                    Office.name == values["name"],
                    Office.building == values["building"],
                    Office.room == values["room"],
                ).limit(1)
            )
            if duplicate:
                raise ValueError("اسم المكتب وموقعه مسجلان مسبقاً.")
            office.name = values["name"]
            office.building = values["building"]
            office.department = values["department"]
            office.room = values["room"]
            office.manager = values["manager"]
            office.updated_at = utc_now()
            session.add(AuditLog(
                entity_type="office",
                entity_id=office.id,
                action="updated",
                actor_name=actor_name or "المسؤول",
                details=f"تعديل بيانات المكتب: {office.name}",
            ))
            session.flush()
        return office
    except IntegrityError as exc:
        session.rollback()
        raise ValueError("تعذر تعديل المكتب بسبب تعارض في بيانات الموقع.") from exc


def set_office_active(
    session: Session,
    office_id: str,
    is_active: bool,
    actor_name: str = "المسؤول",
) -> Office:
    with session.begin():
        office = session.get(Office, office_id)
        if office is None:
            raise ValueError("المكتب المطلوب غير موجود.")
        if not is_active and office.is_active:
            assigned_count = session.scalar(
                select(func.count()).select_from(Asset).where(
                    Asset.office_id == office.id,
                    Asset.status != "retired",
                )
            ) or 0
            if assigned_count:
                raise ValueError(
                    "لا يمكن إيقاف المكتب قبل نقل جميع الأصول غير المستبعدة إلى مواقع أخرى."
                )
        office.is_active = is_active
        office.updated_at = utc_now()
        session.add(AuditLog(
            entity_type="office",
            entity_id=office.id,
            action="activated" if is_active else "deactivated",
            actor_name=actor_name or "المسؤول",
            details=f"تغيير حالة المكتب {office.name}.",
        ))
        session.flush()
    return office


def list_offices(session: Session, active_only: bool = False) -> list[Office]:
    query = select(Office).order_by(Office.name)
    if active_only:
        query = query.where(Office.is_active.is_(True))
    return list(session.scalars(query).all())


def get_dashboard_summary(session: Session) -> DashboardSummary:
    total = session.scalar(select(func.count()).select_from(Asset)) or 0
    counts = {
        status: session.scalar(select(func.count()).select_from(Asset).where(Asset.status == status)) or 0
        for status in ASSET_STATUSES
    }
    offices = session.scalar(select(func.count()).select_from(Office).where(Office.is_active.is_(True))) or 0
    return DashboardSummary(
        total_assets=total,
        available=counts["available"] + counts["returned"],
        assigned=counts["assigned"],
        maintenance=counts["maintenance"],
        damaged=counts["damaged"],
        retired=counts["retired"],
        active_offices=offices,
    )


def list_recent_movements(session: Session, limit: int = 100) -> list[AssetMovement]:
    safe_limit = max(1, min(int(limit), 500))
    return list(session.scalars(
        select(AssetMovement).order_by(AssetMovement.occurred_at.desc()).limit(safe_limit)
    ).all())
