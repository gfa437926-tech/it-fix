from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import Engine
from sqlalchemy.engine import make_url

from ..config import DATA_DIR
from .documents import MAX_DOCUMENT_SIZE_BYTES


@dataclass(frozen=True, slots=True)
class BackupResult:
    file_path: Path
    database_type: str
    database_bytes: int
    attachment_count: int
    archive_bytes: int
    created_at_utc: datetime


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sqlite_snapshot(engine: Engine, destination: Path) -> None:
    with engine.connect() as source:
        raw_connection = source.connection.driver_connection
        target = sqlite3.connect(destination)
        try:
            raw_connection.backup(target)
            target.commit()
        finally:
            target.close()


def _postgres_snapshot(engine: Engine, destination: Path) -> None:
    pg_dump = shutil.which("pg_dump")
    if not pg_dump:
        raise RuntimeError(
            "لم يتم العثور على pg_dump. ثبّت أدوات PostgreSQL Client ثم أعد إنشاء النسخة الاحتياطية."
        )

    url = make_url(str(engine.url))
    if not url.host or not url.database or not url.username:
        raise RuntimeError("عنوان اتصال PostgreSQL لا يحتوي اسم المضيف والقاعدة والمستخدم.")

    environment = os.environ.copy()
    if url.password:
        environment["PGPASSWORD"] = url.password

    sslmode = url.query.get("sslmode")
    if isinstance(sslmode, list):
        sslmode = sslmode[0] if sslmode else None
    if sslmode:
        environment["PGSSLMODE"] = str(sslmode)

    command = [
        pg_dump,
        "--format=custom",
        "--no-owner",
        "--no-acl",
        "--no-password",
        "--host", url.host,
        "--port", str(url.port or 5432),
        "--username", url.username,
        "--dbname", url.database,
        "--file", str(destination),
    ]
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        env=environment,
        timeout=600,
        check=False,
    )
    if result.returncode != 0:
        destination.unlink(missing_ok=True)
        detail = (result.stderr or result.stdout or "سبب غير معروف").strip()
        raise RuntimeError("فشل pg_dump في إنشاء نسخة قاعدة البيانات: " + detail[-1200:])


def create_backup_archive(
    destination: str | Path,
    *,
    database_engine: Engine,
    data_directory: str | Path = DATA_DIR,
) -> BackupResult:
    """Create a consistent database snapshot and include asset attachments.

    The ZIP is intentionally not password-encrypted. It contains the complete
    database snapshot and any local asset attachments; the operator must store
    it in an access-controlled location.
    """
    output = Path(destination).expanduser().resolve()
    if output.suffix.lower() != ".zip":
        raise ValueError("يجب أن يكون اسم النسخة الاحتياطية بامتداد .zip.")
    output.parent.mkdir(parents=True, exist_ok=True)

    database_type = database_engine.dialect.name
    if database_type not in {"sqlite", "postgresql"}:
        raise ValueError("نوع قاعدة البيانات غير مدعوم للنسخ الاحتياطي.")

    created_at = datetime.now(timezone.utc)
    with tempfile.TemporaryDirectory(prefix="itfix-backup-") as temporary:
        staging = Path(temporary)
        database_name = "itfix_assets.sqlite3" if database_type == "sqlite" else "itfix_assets.dump"
        database_file = staging / database_name
        if database_type == "sqlite":
            _sqlite_snapshot(database_engine, database_file)
        else:
            _postgres_snapshot(database_engine, database_file)

        database_bytes = database_file.stat().st_size
        if database_bytes <= 0:
            raise RuntimeError("ملف قاعدة البيانات الاحتياطي فارغ.")

        data_root = Path(data_directory).resolve()
        documents_root = data_root / "documents"
        attachment_files: list[Path] = []
        if documents_root.exists():
            for candidate in documents_root.rglob("*"):
                if candidate.is_symlink():
                    raise ValueError("لا يمكن تضمين رابط رمزي داخل النسخة الاحتياطية.")
                if candidate.is_file():
                    resolved = candidate.resolve()
                    if documents_root not in resolved.parents:
                        raise ValueError("أحد المرفقات يشير إلى مسار خارج مجلد التخزين.")
                    attachment_files.append(resolved)

        manifest = {
            "application": "IT Fix Asset Inventory",
            "format_version": 1,
            "created_at_utc": created_at.isoformat(),
            "database_type": database_type,
            "database_file": "database/" + database_name,
            "database_size_bytes": database_bytes,
            "database_sha256": _sha256(database_file),
            "attachments": [
                {
                    "path": "data/documents/" + item.relative_to(documents_root.resolve()).as_posix(),
                    "size_bytes": item.stat().st_size,
                    "sha256": _sha256(item),
                }
                for item in attachment_files
            ],
            "encrypted": False,
        }

        try:
            with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                archive.write(database_file, manifest["database_file"])
                for item in attachment_files:
                    archive.write(
                        item,
                        "data/documents/" + item.relative_to(documents_root.resolve()).as_posix(),
                    )
                archive.writestr(
                    "manifest.json",
                    json.dumps(manifest, ensure_ascii=False, indent=2),
                )
        except Exception:
            output.unlink(missing_ok=True)
            raise

    return BackupResult(
        file_path=output,
        database_type=database_type,
        database_bytes=database_bytes,
        attachment_count=len(attachment_files),
        archive_bytes=output.stat().st_size,
        created_at_utc=created_at,
    )
