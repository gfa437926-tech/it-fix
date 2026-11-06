from __future__ import annotations

from pathlib import Path

from openpyxl import load_workbook
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from python_app.models import Asset, Base
from python_app.services.assets import AssetInput, create_asset, create_office
from python_app.services.documents import attach_asset_document
from python_app.services.purchases import create_purchase_record
from python_app.services.reports import export_management_report
from python_app.services.workflows import (
    CustodyItemInput,
    approve_custody_card,
    create_custody_card,
    create_spare_part,
    open_maintenance_ticket,
)


def make_session() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    return factory()


def test_management_report_contains_operational_sheets_and_counts(tmp_path: Path) -> None:
    session = make_session()
    try:
        office = create_office(session, "قسم تقنية المعلومات", building="المبنى الرئيسي")
        asset = create_asset(session, AssetInput(
            "laptop", "HP", "ProBook", "RPT-100", office_id=office.id
        ))
        card = create_custody_card(
            session,
            card_number="RPT-CARD-1",
            responsible_name="موظف الاختبار",
            office_name=office.name,
            items=[CustodyItemInput("حاسوب محمول", asset_id=asset.id)],
        )
        approve_custody_card(session, card.id, "مدير الاختبار")
        with session.begin():
            checked_asset = session.get(Asset, asset.id)
            assert checked_asset is not None
            checked_asset.status = "returned"

        ticket = open_maintenance_ticket(
            session, asset.id, "فحص الجهاز", "صوت غير طبيعي من المروحة"
        )
        create_spare_part(session, "مروحة حاسوب", "FAN-RPT-1", 4, 1, 20)
        create_purchase_record(
            session,
            asset_id=asset.id,
            supplier="مورد التقارير",
            invoice_number="INV-RPT-1",
            purchase_date="2026-11-01",
            warranty_until="2027-11-01",
            total_cost=950,
        )
        file = tmp_path / "invoice.pdf"
        file.write_bytes(b"%PDF-1.7\nreport test\n%%EOF")
        attach_asset_document(
            session,
            asset_id=asset.id,
            source_path=file,
            uploaded_by="مدير الاختبار",
            document_type="invoice",
            storage_root=tmp_path / "local-data",
        )

        target = tmp_path / "management-report.xlsx"
        sheet_count = export_management_report(session, target)

        assert sheet_count >= 10
        workbook = load_workbook(target, read_only=True, data_only=True)
        try:
            names = set(workbook.sheetnames)
            assert {
                "الملخص", "الأصول", "المكاتب", "تحليل المكاتب", "بطاقات العهدة",
                "بنود العهدة", "الصيانة", "قطع الغيار",
                "المشتريات والضمان", "المرفقات", "الحركات", "التدقيق",
            } <= names
            overview = {
                workbook["الملخص"].cell(row, 1).value: workbook["الملخص"].cell(row, 2).value
                for row in range(2, workbook["الملخص"].max_row + 1)
            }
            assert overview["إجمالي الأصول"] == 1
            assert overview["بطاقات العهدة"] == 1
            assert overview["طلبات الصيانة"] == 1
            assert workbook["الأصول"]["E2"].value == "RPT-100"
            assert workbook["بطاقات العهدة"]["B2"].value == "RPT-CARD-1"
            assert workbook["الصيانة"]["D2"].value == "فحص الجهاز"
            assert workbook["المشتريات والضمان"]["E2"].value == "INV-RPT-1"
            office_analysis = workbook["تحليل المكاتب"]
            assert office_analysis["A2"].value == office.name
            assert office_analysis["B2"].value == 1
            assert office_analysis["E2"].value == 950
        finally:
            workbook.close()
    finally:
        session.close()


def test_management_report_sanitizes_formula_like_text(tmp_path: Path) -> None:
    session = make_session()
    try:
        create_asset(session, AssetInput(
            "other", "=HYPERLINK", "Model", "RPT-FORMULA"
        ))
        target = tmp_path / "safe-report.xlsx"
        export_management_report(session, target)

        workbook = load_workbook(target, read_only=True, data_only=True)
        try:
            assert workbook["الأصول"]["C2"].value == "'=HYPERLINK"
        finally:
            workbook.close()
    finally:
        session.close()



def test_failed_management_report_export_preserves_existing_file(
    tmp_path: Path, monkeypatch
) -> None:
    session = make_session()
    target = tmp_path / "management-report.xlsx"
    original = b"previous valid report bytes"
    target.write_bytes(original)

    def fail_save(_workbook, _path) -> None:
        raise OSError("simulated disk write failure")

    monkeypatch.setattr("python_app.services.reports.Workbook.save", fail_save)
    try:
        import pytest

        with pytest.raises(OSError, match="simulated disk write failure"):
            export_management_report(session, target)
        assert target.read_bytes() == original
        assert list(tmp_path.glob(".management-report.*.tmp.xlsx")) == []
    finally:
        session.close()


def test_management_report_filters_dated_records_and_validates_range(tmp_path: Path) -> None:
    import pytest
    from datetime import date

    session = make_session()
    try:
        asset = create_asset(session, AssetInput("other", "Test", "Date range", "RPT-DATE"))
        create_purchase_record(
            session, asset_id=asset.id, supplier="Vendor", invoice_number="OLD-INV",
            purchase_date="2024-01-15", warranty_until=None, total_cost=100,
        )
        create_purchase_record(
            session, asset_id=asset.id, supplier="Vendor", invoice_number="NEW-INV",
            purchase_date="2026-11-02", warranty_until=None, total_cost=200,
        )
        target = tmp_path / "date-filtered.xlsx"
        export_management_report(session, target, date_from=date(2026, 1, 1), date_to=date(2026, 12, 31))
        workbook = load_workbook(target, read_only=True, data_only=True)
        try:
            invoices = [workbook["المشتريات والضمان"].cell(row, 5).value
                       for row in range(2, workbook["المشتريات والضمان"].max_row + 1)]
            assert invoices == ["NEW-INV"]
            overview_rows = {
                workbook["الملخص"].cell(row, 1).value: workbook["الملخص"].cell(row, 2).value
                for row in range(2, workbook["الملخص"].max_row + 1)
            }
            assert overview_rows["فترة التقرير"] == "2026-01-01 — 2026-12-31"
            assert "لقطة حالية" in overview_rows["ملاحظة"]
            assert overview_rows["إجمالي قيمة المشتريات ضمن الفترة"] == 200
            assert overview_rows["إجمالي تكلفة الصيانة ضمن الفترة"] == 0
        finally:
            workbook.close()
        with pytest.raises(ValueError, match="تاريخ البداية"):
            export_management_report(session, tmp_path / "invalid.xlsx", date_from=date(2026, 12, 1), date_to=date(2026, 1, 1))
    finally:
        session.close()
