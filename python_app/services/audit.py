from __future__ import annotations

import csv
from pathlib import Path
from datetime import timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..models import AuditLog


def _safe_csv_text(value: str | None) -> str:
    text = (value or "").replace("\r", " ").replace("\n", " ").strip()
    if text.startswith(("=", "+", "-", "@", "\t")):
        return "'" + text
    return text


def list_audit_logs(
    session: Session,
    *,
    search: str = "",
    entity_type: str = "",
    action: str = "",
    limit: int = 1000,
) -> list[AuditLog]:
    if not 1 <= limit <= 10000:
        raise ValueError("عدد سجلات التدقيق يجب أن يكون بين 1 و10000.")

    query = select(AuditLog).order_by(
        AuditLog.occurred_at.desc(),
        AuditLog.id.desc(),
    )
    term = search.strip()
    if term:
        pattern = f"%{term}%"
        query = query.where(or_(
            AuditLog.actor_name.ilike(pattern),
            AuditLog.entity_type.ilike(pattern),
            AuditLog.entity_id.ilike(pattern),
            AuditLog.action.ilike(pattern),
            AuditLog.details.ilike(pattern),
        ))
    if entity_type.strip():
        query = query.where(AuditLog.entity_type == entity_type.strip())
    if action.strip():
        query = query.where(AuditLog.action == action.strip())

    return list(session.scalars(query.limit(limit)).all())


def export_audit_logs_to_csv(
    session: Session,
    destination: str | Path,
    *,
    search: str = "",
    entity_type: str = "",
    action: str = "",
    limit: int = 10000,
) -> int:
    rows = list_audit_logs(
        session,
        search=search,
        entity_type=entity_type,
        action=action,
        limit=limit,
    )
    target = Path(destination)
    target.parent.mkdir(parents=True, exist_ok=True)

    with target.open("w", newline="", encoding="utf-8-sig") as stream:
        writer = csv.writer(stream, dialect="excel")
        writer.writerow([
            "التاريخ والوقت UTC",
            "نوع السجل",
            "معرّف السجل",
            "العملية",
            "المستخدم",
            "التفاصيل",
        ])
        for row in rows:
            timestamp = row.occurred_at
            if timestamp.tzinfo is None:
                # SQLite stores timezone-aware UTC values without tzinfo.
                # All application event timestamps are created in UTC.
                timestamp_text = timestamp.replace(tzinfo=timezone.utc).isoformat()
            else:
                timestamp_text = timestamp.astimezone(timezone.utc).isoformat()
            writer.writerow([
                _safe_csv_text(timestamp_text),
                _safe_csv_text(row.entity_type),
                _safe_csv_text(row.entity_id),
                _safe_csv_text(row.action),
                _safe_csv_text(row.actor_name),
                _safe_csv_text(row.details),
            ])
    return len(rows)
