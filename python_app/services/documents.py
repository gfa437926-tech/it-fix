from __future__ import annotations

import os
import shutil
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import DATA_DIR
from ..models import Asset, AssetDocument, AuditLog, PurchaseRecord

MAX_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024
DOCUMENT_TYPES = {"invoice", "warranty", "manual", "photo", "other"}
_ALLOWED_FILES = {
    ".pdf": ("application/pdf",),
    ".png": ("image/png",),
    ".jpg": ("image/jpeg",),
    ".jpeg": ("image/jpeg",),
    ".txt": ("text/plain",),
}


def _validate_document_file(source: Path) -> tuple[str, str, int]:
    if not source.exists() or not source.is_file():
        raise ValueError("الملف المحدد غير موجود أو ليس ملفاً عادياً.")

    suffix = source.suffix.lower()
    allowed_types = _ALLOWED_FILES.get(suffix)
    if allowed_types is None:
        raise ValueError("نوع الملف غير مسموح. الأنواع المقبولة: PDF وPNG وJPG وTXT.")

    file_name = source.name
    if not file_name or len(file_name) > 260 or any(ord(char) < 32 for char in file_name):
        raise ValueError("اسم الملف غير صالح أو يتجاوز الحد المسموح.")

    size = source.stat().st_size
    if size <= 0:
        raise ValueError("لا يمكن إرفاق ملف فارغ.")
    if size > MAX_DOCUMENT_SIZE_BYTES:
        raise ValueError("حجم المرفق يتجاوز الحد الأقصى البالغ 20 ميغابايت.")

    with source.open("rb") as stream:
        header = stream.read(16)

    if suffix == ".pdf" and not header.startswith(b"%PDF-"):
        raise ValueError("محتوى الملف لا يطابق صيغة PDF.")
    if suffix == ".png" and not header.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("محتوى الملف لا يطابق صيغة PNG.")
    if suffix in {".jpg", ".jpeg"} and not header.startswith(b"\xff\xd8\xff"):
        raise ValueError("محتوى الملف لا يطابق صيغة JPEG.")
    if suffix == ".txt":
        try:
            with source.open("r", encoding="utf-8") as stream:
                stream.read()
        except UnicodeDecodeError as exc:
            raise ValueError("الملف النصي يجب أن يكون بترميز UTF-8.") from exc

    return file_name, allowed_types[0], size


def attach_asset_document(
    session: Session,
    *,
    asset_id: str,
    source_path: str | Path,
    uploaded_by: str,
    document_type: str = "other",
    purchase_record_id: str | None = None,
    storage_root: str | Path | None = None,
) -> AssetDocument:
    asset_id = asset_id.strip()
    uploaded_by = uploaded_by.strip() or "المسؤول"
    if not asset_id:
        raise ValueError("يجب تحديد الأصل المرتبط بالمرفق.")
    if len(uploaded_by) > 160:
        raise ValueError("اسم المستخدم أطول من الحد المسموح.")
    document_type = document_type.strip().lower()
    if document_type not in DOCUMENT_TYPES:
        raise ValueError("تصنيف المستند غير معروف.")

    source = Path(source_path).expanduser()
    file_name, content_type, size = _validate_document_file(source)
    root = Path(storage_root) if storage_root is not None else DATA_DIR
    documents_dir = root.resolve() / "documents"
    documents_dir.mkdir(parents=True, exist_ok=True)

    document_id = str(uuid.uuid4())
    relative_path = Path("documents") / f"{document_id}{source.suffix.lower()}"
    destination = (root.resolve() / relative_path).resolve()
    if documents_dir.resolve() not in destination.parents:
        raise ValueError("مسار تخزين المرفق غير صالح.")

    temporary = destination.with_suffix(destination.suffix + ".tmp")
    try:
        copied = 0
        with source.open("rb") as input_stream, temporary.open("xb") as output_stream:
            while chunk := input_stream.read(1024 * 1024):
                copied += len(chunk)
                if copied > MAX_DOCUMENT_SIZE_BYTES:
                    raise ValueError("حجم المرفق يتجاوز الحد الأقصى البالغ 20 ميغابايت.")
                output_stream.write(chunk)
            output_stream.flush()
            os.fsync(output_stream.fileno())

        if copied != size:
            raise ValueError("تغير الملف أثناء رفعه؛ أعد اختيار الملف وحاول مجدداً.")
        os.replace(temporary, destination)

        try:
            with session.begin():
                asset = session.get(Asset, asset_id)
                if asset is None:
                    raise ValueError("الأصل المحدد غير موجود.")

                if purchase_record_id:
                    purchase = session.get(PurchaseRecord, purchase_record_id)
                    if purchase is None or purchase.asset_id != asset_id:
                        raise ValueError("فاتورة الشراء المحددة لا تخص الأصل المختار.")

                document = AssetDocument(
                    id=document_id,
                    asset_id=asset.id,
                    purchase_record_id=purchase_record_id,
                    file_name=file_name,
                    document_type=document_type,
                    storage_path=relative_path.as_posix(),
                    content_type=content_type,
                    size_bytes=size,
                    uploaded_by=uploaded_by,
                )
                session.add(document)
                session.add(AuditLog(
                    entity_type="asset_document",
                    entity_id=document_id,
                    action="attached",
                    actor_name=uploaded_by,
                    details=f"إرفاق الملف {file_name} بالأصل {asset.brand} {asset.model}.",
                ))
                session.flush()
            return document
        except Exception:
            destination.unlink(missing_ok=True)
            raise
    finally:
        temporary.unlink(missing_ok=True)


def list_asset_documents(
    session: Session,
    asset_id: str | None = None,
) -> list[AssetDocument]:
    query = select(AssetDocument).order_by(
        AssetDocument.created_at.desc(),
        AssetDocument.id.desc(),
    )
    if asset_id:
        query = query.where(AssetDocument.asset_id == asset_id)
    return list(session.scalars(query).all())


def resolve_asset_document_path(
    document: AssetDocument,
    storage_root: str | Path | None = None,
) -> Path:
    root = (Path(storage_root) if storage_root is not None else DATA_DIR).resolve()
    relative = Path(document.storage_path)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("مسار المرفق المخزن غير صالح.")

    candidate = (root / relative).resolve()
    if root not in candidate.parents:
        raise ValueError("مسار المرفق يشير خارج مجلد التخزين.")
    if not candidate.is_file():
        raise FileNotFoundError("ملف المرفق غير موجود على القرص.")
    return candidate
