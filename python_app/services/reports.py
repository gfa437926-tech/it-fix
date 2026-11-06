from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import (
    Asset,
    AssetDocument,
    AssetMovement,
    AuditLog,
    CustodyCard,
    MaintenancePartUsage,
    MaintenanceRecord,
    Office,
    PurchaseRecord,
    SparePart,
)
from .assets import get_dashboard_summary
from .excel_service import CATEGORY_LABELS, STATUS_LABELS


def _safe_cell(value: object) -> object:
    if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
        return "'" + value
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    return value


def _format_sheet(sheet, widths: list[int] | None = None) -> None:
    sheet.sheet_view.rightToLeft = True
    sheet.sheet_view.showGridLines = False
    sheet.freeze_panes = "A2"
    if sheet.max_row and sheet.max_column:
        sheet.auto_filter.ref = sheet.dimensions
    for cell in sheet[1]:
        cell.fill = PatternFill("solid", fgColor="173F5F")
        cell.font = Font(name="Tahoma", bold=True, color="FFFFFF")
        cell.alignment = Alignment(horizontal="center", vertical="center")
    sheet.row_dimensions[1].height = 26
    for row in sheet.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(horizontal="right", vertical="center")
    if widths:
        for index, width in enumerate(widths, start=1):
            sheet.column_dimensions[sheet.cell(1, index).column_letter].width = width
    else:
        for column_cells in sheet.columns:
            letter = column_cells[0].column_letter
            maximum = max((len(str(cell.value or "")) for cell in column_cells[:1000]), default=10)
            sheet.column_dimensions[letter].width = min(42, max(12, maximum + 3))


def _sheet(
    workbook: Workbook,
    title: str,
    headers: list[str],
    rows: list[list[object]],
    widths: list[int] | None = None,
) -> None:
    sheet = workbook.create_sheet(title)
    sheet.append(headers)
    for row in rows:
        sheet.append([_safe_cell(value) for value in row])
    _format_sheet(sheet, widths)


def export_management_report(
    session: Session,
    file_path: str | Path,
    *,
    date_from: date | None = None,
    date_to: date | None = None,
) -> int:
    """Export operational data, optionally restricting dated records to a range."""
    if date_from and date_to and date_from > date_to:
        raise ValueError("تاريخ البداية يجب أن يكون قبل تاريخ النهاية أو مساوياً له.")

    def in_range(value: object) -> bool:
        if value is None:
            return False
        if isinstance(value, datetime):
            day = value.date()
        elif isinstance(value, date):
            day = value
        else:
            try:
                day = date.fromisoformat(str(value)[:10])
            except (TypeError, ValueError):
                return False
        return (date_from is None or day >= date_from) and (date_to is None or day <= date_to)

    summary = get_dashboard_summary(session)
    assets = list(session.scalars(select(Asset).order_by(Asset.brand, Asset.model)).all())
    offices = list(session.scalars(select(Office).order_by(Office.name)).all())
    movements = list(session.scalars(
        select(AssetMovement).order_by(AssetMovement.occurred_at.desc())
    ).all())
    custody_cards = list(session.scalars(
        select(CustodyCard).options(selectinload(CustodyCard.items))
        .order_by(CustodyCard.created_at.desc())
    ).unique().all())
    maintenance = list(session.scalars(
        select(MaintenanceRecord).order_by(MaintenanceRecord.reported_at.desc())
    ).all())
    spare_parts = list(session.scalars(select(SparePart).order_by(SparePart.name)).all())
    usages = list(session.scalars(
        select(MaintenancePartUsage).order_by(MaintenancePartUsage.used_at.desc())
    ).all())
    purchases = list(session.scalars(
        select(PurchaseRecord).order_by(PurchaseRecord.purchase_date.desc())
    ).all())
    documents = list(session.scalars(
        select(AssetDocument).order_by(AssetDocument.created_at.desc())
    ).all())
    audits = list(session.scalars(
        select(AuditLog).order_by(AuditLog.occurred_at.desc()).limit(10000)
    ).all())

    if date_from or date_to:
        movements = [row for row in movements if in_range(row.occurred_at)]
        custody_cards = [row for row in custody_cards if in_range(row.created_at)]
        maintenance = [row for row in maintenance if in_range(row.reported_at)]
        usages = [row for row in usages if in_range(row.used_at)]
        purchases = [row for row in purchases if in_range(row.purchase_date)]
        documents = [row for row in documents if in_range(row.created_at)]
        audits = [row for row in audits if in_range(row.occurred_at)]\n\n    # Aggregate asset ownership and lifecycle costs by office.
    # Assets without an office remain visible in a dedicated row.
    office_metrics: dict[str, dict[str, float]] = defaultdict(lambda: {
        "assets": 0, "assigned": 0, "maintenance": 0,
        "purchase_cost": 0.0, "labor_cost": 0.0, "parts_cost": 0.0,
    })
    office_names = {office.id: office.name for office in offices}
    asset_offices = {asset.id: asset.office_id for asset in assets}
    for asset in assets:
        key = asset.office_id or "__unassigned__"
        office_metrics[key]["assets"] += 1
        if asset.status == "assigned":
            office_metrics[key]["assigned"] += 1
        if asset.status == "maintenance":
            office_metrics[key]["maintenance"] += 1
    for purchase in purchases:
        key = asset_offices.get(purchase.asset_id) or "__unassigned__"
        office_metrics[key]["purchase_cost"] += float(purchase.total_cost or 0)
    for ticket in maintenance:
        key = asset_offices.get(ticket.asset_id) or "__unassigned__"
        office_metrics[key]["labor_cost"] += float(ticket.cost or 0)
        office_metrics[key]["parts_cost"] += float(ticket.parts_cost or 0)
    office_analysis_rows = []
    for key, values in sorted(
        office_metrics.items(),
        key=lambda item: office_names.get(item[0], "بدون مكتب محدد"),
    ):
        office_analysis_rows.append([
            office_names.get(key, "بدون مكتب محدد"),
            int(values["assets"]), int(values["assigned"]), int(values["maintenance"]),
            round(values["purchase_cost"], 2), round(values["labor_cost"], 2),
            round(values["parts_cost"], 2),
            round(values["labor_cost"] + values["parts_cost"], 2),
        ])

    workbook = Workbook()
    overview = workbook.active
    overview.title = "الملخص"
    overview.append(["المؤشر", "القيمة"])
    period_label = (
        f"{date_from.isoformat() if date_from else 'بداية غير محددة'} — "
        f"{date_to.isoformat() if date_to else 'نهاية غير محددة'}"
    )
    overview.append(["فترة التقرير", period_label])
    overview.append(["ملاحظة", "الأصول والمكاتب لقطة حالية؛ السجلات التشغيلية المؤرخة ضمن الفترة المحددة."])
    metrics = [
        ("إجمالي الأصول", summary.total_assets),
        ("متوفر أو معاد للمستودع", summary.available),
        ("في العهدة", summary.assigned),
        ("قيد الصيانة", summary.maintenance),
        ("تالف", summary.damaged),
        ("مستبعد", summary.retired),
        ("المكاتب الفعالة", summary.active_offices),
        ("بطاقات العهدة", len(custody_cards)),
        ("بطاقات بانتظار الاعتماد", sum(1 for card in custody_cards if card.approval_status == "pending")),
        ("طلبات الصيانة", len(maintenance)),
        ("طلبات صيانة مفتوحة", sum(1 for item in maintenance if item.status in {"open", "inProgress"})),
        ("قطع الغيار", len(spare_parts)),
        ("قطع غيار تحت حد إعادة الطلب", sum(1 for item in spare_parts if item.quantity <= item.minimum_quantity)),
        ("فواتير الشراء", len(purchases)),
        ("إجمالي قيمة المشتريات ضمن الفترة", round(sum(float(item.total_cost or 0) for item in purchases), 2)),
        ("إجمالي أجور الصيانة ضمن الفترة", round(sum(float(item.cost or 0) for item in maintenance), 2)),
        ("إجمالي قطع الصيانة ضمن الفترة", round(sum(float(item.parts_cost or 0) for item in maintenance), 2)),
        ("إجمالي تكلفة الصيانة ضمن الفترة", round(sum(float(item.cost or 0) + float(item.parts_cost or 0) for item in maintenance), 2)),
        ("مرفقات الأصول", len(documents)),
        ("حركات الأصول", len(movements)),
        ("سجلات التدقيق", len(audits)),
    ]
    for label, value in metrics:
        overview.append([label, value])
    _format_sheet(overview, [42, 20])

    _sheet(
        workbook, "الأصول",
        ["معرف الأصل", "الفئة", "الشركة", "الطراز", "الرقم التسلسلي", "الحالة",
         "المكتب", "المعالج", "الذاكرة", "التخزين", "تاريخ الاستلام", "سبب الاستبعاد"],
        [[
            asset.id, CATEGORY_LABELS.get(asset.category, asset.category),
            asset.brand, asset.model, asset.serial_number or "",
            STATUS_LABELS.get(asset.status, asset.status), asset.office_name or "",
            asset.cpu or "", asset.ram or "", asset.storage or "",
            asset.received_at, asset.retirement_reason or "",
        ] for asset in assets],
        [38, 20, 22, 24, 24, 18, 24, 20, 16, 20, 22, 35],
    )

    _sheet(
        workbook, "المكاتب",
        ["معرف المكتب", "اسم المكتب", "المبنى", "المديرية", "القسم", "الغرفة",
         "المسؤول", "الهاتف", "الحالة", "ملاحظات"],
        [[
            office.id, office.name, office.building or "", office.directorate or "",
            office.department or "", office.room or "", office.manager or "",
            office.phone or "", "فعال" if office.is_active else "غير فعال",
            office.notes or "",
        ] for office in offices],
    )

    _sheet(
        workbook, "تحليل المكاتب",
        ["المكتب", "عدد الأصول", "أصول في العهدة", "أصول قيد الصيانة",
         "إجمالي المشتريات", "تكلفة أجور الصيانة", "تكلفة قطع الصيانة",
         "إجمالي تكلفة الصيانة"],
        office_analysis_rows,
        [30, 16, 18, 20, 22, 24, 24, 24],
    )

    _sheet(
        workbook, "بطاقات العهدة",
        ["معرف البطاقة", "رقم البطاقة", "المستلم", "المسمى", "المديرية", "القسم",
         "المكتب", "تاريخ التسليم", "حالة البطاقة", "حالة الاعتماد",
         "المعتمد بواسطة", "تاريخ الاعتماد", "سبب الرفض", "عدد البنود"],
        [[
            card.id, card.card_number, card.responsible_name, card.role_title or "",
            card.directorate or "", card.department or "", card.office_name,
            card.assigned_at, {"active": "فعالة", "returned": "معادة", "rejected": "مرفوضة"}.get(card.status, card.status),
            {"pending": "بانتظار الاعتماد", "approved": "معتمدة", "rejected": "مرفوضة"}.get(card.approval_status, card.approval_status),
            card.approved_by or "", card.approved_at, card.rejection_reason or "", len(card.items),
        ] for card in custody_cards],
    )

    custody_items = []
    for card in custody_cards:
        for item in card.items:
            custody_items.append([
                card.card_number, card.responsible_name, card.office_name,
                item.seq, item.item_name, item.item_description or "",
                item.unit or "", item.quantity_number, item.balance,
                item.item_code or "", item.asset_id or "", item.notes or "",
            ])
    _sheet(
        workbook, "بنود العهدة",
        ["رقم البطاقة", "المستلم", "المكتب", "التسلسل", "المادة", "الوصف",
         "الوحدة", "الكمية", "الرصيد", "رمز المادة", "معرف الأصل", "ملاحظات"],
        custody_items,
    )

    _sheet(
        workbook, "الصيانة",
        ["معرف الطلب", "معرف الأصل", "الأصل", "العطل", "الوصف", "الأولوية",
         "الحالة", "الفني", "تاريخ البلاغ", "تكلفة العمل", "تكلفة القطع",
         "الإجمالي", "الحل"],
        [[
            item.id, item.asset_id, item.asset_label, item.title, item.description,
            {"low": "منخفضة", "normal": "عادية", "high": "عالية", "urgent": "عاجلة"}.get(item.priority, item.priority),
            {"open": "مفتوح", "inProgress": "قيد التنفيذ", "completed": "مكتمل", "cancelled": "ملغى"}.get(item.status, item.status),
            item.technician or "", item.reported_at, item.cost or 0,
            item.parts_cost, (item.cost or 0) + item.parts_cost, item.resolution or "",
        ] for item in maintenance],
    )

    _sheet(
        workbook, "قطع الغيار",
        ["معرف القطعة", "الرمز", "اسم القطعة", "الكمية", "حد إعادة الطلب",
         "تكلفة الوحدة", "المورد", "حالة المخزون"],
        [[
            item.id, item.sku, item.name, item.quantity, item.minimum_quantity,
            item.unit_cost, item.supplier,
            "يحتاج تزويد" if item.quantity <= item.minimum_quantity else "متوفر",
        ] for item in spare_parts],
    )

    _sheet(
        workbook, "صرف قطع الغيار",
        ["معرف الحركة", "معرف القطعة", "القطعة", "معرف طلب الصيانة",
         "معرف الأصل", "الكمية", "سعر الوحدة", "الإجمالي", "تاريخ الصرف", "ملاحظات"],
        [[
            item.id, item.part_id, item.part_name, item.maintenance_id,
            item.asset_id, item.quantity, item.unit_cost, item.total_cost,
            item.used_at, item.notes or "",
        ] for item in usages],
    )

    _sheet(
        workbook, "المشتريات والضمان",
        ["معرف السجل", "معرف الأصل", "الأصل", "المورد", "رقم الفاتورة",
         "تاريخ الشراء", "انتهاء الضمان", "القيمة", "ملاحظات"],
        [[
            item.id, item.asset_id, item.asset_label, item.supplier, item.invoice_number,
            item.purchase_date, item.warranty_until or "", item.total_cost, item.notes or "",
        ] for item in purchases],
    )

    _sheet(
        workbook, "المرفقات",
        ["معرف المرفق", "معرف الأصل", "معرف الفاتورة", "اسم الملف", "التصنيف",
         "نوع المحتوى", "الحجم بالبايت", "أضيف بواسطة", "تاريخ الإرفاق"],
        [[
            item.id, item.asset_id, item.purchase_record_id or "", item.file_name,
            {"invoice": "فاتورة", "warranty": "ضمان", "manual": "دليل", "photo": "صورة", "other": "أخرى"}.get(item.document_type, item.document_type),
            item.content_type, item.size_bytes, item.uploaded_by, item.created_at,
        ] for item in documents],
    )

    _sheet(
        workbook, "الحركات",
        ["معرف الحركة", "معرف الأصل", "الأصل", "نوع الحركة", "التاريخ",
         "من المكتب", "إلى المكتب", "من الموظف", "إلى الموظف", "ملاحظات"],
        [[
            item.id, item.asset_id, item.asset_label,
            {
                "registered": "تسجيل أصل جديد", "assigned": "تسليم عهدة",
                "returned": "إرجاع من العهدة", "transferred": "نقل موقع",
                "retired": "استبعاد", "maintenance_opened": "فتح صيانة",
                "maintenance_completed": "إكمال الصيانة",
                "maintenance_cancelled": "إلغاء الصيانة",
            }.get(item.movement_type, item.movement_type),
            item.occurred_at, item.from_office_name or "", item.to_office_name or "",
            item.from_employee or "", item.to_employee or "", item.notes or "",
        ] for item in movements],
    )

    _sheet(
        workbook, "التدقيق",
        ["معرف السجل", "نوع الكيان", "معرف الكيان", "الإجراء", "المنفذ",
         "التفاصيل", "التاريخ"],
        [[
            item.id, item.entity_type, item.entity_id, item.action,
            item.actor_name, item.details or "", item.occurred_at,
        ] for item in audits],
    )

    output = Path(file_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    # Save beside the destination and replace only after the XLSX is complete.
    import os
    import tempfile

    sheet_count = len(workbook.sheetnames)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f".{output.stem}.", suffix=".tmp.xlsx", dir=output.parent, delete=False
        ) as temporary:
            temporary_path = Path(temporary.name)
        workbook.save(temporary_path)
        workbook.close()
        os.replace(temporary_path, output)
        temporary_path = None
    finally:
        workbook.close()
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
    return sheet_count
