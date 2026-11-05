from __future__ import annotations

import hashlib
import hmac
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
    if output.exists():
        raise FileExistsError("ملف النسخة الاحتياطية موجود مسبقاً؛ اختر اسماً آخر حتى لا تُستبدل نسخة سابقة.")

    data_root = Path(data_directory).expanduser().resolve()
    documents_root = (data_root / "documents").resolve()
    if output == documents_root or documents_root in output.parents:
        raise ValueError("احفظ النسخة الاحتياطية خارج مجلد مرفقات الأصول.")
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


@dataclass(frozen=True, slots=True)
class BackupVerificationResult:
    archive_path: Path
    database_type: str
    database_bytes: int
    attachment_count: int
    created_at_utc: str


@dataclass(frozen=True, slots=True)
class RestoreResult:
    database_path: Path
    documents_directory: Path
    restored_attachment_count: int
    safety_backup_path: Path


def _safe_zip_member(name: str) -> bool:
    if (
        not name
        or "\\\\" in name
        or "\\x00" in name
        or ":" in name
        or name.startswith("/")
        or any(ord(character) < 32 for character in name)
    ):
        return False
    parts = name.split("/")
    return all(part not in {"", ".", ".."} for part in parts)


def _zip_member_digest(archive: zipfile.ZipFile, member: str) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with archive.open(member, "r") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def verify_backup_archive(archive_path: str | Path) -> BackupVerificationResult:
    source = Path(archive_path).expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError("ملف النسخة الاحتياطية غير موجود.")

    try:
        with zipfile.ZipFile(source, "r") as archive:
            infos = archive.infolist()
            names = [item.filename for item in infos]
            if len(names) != len(set(names)):
                raise ValueError("الأرشيف يحتوي أسماء ملفات مكررة.")
            for info in infos:
                if not _safe_zip_member(info.filename):
                    raise ValueError("الأرشيف يحتوي مسار ملف غير آمن.")
                mode = (info.external_attr >> 16) & 0o170000
                if mode == 0o120000:
                    raise ValueError("الأرشيف يحتوي رابطاً رمزياً غير مسموح.")
            bad_member = archive.testzip()
            if bad_member:
                raise ValueError("ملف ZIP تالف عند التحقق من: " + bad_member)
            if "manifest.json" not in names:
                raise ValueError("ملف manifest.json غير موجود في النسخة الاحتياطية.")

            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
            if manifest.get("application") != "IT Fix Asset Inventory":
                raise ValueError("الملف ليس نسخة احتياطية معروفة من IT Fix.")
            if manifest.get("format_version") != 1:
                raise ValueError("إصدار تنسيق النسخة الاحتياطية غير مدعوم.")

            database_type = manifest.get("database_type")
            if database_type not in {"sqlite", "postgresql"}:
                raise ValueError("نوع قاعدة البيانات في manifest غير معروف.")
            database_member = manifest.get("database_file")
            expected_db_name = "itfix_assets.sqlite3" if database_type == "sqlite" else "itfix_assets.dump"
            if database_member != "database/" + expected_db_name or database_member not in names:
                raise ValueError("مسار ملف قاعدة البيانات داخل الأرشيف غير صالح.")

            database_bytes, database_hash = _zip_member_digest(archive, database_member)
            if database_bytes != manifest.get("database_size_bytes"):
                raise ValueError("حجم ملف قاعدة البيانات لا يطابق manifest.")
            if not hmac.compare_digest(database_hash, str(manifest.get("database_sha256", ""))):
                raise ValueError("بصمة قاعدة البيانات لا تطابق manifest.")

            attachments = manifest.get("attachments")
            if not isinstance(attachments, list):
                raise ValueError("قائمة المرفقات في manifest غير صالحة.")
            seen_attachments: set[str] = set()
            for item in attachments:
                if not isinstance(item, dict):
                    raise ValueError("بيانات أحد المرفقات غير صالحة.")
                member = item.get("path")
                if not isinstance(member, str) or not member.startswith("data/documents/"):
                    raise ValueError("مسار أحد المرفقات خارج مجلد المستندات.")
                if not _safe_zip_member(member) or member in seen_attachments or member not in names:
                    raise ValueError("الأرشيف يحتوي مسار مرفق غير صالح أو مكرراً.")
                seen_attachments.add(member)
                size, digest = _zip_member_digest(archive, member)
                if size != item.get("size_bytes"):
                    raise ValueError("حجم أحد المرفقات لا يطابق manifest.")
                if not hmac.compare_digest(digest, str(item.get("sha256", ""))):
                    raise ValueError("بصمة أحد المرفقات لا تطابق manifest.")

            return BackupVerificationResult(
                archive_path=source,
                database_type=database_type,
                database_bytes=database_bytes,
                attachment_count=len(attachments),
                created_at_utc=str(manifest.get("created_at_utc", "")),
            )
    except zipfile.BadZipFile as exc:
        raise ValueError("ملف النسخة الاحتياطية ليس أرشيف ZIP صالحاً.") from exc
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError) as exc:
        raise ValueError("ملف manifest داخل النسخة الاحتياطية غير صالح.") from exc


def restore_sqlite_backup_archive(
    archive_path: str | Path,
    *,
    database_engine: Engine,
    data_directory: str | Path = DATA_DIR,
    confirmed: bool = False,
    safety_backup_path: str | Path | None = None,
) -> RestoreResult:
    """Restore a verified SQLite archive after creating a safety backup.

    This operation is intentionally separate from the running desktop UI.
    The caller must explicitly confirm that all application instances are closed.
    """
    if not confirmed:
        raise ValueError("الاستعادة تحتاج تأكيداً صريحاً بعد إغلاق جميع نوافذ التطبيق.")
    if database_engine.dialect.name != "sqlite":
        raise ValueError("الاستعادة التلقائية متاحة حالياً لقاعدة SQLite فقط؛ PostgreSQL يحتاج pg_restore يدوياً.")

    verified = verify_backup_archive(archive_path)
    if verified.database_type != "sqlite":
        raise ValueError("نوع النسخة الاحتياطية لا يطابق قاعدة SQLite المستهدفة.")

    configured_database = database_engine.url.database
    if not configured_database or configured_database == ":memory:":
        raise ValueError("لا يمكن استعادة نسخة إلى قاعدة SQLite مؤقتة داخل الذاكرة.")
    database_path = Path(configured_database).expanduser().resolve()
    if not database_path.is_file():
        raise FileNotFoundError("ملف قاعدة البيانات الحالية غير موجود؛ لا يمكن إنشاء نسخة أمان قبل الاستعادة.")

    data_root = Path(data_directory).expanduser().resolve()
    documents_directory = (data_root / "documents").resolve()
    archive_source = Path(archive_path).expanduser().resolve()
    if archive_source == documents_directory or documents_directory in archive_source.parents:
        raise ValueError("لا تستعد من ملف موجود داخل مجلد المرفقات؛ سيتم استبدال هذا المجلد أثناء الاستعادة.")
    created_at = datetime.now(timezone.utc)
    if safety_backup_path is None:
        safety_path = database_path.parent / (
            "ITFix-Before-Restore-" + created_at.strftime("%Y%m%d-%H%M%S") + ".zip"
        )
    else:
        safety_path = Path(safety_backup_path).expanduser().resolve()
    if safety_path == archive_source:
        raise ValueError("لا يجوز الكتابة فوق ملف النسخة التي ستتم استعادتها.")
    if safety_path == documents_directory or documents_directory in safety_path.parents:
        raise ValueError("احفظ نسخة الأمان خارج مجلد المرفقات الذي ستتم استعادته.")
    if safety_path.exists():
        raise FileExistsError("ملف نسخة الأمان موجود مسبقاً؛ اختر اسماً آخر حتى لا تُستبدل نسخة سابقة.")

    safety = create_backup_archive(
        safety_path,
        database_engine=database_engine,
        data_directory=data_root,
    )

    database_path.parent.mkdir(parents=True, exist_ok=True)
    data_root.mkdir(parents=True, exist_ok=True)
    documents_staging = Path(tempfile.mkdtemp(prefix=".itfix-documents-restore-", dir=data_root.parent))
    database_fd, database_staging_name = tempfile.mkstemp(
        prefix=".itfix-database-restore-",
        suffix=".sqlite3",
        dir=database_path.parent,
    )
    os.close(database_fd)
    database_staging = Path(database_staging_name)
    original_documents = documents_staging.with_name(documents_staging.name + "-original")
    moved_original_documents = False
    installed_documents = False

    try:
        with zipfile.ZipFile(verified.archive_path, "r") as archive:
            with archive.open("database/itfix_assets.sqlite3", "r") as input_stream, database_staging.open("wb") as output_stream:
                shutil.copyfileobj(input_stream, output_stream, length=1024 * 1024)

            integrity_connection = sqlite3.connect(database_staging)
            try:
                integrity = integrity_connection.execute("PRAGMA integrity_check").fetchone()
            finally:
                integrity_connection.close()
            if not integrity or integrity[0] != "ok":
                raise ValueError("فشل فحص سلامة قاعدة البيانات الموجودة داخل النسخة.")
            with sqlite3.connect(database_staging) as schema_connection:
                restored_tables = {
                    row[0] for row in schema_connection.execute(
                        "select name from sqlite_master where type='table'"
                    ).fetchall()
                }
            required_tables = {
                "offices", "assets", "asset_movements", "import_batches",
                "audit_logs", "app_users", "custody_cards", "custody_items",
                "maintenance_records", "spare_parts", "maintenance_part_usage",
                "purchase_records", "asset_documents",
            }
            missing_tables = sorted(required_tables - restored_tables)
            if missing_tables:
                raise ValueError(
                    "مخطط قاعدة البيانات داخل النسخة ناقص الجداول: "
                    + ", ".join(missing_tables)
                )

            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
            for item in manifest["attachments"]:
                member = item["path"]
                relative = Path(member.removeprefix("data/documents/"))
                if relative.is_absolute() or ".." in relative.parts:
                    raise ValueError("مسار مرفق غير آمن أثناء الاستعادة.")
                target = documents_staging / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member, "r") as input_stream, target.open("xb") as output_stream:
                    shutil.copyfileobj(input_stream, output_stream, length=1024 * 1024)

        database_engine.dispose()
        if documents_directory.exists():
            os.replace(documents_directory, original_documents)
            moved_original_documents = True
        os.replace(documents_staging, documents_directory)
        installed_documents = True
        os.replace(database_staging, database_path)
    except Exception:
        if installed_documents:
            shutil.rmtree(documents_directory, ignore_errors=True)
        if moved_original_documents and original_documents.exists():
            os.replace(original_documents, documents_directory)
        raise
    finally:
        shutil.rmtree(documents_staging, ignore_errors=True)
        database_staging.unlink(missing_ok=True)

    if original_documents.exists():
        shutil.rmtree(original_documents, ignore_errors=True)

    return RestoreResult(
        database_path=database_path,
        documents_directory=documents_directory,
        restored_attachment_count=verified.attachment_count,
        safety_backup_path=safety.file_path,
    )
