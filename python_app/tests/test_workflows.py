from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from python_app.models import (
    Asset,
    AssetMovement,
    AuditLog,
    Base,
    CustodyCard,
    MaintenancePartUsage,
    MaintenanceRecord,
    SparePart,
)
from python_app.services.assets import AssetInput, create_asset, create_office
from python_app.services.workflows import (
    CustodyItemInput,
    approve_custody_card,
    consume_spare_part,
    create_custody_card,
    create_spare_part,
    open_maintenance_ticket,
    reject_custody_card,
    return_custody_card,
    update_maintenance_ticket,
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


def test_custody_card_approval_assigns_asset_and_return_releases_it(session: Session) -> None:
    office = create_office(session, "قسم المعلوماتية", building="المبنى الرئيسي")
    asset = create_asset(session, AssetInput(
        "laptop", "Lenovo", "ThinkPad", "TH-100", office_id=office.id
    ))
    card = create_custody_card(
        session,
        card_number="CR-2001",
        responsible_name="أحمد محمد",
        office_name=office.name,
        items=[CustodyItemInput("حاسوب محمول", asset_id=asset.id)],
    )

    assert card.approval_status == "pending"
    assert session.get(Asset, asset.id).status == "available"

    approved = approve_custody_card(session, card.id, "رئيس القسم")
    assert approved.approval_status == "approved"
    assert session.get(Asset, asset.id).status == "assigned"

    returned = return_custody_card(session, card.id, "أمين المستودع", "إرجاع سليم")
    assert returned.status == "returned"
    assert session.get(Asset, asset.id).status == "returned"

    movements = session.scalars(
        select(AssetMovement).where(AssetMovement.asset_id == asset.id)
    ).all()
    assert {item.movement_type for item in movements} >= {"registered", "assigned", "returned"}


def test_rejected_custody_card_does_not_change_asset_status(session: Session) -> None:
    asset = create_asset(session, AssetInput("monitor", "Dell", "P2422H", "MON-1"))
    card = create_custody_card(
        session,
        card_number="CR-2002",
        responsible_name="سارة",
        office_name="الإدارة",
        items=[CustodyItemInput("شاشة", asset_id=asset.id)],
    )

    rejected = reject_custody_card(session, card.id, "المراجع", "الموظف غير تابع للقسم")

    assert rejected.approval_status == "rejected"
    assert rejected.status == "rejected"
    assert session.get(Asset, asset.id).status == "available"


def test_custody_approval_revalidates_asset_availability(session: Session) -> None:
    asset = create_asset(session, AssetInput("desktop", "HP", "ProDesk", "PC-4"))
    card = create_custody_card(
        session,
        card_number="CR-2003",
        responsible_name="مستخدم",
        office_name="قسم الشبكات",
        items=[CustodyItemInput("حاسوب مكتبي", asset_id=asset.id)],
    )
    with session.begin():
        current = session.get(Asset, asset.id)
        current.status = "maintenance"

    with pytest.raises(ValueError, match="لم يعد متاحاً"):
        approve_custody_card(session, card.id, "رئيس القسم")

    refreshed = session.get(CustodyCard, card.id)
    assert refreshed.approval_status == "pending"


def test_maintenance_restores_previous_asset_status_and_records_resolution(session: Session) -> None:
    asset = create_asset(session, AssetInput("laptop", "HP", "ProBook", "HP-22"))
    ticket = open_maintenance_ticket(
        session, asset.id, "استبدال لوحة المفاتيح", "بعض المفاتيح لا تستجيب",
        priority="high", technician="فني الصيانة",
    )
    assert session.get(Asset, asset.id).status == "maintenance"

    update_maintenance_ticket(
        session, ticket.id, "inProgress", "مدير الصيانة", technician="الفني المناوب"
    )
    completed = update_maintenance_ticket(
        session, ticket.id, "completed", "مدير الصيانة",
        resolution="تم استبدال لوحة المفاتيح واختبار الجهاز", cost=125,
    )

    assert completed.status == "completed"
    assert completed.cost == 125
    assert session.get(Asset, asset.id).status == "available"
    movement_types = {
        row.movement_type for row in session.scalars(
            select(AssetMovement).where(AssetMovement.asset_id == asset.id)
        ).all()
    }
    assert {"maintenance_opened", "maintenance_completed"} <= movement_types


def test_maintenance_restores_assigned_status_after_repair(session: Session) -> None:
    asset = create_asset(session, AssetInput(
        "desktop", "Dell", "OptiPlex", "DEL-ASSIGNED", status="assigned"
    ))
    ticket = open_maintenance_ticket(
        session, asset.id, "عطل مزود الطاقة", "الجهاز لا يعمل"
    )
    update_maintenance_ticket(
        session, ticket.id, "completed", resolution="تم تبديل مزود الطاقة"
    )
    assert session.get(Asset, asset.id).status == "assigned"


def test_spare_part_consumption_updates_stock_and_maintenance_cost(session: Session) -> None:
    asset = create_asset(session, AssetInput("printer", "HP", "M404dn", "PR-9"))
    ticket = open_maintenance_ticket(
        session, asset.id, "صيانة وحدة السحب", "تحتاج إلى رول سحب"
    )
    part = create_spare_part(
        session, "رول سحب ورق", "HP-ROLLER-01",
        quantity=5, minimum_quantity=1, unit_cost=35,
    )

    usage = consume_spare_part(session, part.id, ticket.id, 2, "تركيب قطعتين", "الفني")

    refreshed_part = session.get(SparePart, part.id)
    refreshed_ticket = session.get(MaintenanceRecord, ticket.id)
    assert refreshed_part.quantity == 3
    assert refreshed_ticket.parts_cost == 70
    assert usage.total_cost == 70
    assert session.scalar(select(MaintenancePartUsage.id).where(
        MaintenancePartUsage.maintenance_id == ticket.id
    )) is not None


def test_spare_part_consumption_rejects_insufficient_stock_without_mutation(session: Session) -> None:
    asset = create_asset(session, AssetInput("printer", "HP", "M404dn", "PR-10"))
    ticket = open_maintenance_ticket(session, asset.id, "صيانة", "عطل")
    part = create_spare_part(session, "حبر", "TONER-1", 1, 0, 50)

    with pytest.raises(ValueError, match="لا يكفي"):
        consume_spare_part(session, part.id, ticket.id, 2)

    assert session.get(SparePart, part.id).quantity == 1
    assert session.get(MaintenanceRecord, ticket.id).parts_cost == 0


def test_closed_maintenance_ticket_cannot_consume_parts(session: Session) -> None:
    asset = create_asset(session, AssetInput("desktop", "Dell", "OptiPlex", "PC-closed"))
    ticket = open_maintenance_ticket(session, asset.id, "صيانة", "عطل")
    part = create_spare_part(session, "مروحة", "FAN-01", 3, 1, 20)
    update_maintenance_ticket(session, ticket.id, "completed", resolution="تم الإصلاح")

    with pytest.raises(ValueError, match="مغلق"):
        consume_spare_part(session, part.id, ticket.id, 1)

    assert session.get(SparePart, part.id).quantity == 3
