from __future__ import annotations

import math
from datetime import date

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Asset, AuditLog, PurchaseRecord


def create_purchase_record(
    session: Session,
    *,
    asset_id: str,
    supplier: str,
    invoice_number: str,
    purchase_date: str,
    total_cost: float,
    warranty_until: str = "",
    notes: str = "",
    actor_name: str = "المسؤول",
) -> PurchaseRecord:
    supplier = supplier.strip()
    invoice_number = invoice_number.strip()
    purchase_date = purchase_date.strip()
    warranty_until = warranty_until.strip()
    notes = notes.strip()

    if not asset_id.strip():
        raise ValueError("يجب تحديد الأصل المرتبط بالفاتورة.")
    if not supplier or len(supplier) > 180:
        raise ValueError("اسم المورد مطلوب ولا يجوز أن يتجاوز 180 محرفاً.")
    if not invoice_number or len(invoice_number) > 100:
        raise ValueError("رقم الفاتورة مطلوب ولا يجوز أن يتجاوز 100 محرف.")
    try:
        purchased_on = date.fromisoformat(purchase_date)
    except ValueError as exc:
        raise ValueError("تاريخ الشراء يجب أن يكون بصيغة YYYY-MM-DD.") from exc

    warranty_date = None
    if warranty_until:
        try:
            warranty_date = date.fromisoformat(warranty_until)
        except ValueError as exc:
            raise ValueError("تاريخ انتهاء الضمان يجب أن يكون بصيغة YYYY-MM-DD.") from exc
        if warranty_date < purchased_on:
            raise ValueError("تاريخ انتهاء الضمان لا يمكن أن يسبق تاريخ الشراء.")

    try:
        amount = float(total_cost)
    except (TypeError, ValueError) as exc:
        raise ValueError("قيمة الفاتورة يجب أن تكون رقماً صحيحاً.") from exc
    if not math.isfinite(amount) or amount < 0:
        raise ValueError("قيمة الفاتورة يجب أن تكون رقماً موجباً أو صفراً.")

    try:
        with session.begin():
            asset = session.get(Asset, asset_id)
            if asset is None:
                raise ValueError("الأصل المحدد غير موجود.")
            duplicate = session.scalar(
                select(PurchaseRecord.id)
                .where(
                    PurchaseRecord.asset_id == asset_id,
                    PurchaseRecord.supplier == supplier,
                    PurchaseRecord.invoice_number == invoice_number,
                )
                .limit(1)
            )
            if duplicate:
                raise ValueError("تم تسجيل رقم الفاتورة نفسه لهذا الأصل والمورد مسبقاً.")

            record = PurchaseRecord(
                asset_id=asset.id,
                asset_label=f"{asset.brand} {asset.model}".strip(),
                supplier=supplier,
                invoice_number=invoice_number,
                purchase_date=purchased_on.isoformat(),
                warranty_until=warranty_date.isoformat() if warranty_date else None,
                total_cost=amount,
                notes=notes or None,
            )
            session.add(record)
            session.flush()
            session.add(AuditLog(
                entity_type="purchase_record",
                entity_id=record.id,
                action="created",
                actor_name=actor_name.strip() or "المسؤول",
                details=(
                    f"تسجيل فاتورة {invoice_number} للأصل {record.asset_label} "
                    f"من المورد {supplier} بقيمة {amount:.2f}."
                ),
            ))
            session.flush()
        return record
    except IntegrityError as exc:
        session.rollback()
        raise ValueError("تعذر تسجيل الفاتورة بسبب تعارض في البيانات.") from exc


def list_purchase_records(
    session: Session,
    asset_id: str | None = None,
) -> list[PurchaseRecord]:
    query = select(PurchaseRecord).order_by(
        PurchaseRecord.purchase_date.desc(),
        PurchaseRecord.created_at.desc(),
        PurchaseRecord.id.desc(),
    )
    if asset_id is not None:
        normalized_asset_id = asset_id.strip()
        if not normalized_asset_id:
            return []
        query = query.where(PurchaseRecord.asset_id == normalized_asset_id)
    return list(session.scalars(query).all())
