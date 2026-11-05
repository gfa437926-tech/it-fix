from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

import pytest

from python_app.models import Asset, AuditLog, Base, PurchaseRecord
from python_app.services.assets import AssetInput, create_asset
from python_app.services.purchases import create_purchase_record, list_purchase_records


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


def test_purchase_record_links_to_asset_and_writes_audit(session: Session) -> None:
    asset = create_asset(session, AssetInput("laptop", "HP", "ProBook", "HP-PUR-1"))

    record = create_purchase_record(
        session,
        asset_id=asset.id,
        supplier="  شركة الحاسوب  ",
        invoice_number=" INV-2026-15 ",
        purchase_date="2026-10-01",
        warranty_until="2028-10-01",
        total_cost=1250.75,
        notes="فاتورة شراء الجهاز",
        actor_name="مسؤول المشتريات",
    )

    assert record.asset_id == asset.id
    assert record.asset_label == "HP ProBook"
    assert record.supplier == "شركة الحاسوب"
    assert record.invoice_number == "INV-2026-15"
    assert record.purchase_date == "2026-10-01"
    assert record.warranty_until == "2028-10-01"
    assert record.total_cost == 1250.75
    audit = session.scalar(
        select(AuditLog).where(
            AuditLog.entity_type == "purchase_record",
            AuditLog.entity_id == record.id,
        )
    )
    assert audit is not None
    assert audit.action == "created"
    assert audit.actor_name == "مسؤول المشتريات"


@pytest.mark.parametrize(
    ("values", "message"),
    [
        ({"supplier": " ", "invoice_number": "I-1"}, "اسم المورد مطلوب"),
        ({"supplier": "مورد", "invoice_number": " "}, "رقم الفاتورة مطلوب"),
        ({"supplier": "مورد", "invoice_number": "I-1", "purchase_date": "01/10/2026"}, "بصيغة YYYY-MM-DD"),
        ({"supplier": "مورد", "invoice_number": "I-1", "warranty_until": "2026-09-30"}, "لا يمكن أن يسبق"),
        ({"supplier": "مورد", "invoice_number": "I-1", "total_cost": -1}, "قيمة الفاتورة"),
        ({"supplier": "مورد", "invoice_number": "I-1", "total_cost": float("inf")}, "قيمة الفاتورة"),
    ],
)
def test_purchase_record_rejects_invalid_business_values(
    session: Session, values: dict[str, object], message: str
) -> None:
    asset = create_asset(session, AssetInput("desktop", "Dell", "OptiPlex", "PUR-INVALID"))
    command: dict[str, object] = {
        "asset_id": asset.id,
        "supplier": "مورد",
        "invoice_number": "INV-1",
        "purchase_date": "2026-10-01",
        "warranty_until": "",
        "total_cost": 100,
    }
    command.update(values)

    with pytest.raises(ValueError, match=message):
        create_purchase_record(session, **command)  # type: ignore[arg-type]

    assert session.scalar(select(PurchaseRecord.id)) is None
    assert session.scalar(select(AuditLog.id).where(AuditLog.entity_type == "purchase_record")) is None


def test_purchase_record_rejects_unknown_asset(session: Session) -> None:
    with pytest.raises(ValueError, match="الأصل المحدد غير موجود"):
        create_purchase_record(
            session,
            asset_id="missing-asset",
            supplier="مورد",
            invoice_number="INV-MISSING",
            purchase_date="2026-10-01",
            total_cost=50,
        )

    assert session.scalar(select(PurchaseRecord.id)) is None


def test_purchase_record_rejects_duplicate_invoice_for_same_asset_and_supplier(
    session: Session,
) -> None:
    asset = create_asset(session, AssetInput("monitor", "Dell", "P2422H", "PUR-DUP-1"))
    create_purchase_record(
        session,
        asset_id=asset.id,
        supplier="مورد واحد",
        invoice_number="INV-DUP",
        purchase_date="2026-09-01",
        total_cost=200,
    )

    with pytest.raises(ValueError, match="مسبقاً"):
        create_purchase_record(
            session,
            asset_id=asset.id,
            supplier="مورد واحد",
            invoice_number="INV-DUP",
            purchase_date="2026-09-02",
            total_cost=210,
        )

    assert len(list_purchase_records(session)) == 1


def test_purchase_history_is_ordered_by_purchase_date_descending(session: Session) -> None:
    asset = create_asset(session, AssetInput("printer", "HP", "LaserJet", "PUR-ORDER-1"))
    create_purchase_record(
        session,
        asset_id=asset.id,
        supplier="المورد",
        invoice_number="INV-OLD",
        purchase_date="2025-01-01",
        total_cost=100,
    )
    create_purchase_record(
        session,
        asset_id=asset.id,
        supplier="المورد",
        invoice_number="INV-NEW",
        purchase_date="2026-10-01",
        total_cost=150,
    )

    records = list_purchase_records(session)

    assert [item.invoice_number for item in records] == ["INV-NEW", "INV-OLD"]
