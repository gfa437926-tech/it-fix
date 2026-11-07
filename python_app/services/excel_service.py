from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Asset, ImportBatch, Office, utc_now
from .assets import ASSET_CATEGORIES, AssetInput, create_asset

CATEGORY_LABELS = {
    "desktop": "كمبيوتر مكتبي", "laptop": "لابتوب", "monitor": "شاشة",
    "printer": "طابعة", "scanner": "ماسح ضوئي", "network": "معدات شبكة",
    "storage": "وحدة تخزين", "ups": "وحدة طاقة UPS", "accessory": "ملحق", "other": "أخرى",
}
CATEGORY_ALIASES = {label: key for key, label in CATEGORY_LABELS.items()}
STATUS_LABELS = {
    "available": "متوفر", "assigned": "في العهدة", "maintenance": "قيد الصيانة",
    "damaged": "تالف", "retired": "مستبعد", "returned": "معاد للمستودع",
}
STATUS_ALIASES = {label: key for key, label in STATUS_LABELS.items()}

HEADER_ALIASES = {
    "category": {"category", "type", "الفئة", "التصنيف", "نوع الأصل"},
    "brand": {"brand", "manufacturer", "الشركة المصنعة", "الماركة", "الشركة"},
    "model": {"model", "الطراز", "الموديل"},
    "serial_number": {"serial", "serial number", "serial_number", "الرقم التسلسلي", "السيريال"},
    "status": {"status", "الحالة"},
    "office_name": {"office", "office name", "office_name", "المكتب", "موقع الأصل"},
    "cpu": {"cpu", "المعالج"},
    "ram": {"ram", "الذاكرة", "الرام"},
    "storage": {"storage", "التخزين", "القرص"},
}


@dataclass(frozen=True, slots=True)
class ImportResult:
    batch_id: str
    total_rows: int
    succeeded_rows: int
    failed_rows: int
    skipped_rows: int
    row_errors: tuple[str, ...]


def _normalize_header(value: object) -> str:
    return " ".join(str(value or "").strip().lower().replace("_", " ").split())


def _map_headers(header_row: tuple[object, ...]) -> dict[str, int]:
    aliases = {
        _normalize_header(alias): field
        for field, values in HEADER_ALIASES.items()
        for alias in values
    }
    mapped: dict[str, int] = {}
    for index, raw in enumerate(header_row):
        key = aliases.get(_normalize_header(raw))
        if key and key not in mapped:
            mapped[key] = index
    missing = {"brand", "model"} - mapped.keys()
    if missing:
        raise ValueError("أعمدة Excel الإلزامية غير موجودة: الشركة المصنعة والطراز.")
    return mapped


def _read_cell(row: tuple[object, ...], mapping: dict[str, int], key: str) -> str:
    index = mapping.get(key)
    if index is None or index >= len(row):
        return ""
    value = row[index]
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value).strip()


def import_assets_from_excel(
    session: Session,
    file_path: str | Path,
    actor_name: str = "المسؤول",
) -> ImportResult:
    path = Path(file_path)
    if path.suffix.lower() not in {".xlsx", ".xlsm"}:
        raise ValueError("يدعم الاستيراد ملفات Excel بصيغة .xlsx أو .xlsm فقط.")
    if not path.is_file():
        raise FileNotFoundError("ملف Excel غير موجود.")

    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        sheet = workbook.active
        iterator = sheet.iter_rows(values_only=True)
        header_row = next(iterator, None)
        if header_row is None:
            raise ValueError("ملف Excel فارغ.")
        mapping = _map_headers(header_row)
        succeeded = failed = skipped = 0
        errors: list[str] = []

        for row_number, row in enumerate(iterator, start=2):
            values = tuple(row or ())
            if not any(str(value or "").strip() for value in values):
                skipped += 1
                continue

            brand = _read_cell(values, mapping, "brand")
            model = _read_cell(values, mapping, "model")
            if not brand or not model:
                skipped += 1
                errors.append(f"السطر {row_number}: تم تجاوز صف ينقصه اسم الشركة أو الطراز.")
                continue

            category_raw = _read_cell(values, mapping, "category").lower()
            category = CATEGORY_ALIASES.get(category_raw, category_raw or "other")
            if category not in ASSET_CATEGORIES:
                failed += 1
                errors.append(f"السطر {row_number}: فئة أصل غير معروفة ({category_raw}).")
                continue

            status_raw = _read_cell(values, mapping, "status").lower()
            status = STATUS_ALIASES.get(status_raw, status_raw or "available")
            if status not in STATUS_LABELS:
                failed += 1
                errors.append(f"السطر {row_number}: حالة أصل غير معروفة ({status_raw}).")
                continue

            try:
                create_asset(session, AssetInput(
                    category=category,
                    brand=brand,
                    model=model,
                    serial_number=_read_cell(values, mapping, "serial_number"),
                    status=status,
                    office_name=_read_cell(values, mapping, "office_name"),
                    cpu=_read_cell(values, mapping, "cpu"),
                    ram=_read_cell(values, mapping, "ram"),
                    storage=_read_cell(values, mapping, "storage"),
                ), actor_name=actor_name)
                succeeded += 1
            except ValueError as exc:
                failed += 1
                errors.append(f"السطر {row_number}: {exc}")

        batch = ImportBatch(
            source_name=path.name,
            created_by=actor_name,
            created_at=utc_now(),
            completed_at=utc_now(),
            total_rows=succeeded + failed + skipped,
            attempted_rows=succeeded + failed,
            succeeded_rows=succeeded,
            failed_rows=failed,
            skipped_invalid_rows=skipped,
            status="completed" if failed == 0 else ("partial" if succeeded else "failed"),
            row_errors="\n".join(errors)[:50000] or None,
        )
        session.add(batch)
        session.commit()
        return ImportResult(
            batch_id=batch.id,
            total_rows=batch.total_rows,
            succeeded_rows=succeeded,
            failed_rows=failed,
            skipped_rows=skipped,
            row_errors=tuple(errors),
        )
    finally:
        workbook.close()


def _safe_excel_text(value: object) -> object:
    if not isinstance(value, str):
        return value
    candidate = value.lstrip()
    if candidate.startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def export_assets_to_excel(session: Session, file_path: str | Path) -> int:
    rows = session.scalars(select(Asset).order_by(Asset.brand, Asset.model)).all()
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "جرد الأصول"
    headers = [
        "الفئة", "الشركة المصنعة", "الطراز", "الرقم التسلسلي", "الحالة",
        "المكتب", "المعالج", "الذاكرة", "التخزين", "تاريخ الاستلام",
    ]
    sheet.append(headers)
    for asset in rows:
        sheet.append([
            CATEGORY_LABELS.get(asset.category, asset.category),
            _safe_excel_text(asset.brand),
            _safe_excel_text(asset.model),
            _safe_excel_text(asset.serial_number or ""),
            STATUS_LABELS.get(asset.status, asset.status),
            _safe_excel_text(asset.office_name or ""),
            _safe_excel_text(asset.cpu or ""),
            _safe_excel_text(asset.ram or ""),
            _safe_excel_text(asset.storage or ""),
            asset.received_at.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M") if asset.received_at else "",
        ])

    header_fill = PatternFill("solid", fgColor="173F5F")
    for cell in sheet[1]:
        cell.fill = header_fill
        cell.font = Font(bold=True, color="FFFFFF")
        cell.alignment = Alignment(horizontal="center", vertical="center")
    for row in sheet.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(horizontal="right", vertical="center")
    widths = [18, 24, 24, 24, 18, 26, 22, 18, 22, 22]
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[chr(64 + index)].width = width
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    workbook.save(file_path)
    return len(rows)
