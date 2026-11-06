from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from python_app.models import Asset, AssetDocument, AuditLog, Base, PurchaseRecord
from python_app.services.assets import AssetInput, create_asset
from python_app.services.documents import (
    MAX_DOCUMENT_SIZE_BYTES,
    attach_asset_document,
    list_asset_documents,
    resolve_asset_document_path,
)


@pytest.fixture()
def session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    db = factory()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def write_pdf(path: Path, body: bytes = b"%PDF-1.7\nasset invoice\n%%EOF") -> Path:
    path.write_bytes(body)
    return path


def test_attach_pdf_to_asset_copies_file_and_writes_audit(
    session: Session, tmp_path: Path
) -> None:
    asset = create_asset(session, AssetInput("laptop", "HP", "ProBook", "DOC-1"))
    source = write_pdf(tmp_path / "invoice.pdf")

    document = attach_asset_document(
        session,
        asset_id=asset.id,
        source_path=source,
        uploaded_by="مسؤول الجرد",
        document_type="invoice",
        storage_root=tmp_path / "data",
    )

    stored = resolve_asset_document_path(document, tmp_path / "data")
    assert stored.is_file()
    assert stored.read_bytes() == source.read_bytes()
    assert document.file_name == "invoice.pdf"
    assert document.content_type == "application/pdf"
    assert document.document_type == "invoice"
    assert document.size_bytes == source.stat().st_size
    assert document.storage_path.startswith("documents/")
    assert list_asset_documents(session, asset.id) == [document]

    audit = session.scalar(
        select(AuditLog).where(
            AuditLog.entity_type == "asset_document",
            AuditLog.entity_id == document.id,
        )
    )
    assert audit is not None
    assert audit.action == "attached"
    assert audit.actor_name == "مسؤول الجرد"


def test_asset_document_list_can_filter_by_asset(session: Session, tmp_path: Path) -> None:
    first = create_asset(session, AssetInput("desktop", "Dell", "OptiPlex", "DOC-2"))
    second = create_asset(session, AssetInput("monitor", "Dell", "P2422H", "DOC-3"))
    file_one = write_pdf(tmp_path / "one.pdf")
    file_two = write_pdf(tmp_path / "two.pdf")

    attach_asset_document(
        session, asset_id=first.id, source_path=file_one, uploaded_by="مدير",
        storage_root=tmp_path / "data",
    )
    second_doc = attach_asset_document(
        session, asset_id=second.id, source_path=file_two, uploaded_by="مدير",
        storage_root=tmp_path / "data",
    )

    assert len(list_asset_documents(session)) == 2
    assert [doc.id for doc in list_asset_documents(session, second.id)] == [second_doc.id]
    assert list_asset_documents(session, "unknown") == []


@pytest.mark.parametrize(
    ("filename", "payload", "message"),
    [
        ("script.exe", b"MZ executable", "نوع الملف غير مسموح"),
        ("fake.pdf", b"not a pdf", "لا يطابق صيغة PDF"),
        ("fake.png", b"not a png", "لا يطابق صيغة PNG"),
        ("fake.jpg", b"not a jpeg", "لا يطابق صيغة JPEG"),
        ("empty.pdf", b"", "ملف فارغ"),
        ("bad.txt", b"\xff\xfe", "ترميز UTF-8"),
    ],
)
def test_rejects_unsupported_or_mislabelled_attachment_without_database_rows(
    session: Session, tmp_path: Path, filename: str, payload: bytes, message: str
) -> None:
    asset = create_asset(session, AssetInput("desktop", "Dell", "OptiPlex", "DOC-INVALID"))
    source = tmp_path / filename
    source.write_bytes(payload)

    with pytest.raises(ValueError, match=message):
        attach_asset_document(
            session,
            asset_id=asset.id,
            source_path=source,
            uploaded_by="مدير",
            storage_root=tmp_path / "data",
        )

    assert session.scalar(select(AssetDocument.id)) is None
    assert session.scalar(
        select(AuditLog.id).where(AuditLog.entity_type == "asset_document")
    ) is None
    assert not (tmp_path / "data" / "documents").exists()


def test_rejects_attachment_over_size_limit(session: Session, tmp_path: Path) -> None:
    asset = create_asset(session, AssetInput("desktop", "Dell", "OptiPlex", "DOC-LARGE"))
    source = tmp_path / "large.pdf"
    source.write_bytes(b"%PDF-" + b"x" * MAX_DOCUMENT_SIZE_BYTES)

    with pytest.raises(ValueError, match="20 ميغابايت"):
        attach_asset_document(
            session, asset_id=asset.id, source_path=source, uploaded_by="مدير",
            storage_root=tmp_path / "data",
        )

    assert session.scalar(select(AssetDocument.id)) is None


def test_unknown_asset_does_not_leave_copied_file(session: Session, tmp_path: Path) -> None:
    source = write_pdf(tmp_path / "orphan.pdf")

    with pytest.raises(ValueError, match="الأصل المحدد غير موجود"):
        attach_asset_document(
            session, asset_id="missing", source_path=source, uploaded_by="مدير",
            storage_root=tmp_path / "data",
        )

    documents_dir = tmp_path / "data" / "documents"
    assert list(documents_dir.iterdir()) == []
    assert session.scalar(select(AssetDocument.id)) is None


def test_purchase_link_must_belong_to_the_same_asset(
    session: Session, tmp_path: Path
) -> None:
    first = create_asset(session, AssetInput("desktop", "Dell", "A", "DOC-PUR-1"))
    second = create_asset(session, AssetInput("laptop", "HP", "B", "DOC-PUR-2"))
    purchase = PurchaseRecord(
        asset_id=first.id,
        asset_label="Dell A",
        supplier="مورد",
        invoice_number="INV-1",
        purchase_date="2026-10-01",
        total_cost=100,
    )
    session.add(purchase)
    session.commit()
    source = write_pdf(tmp_path / "wrong-invoice.pdf")

    with pytest.raises(ValueError, match="لا تخص الأصل"):
        attach_asset_document(
            session,
            asset_id=second.id,
            source_path=source,
            uploaded_by="مدير",
            purchase_record_id=purchase.id,
            storage_root=tmp_path / "data",
        )

    assert session.scalar(select(AssetDocument.id)) is None
    assert list((tmp_path / "data" / "documents").iterdir()) == []


def test_document_path_rejects_traversal_and_missing_files(tmp_path: Path) -> None:
    from types import SimpleNamespace

    with pytest.raises(ValueError, match="غير صالح"):
        resolve_asset_document_path(
            SimpleNamespace(storage_path="../outside.pdf"),
            tmp_path / "data",
        )

    with pytest.raises(FileNotFoundError, match="غير موجود"):
        resolve_asset_document_path(
            SimpleNamespace(storage_path="documents/missing.pdf"),
            tmp_path / "data",
        )


def test_invoice_attachment_can_be_linked_to_purchase_record_for_same_asset(
    session: Session, tmp_path: Path
) -> None:
    asset = create_asset(session, AssetInput("laptop", "Lenovo", "ThinkPad", "DOC-INVOICE-LINK"))
    purchase = PurchaseRecord(
        asset_id=asset.id,
        asset_label="Lenovo ThinkPad",
        supplier="المورد التقني",
        invoice_number="INV-LINK-2026",
        purchase_date="2026-11-01",
        total_cost=1250,
    )
    session.add(purchase)
    session.commit()
    source = write_pdf(tmp_path / "linked-invoice.pdf")

    document = attach_asset_document(
        session,
        asset_id=asset.id,
        source_path=source,
        uploaded_by="مدير الجرد",
        document_type="invoice",
        purchase_record_id=purchase.id,
        storage_root=tmp_path / "data",
    )

    assert document.document_type == "invoice"
    assert document.purchase_record_id == purchase.id
    assert list_asset_documents(session, asset.id) == [document]
    assert resolve_asset_document_path(document, tmp_path / "data").read_bytes() == source.read_bytes()
