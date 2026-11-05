from __future__ import annotations

import csv
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from python_app.models import AuditLog, Base
from python_app.services.audit import export_audit_logs_to_csv, list_audit_logs


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


def add_audit(
    session: Session,
    *,
    entity_type: str,
    entity_id: str,
    action: str,
    actor_name: str,
    details: str,
    occurred_at: datetime,
) -> AuditLog:
    row = AuditLog(
        entity_type=entity_type,
        entity_id=entity_id,
        action=action,
        actor_name=actor_name,
        details=details,
        occurred_at=occurred_at,
    )
    session.add(row)
    session.commit()
    return row


def test_audit_history_is_newest_first_and_supports_combined_search(session: Session) -> None:
    older = add_audit(
        session,
        entity_type="asset",
        entity_id="asset-1",
        action="created",
        actor_name="مدير المخزن",
        details="إضافة حاسوب محمول",
        occurred_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    newer = add_audit(
        session,
        entity_type="custody_card",
        entity_id="custody-1",
        action="approved",
        actor_name="رئيس القسم",
        details="اعتماد بطاقة أحمد",
        occurred_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
    )

    rows = list_audit_logs(session)
    assert [row.id for row in rows] == [newer.id, older.id]
    assert list_audit_logs(session, search="أحمد") == [newer]
    assert list_audit_logs(session, entity_type="asset") == [older]
    assert list_audit_logs(session, action="approved") == [newer]
    assert list_audit_logs(session, search="رئيس", action="approved") == [newer]


@pytest.mark.parametrize("limit", [0, -1, 10001])
def test_audit_history_rejects_unsafe_or_unbounded_limits(session: Session, limit: int) -> None:
    with pytest.raises(ValueError, match="بين 1 و10000"):
        list_audit_logs(session, limit=limit)


def test_csv_export_uses_arabic_headers_utf8_bom_and_escapes_formulas(
    session: Session,
    tmp_path: Path,
) -> None:
    add_audit(
        session,
        entity_type="asset",
        entity_id="asset-2",
        action="created",
        actor_name="=HYPERLINK(\"https://example.invalid\")",
        details="  +SUM(1,2)\nتفاصيل إضافية",
        occurred_at=datetime(2026, 11, 5, 12, 30, tzinfo=timezone.utc),
    )
    destination = tmp_path / "reports" / "audit.csv"

    exported = export_audit_logs_to_csv(session, destination)

    assert exported == 1
    raw = destination.read_bytes()
    assert raw.startswith(b"\xef\xbb\xbf")
    text = raw.decode("utf-8-sig")
    rows = list(csv.reader(text.splitlines()))
    assert rows[0] == [
        "التاريخ والوقت UTC",
        "نوع السجل",
        "معرّف السجل",
        "العملية",
        "المستخدم",
        "التفاصيل",
    ]
    assert rows[1][0] == "2026-11-05T12:30:00+00:00"
    assert rows[1][4].startswith("'=")
    assert rows[1][5].startswith("'+SUM")
    assert "تفاصيل إضافية" in rows[1][5]


def test_filtered_csv_export_contains_only_matching_records(
    session: Session,
    tmp_path: Path,
) -> None:
    add_audit(
        session,
        entity_type="asset",
        entity_id="asset-a",
        action="created",
        actor_name="مدير",
        details="إضافة أصل",
        occurred_at=datetime(2026, 3, 1, tzinfo=timezone.utc),
    )
    add_audit(
        session,
        entity_type="office",
        entity_id="office-b",
        action="updated",
        actor_name="مدير",
        details="تعديل موقع",
        occurred_at=datetime(2026, 3, 2, tzinfo=timezone.utc),
    )
    destination = tmp_path / "filtered.csv"

    assert export_audit_logs_to_csv(session, destination, search="موقع") == 1

    with destination.open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    assert len(rows) == 1
    assert rows[0]["معرّف السجل"] == "office-b"
