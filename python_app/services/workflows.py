from __future__ import annotations

from dataclasses import dataclass
import math
from datetime import datetime
from typing import Iterable

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..models import (
    Asset,
    AssetMovement,
    AuditLog,
    CustodyCard,
    CustodyItem,
    MaintenancePartUsage,
    MaintenanceRecord,
    SparePart,
    utc_now,
)


@dataclass(frozen=True, slots=True)
class CustodyItemInput:
    item_name: str
    quantity: float = 1
    unit: str = "جهاز"
    item_description: str = ""
    item_code: str = ""
    notes: str = ""
    asset_id: str | None = None


def _audit(
    session: Session,
    entity_type: str,
    entity_id: str,
    action: str,
    actor_name: str,
    details: str,
) -> None:
    session.add(AuditLog(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        actor_name=actor_name or "المسؤول",
        details=details,
    ))


def _movement(
    session: Session,
    asset: Asset,
    movement_type: str,
    notes: str,
    actor_name: str,
    *,
    from_employee: str | None = None,
    to_employee: str | None = None,
    from_office_name: str | None = None,
    to_office_name: str | None = None,
) -> None:
    session.add(AssetMovement(
        asset_id=asset.id,
        asset_label=f"{asset.brand} {asset.model}".strip(),
        movement_type=movement_type,
        occurred_at=utc_now(),
        from_employee=from_employee,
        to_employee=to_employee,
        from_office_name=from_office_name,
        to_office_name=to_office_name or asset.office_name,
        notes=notes or f"بواسطة {actor_name or 'المسؤول'}",
    ))


def create_custody_card(
    session: Session,
    *,
    card_number: str,
    responsible_name: str,
    office_name: str,
    items: Iterable[CustodyItemInput],
    actor_name: str = "المسؤول",
    form_number: str = "نموذج مستودع رقم (23)",
    role_title: str = "",
    directorate: str = "",
    department: str = "",
    office_room: str = "",
    province_region: str = "",
    notes: str = "",
    it_department_head: str = "",
    inventory_tech_name: str = "",
    responsible_signature_name: str = "",
) -> CustodyCard:
    card_number = card_number.strip()
    responsible_name = responsible_name.strip()
    office_name = office_name.strip()
    item_list = list(items)
    if not card_number or len(card_number) > 80:
        raise ValueError("رقم بطاقة العهدة مطلوب ولا يجوز أن يتجاوز 80 محرفاً.")
    if not responsible_name or not office_name:
        raise ValueError("اسم المسؤول والمكتب حقول إلزامية.")
    if not item_list:
        raise ValueError("أضف مادة واحدة على الأقل إلى بطاقة العهدة.")
    if len({item.asset_id for item in item_list if item.asset_id}) != len(
        [item for item in item_list if item.asset_id]
    ):
        raise ValueError("لا يمكن ربط الأصل نفسه أكثر من مرة في بطاقة العهدة.")

    try:
        with session.begin():
            if session.scalar(select(CustodyCard.id).where(CustodyCard.card_number == card_number).limit(1)):
                raise ValueError("رقم بطاقة العهدة مستخدم مسبقاً.")

            for item in item_list:
                if not item.item_name.strip() or item.quantity <= 0:
                    raise ValueError("اسم المادة والكمية الموجبة مطلوبان لكل بند.")
                if item.asset_id:
                    asset = session.get(Asset, item.asset_id)
                    if asset is None:
                        raise ValueError("أحد الأصول المرتبطة ببطاقة العهدة غير موجود.")
                    if asset.status not in {"available", "returned"}:
                        raise ValueError(
                            f"لا يمكن طلب عهدة للأصل ({asset.brand} {asset.model}) لأنه ليس متاحاً."
                        )

            card = CustodyCard(
                card_number=card_number,
                form_number=form_number.strip() or None,
                province_region=province_region.strip() or None,
                responsible_name=responsible_name,
                role_title=role_title.strip() or None,
                directorate=directorate.strip() or None,
                department=department.strip() or None,
                office_name=office_name,
                office_room=office_room.strip() or None,
                assigned_at=utc_now(),
                status="active",
                approval_status="pending",
                notes=notes.strip() or None,
                it_department_head=it_department_head.strip() or None,
                inventory_tech_name=inventory_tech_name.strip() or None,
                responsible_signature_name=responsible_signature_name.strip() or None,
                created_by=actor_name or "المسؤول",
            )
            session.add(card)
            session.flush()
            for sequence, item in enumerate(item_list, start=1):
                session.add(CustodyItem(
                    custody_card_id=card.id,
                    seq=sequence,
                    item_name=item.item_name.strip(),
                    item_description=item.item_description.strip() or None,
                    unit=item.unit.strip() or None,
                    quantity_number=float(item.quantity),
                    quantity_text=str(item.quantity),
                    item_code=item.item_code.strip() or None,
                    card_code=f"{card_number}/{sequence}",
                    balance=float(item.quantity),
                    notes=item.notes.strip() or None,
                    asset_id=item.asset_id,
                ))
            _audit(
                session, "custody_card", card.id, "created", actor_name,
                f"إنشاء بطاقة عهدة رقم {card_number} للمسؤول {responsible_name} — بانتظار الاعتماد.",
            )
            session.flush()
        return card
    except IntegrityError as exc:
        session.rollback()
        raise ValueError("تعذر إنشاء بطاقة العهدة بسبب تكرار رقم البطاقة.") from exc


def approve_custody_card(
    session: Session, card_id: str, approver_name: str, notes: str = ""
) -> CustodyCard:
    with session.begin():
        card = session.scalar(
            select(CustodyCard)
            .options(selectinload(CustodyCard.items).selectinload(CustodyItem.asset))
            .where(CustodyCard.id == card_id)
        )
        if card is None:
            raise ValueError("بطاقة العهدة غير موجودة.")
        if card.approval_status != "pending" or card.status != "active":
            raise ValueError("لا يمكن اعتماد هذه البطاقة في حالتها الحالية.")

        for item in card.items:
            if item.asset_id:
                asset = item.asset
                if asset is None or asset.status not in {"available", "returned"}:
                    raise ValueError(
                        f"تعذر اعتماد البطاقة لأن الأصل المرتبط بالبند ({item.item_name}) لم يعد متاحاً."
                    )

        now = utc_now()
        card.approval_status = "approved"
        card.approved_by = approver_name
        card.approved_at = now
        if notes.strip():
            card.notes = (card.notes + "\n" if card.notes else "") + notes.strip()

        for item in card.items:
            if not item.asset_id:
                continue
            asset = item.asset
            old_status = asset.status
            asset.status = "assigned"
            _movement(
                session, asset, "assigned",
                f"تسليم الأصل ضمن بطاقة العهدة {card.card_number}.",
                approver_name,
                to_employee=card.responsible_name,
                to_office_name=card.office_name,
            )
            _audit(
                session, "asset", asset.id, "custody_assigned", approver_name,
                f"تغيير حالة الأصل من {old_status} إلى assigned بموجب البطاقة {card.card_number}.",
            )

        _audit(
            session, "custody_card", card.id, "approved", approver_name,
            f"اعتماد بطاقة العهدة {card.card_number}.",
        )
        session.flush()
    return card


def reject_custody_card(
    session: Session, card_id: str, reviewer_name: str, reason: str
) -> CustodyCard:
    reason = reason.strip()
    if not reason:
        raise ValueError("سبب رفض بطاقة العهدة مطلوب.")
    with session.begin():
        card = session.get(CustodyCard, card_id)
        if card is None:
            raise ValueError("بطاقة العهدة غير موجودة.")
        if card.approval_status != "pending":
            raise ValueError("لا يمكن رفض بطاقة سبق البت فيها.")
        now = utc_now()
        card.approval_status = "rejected"
        card.status = "rejected"
        card.rejected_by = reviewer_name
        card.rejected_at = now
        card.rejection_reason = reason
        _audit(session, "custody_card", card.id, "rejected", reviewer_name, reason)
        session.flush()
    return card


def return_custody_card(
    session: Session, card_id: str, receiver_name: str, notes: str = ""
) -> CustodyCard:
    with session.begin():
        card = session.scalar(
            select(CustodyCard)
            .options(selectinload(CustodyCard.items).selectinload(CustodyItem.asset))
            .where(CustodyCard.id == card_id)
        )
        if card is None:
            raise ValueError("بطاقة العهدة غير موجودة.")
        if card.approval_status != "approved" or card.status != "active":
            raise ValueError("لا يمكن إرجاع بطاقة غير معتمدة أو مغلقة.")

        now = utc_now()
        card.status = "returned"
        card.returned_at = now
        if notes.strip():
            card.notes = (card.notes + "\n" if card.notes else "") + notes.strip()

        for item in card.items:
            if not item.asset_id or item.asset is None:
                continue
            asset = item.asset
            if asset.status != "assigned":
                raise ValueError(f"لا يمكن إغلاق العهدة: حالة الأصل ({item.item_name}) تغيرت.")
            asset.status = "returned"
            _movement(
                session, asset, "returned",
                f"إرجاع الأصل من بطاقة العهدة {card.card_number}.",
                receiver_name,
                from_employee=card.responsible_name,
                from_office_name=card.office_name,
            )
            _audit(
                session, "asset", asset.id, "custody_returned", receiver_name,
                f"إرجاع الأصل بموجب بطاقة العهدة {card.card_number}.",
            )

        _audit(
            session, "custody_card", card.id, "returned", receiver_name,
            f"إغلاق بطاقة العهدة {card.card_number}.",
        )
        session.flush()
    return card


def list_custody_cards(session: Session) -> list[CustodyCard]:
    return list(session.scalars(
        select(CustodyCard)
        .options(selectinload(CustodyCard.items))
        .order_by(CustodyCard.created_at.desc())
    ).unique().all())


def open_maintenance_ticket(
    session: Session,
    asset_id: str,
    title: str,
    description: str,
    priority: str = "normal",
    technician: str = "",
    actor_name: str = "المسؤول",
) -> MaintenanceRecord:
    title = title.strip()
    description = description.strip()
    if not title or not description:
        raise ValueError("عنوان الصيانة ووصف العطل مطلوبان.")
    if priority not in {"low", "normal", "high", "urgent"}:
        raise ValueError("درجة أولوية الصيانة غير صحيحة.")

    with session.begin():
        asset = session.get(Asset, asset_id)
        if asset is None:
            raise ValueError("الأصل غير موجود.")
        if asset.status == "assigned":
            raise ValueError("لا يمكن إدخال أصل بعهدة موظف إلى الصيانة قبل إغلاق بطاقة العهدة وإرجاعه.")
        if asset.status in {"retired", "maintenance"}:
            raise ValueError("لا يمكن فتح طلب صيانة لأصل مستبعد أو موجود أصلاً في الصيانة.")
        previous_status = asset.status
        ticket = MaintenanceRecord(
            asset_id=asset.id,
            asset_label=f"{asset.brand} {asset.model}".strip(),
            title=title,
            description=description,
            priority=priority,
            status="open",
            reported_at=utc_now(),
            technician=technician.strip() or None,
            parts_cost=0,
            previous_asset_status=previous_status,
        )
        session.add(ticket)
        asset.status = "maintenance"
        session.flush()
        _movement(
            session, asset, "maintenance_opened",
            f"فتح طلب صيانة: {title}.", actor_name,
            from_office_name=asset.office_name,
        )
        _audit(session, "maintenance", ticket.id, "opened", actor_name, description)
        session.flush()
    return ticket


def update_maintenance_ticket(
    session: Session,
    ticket_id: str,
    new_status: str,
    actor_name: str = "المسؤول",
    technician: str = "",
    resolution: str = "",
    cost: float | None = None,
) -> MaintenanceRecord:
    if new_status not in {"open", "inProgress", "completed", "cancelled"}:
        raise ValueError("حالة طلب الصيانة غير صحيحة.")
    if cost is not None and cost < 0:
        raise ValueError("تكلفة الصيانة لا يمكن أن تكون سالبة.")
    if new_status == "completed" and not resolution.strip():
        raise ValueError("وصف الإصلاح أو الحل مطلوب عند إكمال الصيانة.")

    with session.begin():
        ticket = session.scalar(
            select(MaintenanceRecord)
            .options(selectinload(MaintenanceRecord.asset))
            .where(MaintenanceRecord.id == ticket_id)
        )
        if ticket is None:
            raise ValueError("طلب الصيانة غير موجود.")
        if ticket.status in {"completed", "cancelled"}:
            raise ValueError("طلب الصيانة مغلق مسبقاً.")
        asset = ticket.asset
        old_status = ticket.status
        ticket.status = new_status
        ticket.technician = technician.strip() or ticket.technician
        if cost is not None:
            ticket.cost = float(cost)
        if resolution.strip():
            ticket.resolution = resolution.strip()

        if new_status in {"completed", "cancelled"}:
            ticket.completed_at = utc_now()
            restored_status = ticket.previous_asset_status or "available"
            asset.status = restored_status if restored_status != "maintenance" else "available"
            movement_type = "maintenance_completed" if new_status == "completed" else "maintenance_cancelled"
            _movement(
                session, asset, movement_type,
                f"إغلاق طلب الصيانة ({new_status}): {ticket.title}.",
                actor_name,
                from_office_name=asset.office_name,
            )
        else:
            movement_type = "maintenance_updated"

        _audit(
            session, "maintenance", ticket.id, "status_changed", actor_name,
            f"تغيير حالة طلب الصيانة من {old_status} إلى {new_status}.",
        )
        session.flush()
    return ticket


def create_spare_part(
    session: Session,
    name: str,
    sku: str,
    quantity: float,
    minimum_quantity: float,
    unit_cost: float,
    supplier: str = "",
) -> SparePart:
    name, sku = name.strip(), sku.strip().upper()
    if not name or not sku:
        raise ValueError("اسم قطعة الغيار ورمزها مطلوبان.")
    numeric_values = (quantity, minimum_quantity, unit_cost)
    if not all(math.isfinite(value) for value in numeric_values):
        raise ValueError("المخزون والحد الأدنى والتكلفة يجب أن تكون أرقاماً محددة.")
    if quantity < 0 or minimum_quantity < 0 or unit_cost < 0:
        raise ValueError("المخزون والحد الأدنى والتكلفة لا يمكن أن تكون سالبة.")
    try:
        with session.begin():
            if session.scalar(select(SparePart.id).where(SparePart.sku == sku).limit(1)):
                raise ValueError("رمز قطعة الغيار مسجل مسبقاً.")
            part = SparePart(
                name=name, sku=sku, quantity=float(quantity),
                minimum_quantity=float(minimum_quantity), unit_cost=float(unit_cost),
                supplier=supplier.strip(),
            )
            session.add(part)
            session.flush()
            _audit(session, "spare_part", part.id, "created", "المسؤول", f"إضافة قطعة غيار {name} ({sku}).")
        return part
    except IntegrityError as exc:
        session.rollback()
        raise ValueError("رمز قطعة الغيار مستخدم مسبقاً.") from exc


def consume_spare_part(
    session: Session,
    part_id: str,
    maintenance_id: str,
    quantity: float,
    notes: str = "",
    actor_name: str = "المسؤول",
) -> MaintenancePartUsage:
    if not math.isfinite(quantity) or quantity <= 0:
        raise ValueError("الكمية المصروفة يجب أن تكون رقماً موجباً ومحدداً.")

    with session.begin():
        part = session.get(SparePart, part_id)
        ticket = session.scalar(
            select(MaintenanceRecord)
            .options(selectinload(MaintenanceRecord.asset))
            .where(MaintenanceRecord.id == maintenance_id)
        )
        if part is None:
            raise ValueError("قطعة الغيار غير موجودة.")
        if ticket is None:
            raise ValueError("طلب الصيانة غير موجود.")
        if ticket.status in {"completed", "cancelled"}:
            raise ValueError("لا يمكن صرف قطع لطلب صيانة مغلق.")
        unit_cost = float(part.unit_cost)
        total_cost = unit_cost * quantity

        # Conditional SQL updates prevent concurrent requests from overspending stock
        # or adding maintenance costs based on stale ORM snapshots.
        stock_result = session.execute(
            update(SparePart)
            .where(SparePart.id == part.id, SparePart.quantity >= quantity)
            .values(quantity=SparePart.quantity - quantity, updated_at=utc_now())
            .execution_options(synchronize_session=False)
        )
        if stock_result.rowcount != 1:
            available = session.scalar(
                select(SparePart.quantity).where(SparePart.id == part.id)
            )
            raise ValueError(
                f"المخزون المتاح ({float(available or 0):g}) لا يكفي لصرف ({quantity:g})."
            )

        ticket_result = session.execute(
            update(MaintenanceRecord)
            .where(
                MaintenanceRecord.id == ticket.id,
                MaintenanceRecord.status.notin_({"completed", "cancelled"}),
            )
            .values(parts_cost=func.coalesce(MaintenanceRecord.parts_cost, 0) + total_cost)
            .execution_options(synchronize_session=False)
        )
        if ticket_result.rowcount != 1:
            raise ValueError("لا يمكن صرف قطع لطلب صيانة مغلق.")

        session.expire(part, ["quantity"])
        session.expire(ticket, ["parts_cost"])
        usage = MaintenancePartUsage(
            part_id=part.id,
            part_name=part.name,
            maintenance_id=ticket.id,
            asset_id=ticket.asset_id,
            quantity=float(quantity),
            unit_cost=unit_cost,
            total_cost=total_cost,
            notes=notes.strip() or f"صرف بواسطة {actor_name or 'المسؤول'}",
            used_at=utc_now(),
        )
        session.add(usage)
        _audit(
            session, "spare_part", part.id, "consumed", actor_name,
            f"صرف {quantity:g} من {part.name} لطلب الصيانة {ticket.id}.",
        )
        session.flush()
    return usage


def list_maintenance_tickets(session: Session) -> list[MaintenanceRecord]:
    return list(session.scalars(
        select(MaintenanceRecord).order_by(MaintenanceRecord.reported_at.desc())
    ).all())


def list_spare_parts(session: Session) -> list[SparePart]:
    return list(session.scalars(select(SparePart).order_by(SparePart.name)).all())