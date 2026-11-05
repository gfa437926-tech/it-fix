from __future__ import annotations

from pathlib import Path

import pytest
from openpyxl import Workbook, load_workbook
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from python_app.models import Asset, AssetMovement, AuditLog, Base, Office
from python_app.services.assets import (
    AssetInput,
    create_asset,
    create_office,
    get_dashboard_summary,
    list_assets,
    retire_asset,
    transfer_asset,
    update_asset,
)
from python_app.services.excel_service import (
    export_assets_to_excel,
    import_assets_from_excel,
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


def test_create_asset_normalizes_serial_and_records_movement(session: Session) -> None:
    office = create_office(session, "المستودع الرئيسي", building="المبنى الأول")
    asset = create_asset(session, AssetInput(
        category="laptop",
        brand="HP",
        model="ProBook",
        serial_number="  sn-100  ",
        office_id=office.id,
    ), actor_name="مدير الاختبار")

    assert asset.serial_number == "SN-100"
    assert asset.serial_key == "SN-100"
    assert asset.office_name == "المستودع الرئيسي"
    movement = session.scalar(select(AssetMovement).where(AssetMovement.asset_id == asset.id))
    assert movement is not None
    assert movement.movement_type == "registered"


def test_duplicate_serial_is_rejected_case_insensitively(session: Session) -> None:
    create_asset(session, AssetInput("desktop", "Dell", "OptiPlex", "D-001"))
    with pytest.raises(ValueError, match="مسجل مسبقاً"):
        create_asset(session, AssetInput("desktop", "HP", "EliteDesk", " d-001 "))

    assert len(list_assets(session)) == 1


def test_update_asset_can_change_unique_serial(session: Session) -> None:
    asset = create_asset(session, AssetInput("desktop", "Dell", "OptiPlex", "OLD-1"))
    updated = update_asset(session, asset.id, AssetInput(
        "desktop", "Dell", "OptiPlex 7010", "NEW-1", status="available"
    ))

    assert updated.model == "OptiPlex 7010"
    assert updated.serial_number == "NEW-1"
    assert session.scalar(select(Asset.id).where(Asset.serial_key == "OLD-1")) is None


def test_transfer_requires_available_asset_and_active_office(session: Session) -> None:
    source = create_office(session, "المستودع")
    destination = create_office(session, "قسم الشبكات", building="المبنى الإداري")
    asset = create_asset(session, AssetInput(
        "laptop", "Lenovo", "ThinkPad", "L-1", office_id=source.id
    ))

    transferred = transfer_asset(session, asset.id, destination.id, "نقل بطلب الإدارة")
    assert transferred.office_id == destination.id
    assert transferred.transferred_at is not None
    movement = session.scalar(select(AssetMovement).where(
        AssetMovement.asset_id == asset.id,
        AssetMovement.movement_type == "transferred",
    ))
    assert movement is not None
    assert movement.from_office_id == source.id
    assert movement.to_office_id == destination.id


def test_retire_asset_requires_reason_and_blocks_assigned_asset(session: Session) -> None:
    available = create_asset(session, AssetInput("monitor", "Dell", "P2422H", "M-1"))
    with pytest.raises(ValueError, match="سبب الاستبعاد"):
        retire_asset(session, available.id, " ")

    retired = retire_asset(session, available.id, "تلف غير قابل للإصلاح")
    assert retired.status == "retired"
    assert retired.retirement_reason == "تلف غير قابل للإصلاح"

    assigned = create_asset(session, AssetInput(
        "desktop", "HP", "ProDesk", "D-2", status="assigned"
    ))
    with pytest.raises(ValueError, match="إغلاق العهدة"):
        retire_asset(session, assigned.id, "غير صالح")


def test_dashboard_counts_assets_and_offices(session: Session) -> None:
    create_office(session, "المكتب الأول")
    create_asset(session, AssetInput("desktop", "Dell", "A", "A-1", status="available"))
    create_asset(session, AssetInput("laptop", "HP", "B", "B-1", status="assigned"))
    create_asset(session, AssetInput("printer", "HP", "C", "C-1", status="maintenance"))

    summary = get_dashboard_summary(session)
    assert summary.total_assets == 3
    assert summary.available == 1
    assert summary.assigned == 1
    assert summary.maintenance == 1
    assert summary.active_offices == 1


def test_excel_import_reports_duplicates_and_skips_invalid_rows(
    session: Session, tmp_path: Path
) -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "الأصول"
    sheet.append(["الفئة", "الشركة المصنعة", "الطراز", "الرقم التسلسلي", "المكتب"])
    sheet.append(["لابتوب", "HP", "ProBook", "EX-001", "المستودع"])
    sheet.append(["كمبيوتر مكتبي", "Dell", "OptiPlex", "EX-001", "المستودع"])
    sheet.append(["شاشة", "", "P2422H", "EX-003", "المستودع"])
    file_path = tmp_path / "assets.xlsx"
    workbook.save(file_path)

    result = import_assets_from_excel(session, file_path, "مدير الاختبار")

    assert result.total_rows == 3
    assert result.succeeded_rows == 1
    assert result.failed_rows == 1
    assert result.skipped_rows == 1
    assert any("مسجل مسبقاً" in message for message in result.row_errors)


def test_excel_export_preserves_inventory_and_writes_arabic_headers(
    session: Session, tmp_path: Path
) -> None:
    create_asset(session, AssetInput("laptop", "HP", "ProBook", "EX-100"))
    file_path = tmp_path / "export.xlsx"

    exported = export_assets_to_excel(session, file_path)

    assert exported == 1
    workbook = load_workbook(file_path, read_only=True, data_only=True)
    try:
        sheet = workbook.active
        assert sheet["A1"].value == "الفئة"
        assert sheet["B2"].value == "HP"
        assert sheet["D2"].value == "EX-100"
    finally:
        workbook.close()


def test_excel_export_escapes_formula_like_text(session: Session, tmp_path: Path) -> None:
    create_asset(session, AssetInput("other", "=HYPERLINK", "Model", "FORM-1"))
    file_path = tmp_path / "safe.xlsx"
    export_assets_to_excel(session, file_path)

    workbook = load_workbook(file_path, read_only=True, data_only=True)
    try:
        assert workbook.active["B2"].value == "'=HYPERLINK"
    finally:
        workbook.close()


def test_office_duplicate_location_is_rejected(session: Session) -> None:
    create_office(session, "قسم الحاسوب", building="المبنى الرئيسي", room="12")
    with pytest.raises(ValueError, match="مسجل مسبقاً"):
        create_office(session, "قسم الحاسوب", building="المبنى الرئيسي", room="12")

def test_update_asset_cannot_bypass_custody_or_maintenance_status_workflows(
    session: Session,
) -> None:
    asset = create_asset(
        session, AssetInput("laptop", "Lenovo", "ThinkPad", "STATUS-1")
    )

    with pytest.raises(ValueError, match="إجراءات العهدة والصيانة"):
        update_asset(
            session,
            asset.id,
            AssetInput(
                "laptop", "Lenovo", "ThinkPad", "STATUS-1", status="assigned"
            ),
        )

    session.refresh(asset)
    assert asset.status == "available"
    assert session.scalar(
        select(AssetMovement).where(
            AssetMovement.asset_id == asset.id,
            AssetMovement.movement_type == "assigned",
        )
    ) is None
