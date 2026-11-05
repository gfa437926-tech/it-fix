from __future__ import annotations

import json
import sqlite3
import zipfile
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from python_app.models import Base
from python_app.services.assets import AssetInput, create_asset
from python_app.services.backup import create_backup_archive
from python_app.services.documents import attach_asset_document


def test_backup_contains_consistent_database_snapshot_and_asset_documents(tmp_path: Path) -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    session: Session = factory()
    try:
        asset = create_asset(
            session,
            AssetInput("laptop", "HP", "ProBook", "BACKUP-1"),
            "مسؤول الاختبار",
        )
        documents_dir = tmp_path / "app-data"
        source = tmp_path / "invoice.pdf"
        source.write_bytes(b"%PDF-1.7\nbackup test\n%%EOF")
        attach_asset_document(
            session,
            asset_id=asset.id,
            source_path=source,
            uploaded_by="مسؤول الاختبار",
            document_type="invoice",
            storage_root=documents_dir,
        )

        target = tmp_path / "backups" / "itfix-backup.zip"
        result = create_backup_archive(
            target,
            database_engine=engine,
            data_directory=documents_dir,
        )

        assert result.file_path == target.resolve()
        assert result.database_type == "sqlite"
        assert result.attachment_count == 1
        assert result.database_bytes > 0
        assert result.archive_bytes == target.stat().st_size

        with zipfile.ZipFile(target) as archive:
            names = set(archive.namelist())
            assert "database/itfix_assets.sqlite3" in names
            manifest = json.loads(archive.read("manifest.json"))
            assert manifest["encrypted"] is False
            assert manifest["database_type"] == "sqlite"
            assert len(manifest["attachments"]) == 1
            attachment_path = manifest["attachments"][0]["path"]
            assert attachment_path.startswith("data/documents/")
            assert attachment_path in names
            snapshot = tmp_path / "restored-snapshot.sqlite3"
            snapshot.write_bytes(archive.read("database/itfix_assets.sqlite3"))

        with sqlite3.connect(snapshot) as restored:
            row = restored.execute(
                "select brand, model, serial_number from assets where id = ?",
                (asset.id,),
            ).fetchone()
        assert row == ("HP", "ProBook", "BACKUP-1")
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_backup_requires_zip_extension(tmp_path: Path) -> None:
    engine = create_engine("sqlite://")
    try:
        with pytest.raises(ValueError, match="امتداد .zip"):
            create_backup_archive(
                tmp_path / "backup.sql",
                database_engine=engine,
                data_directory=tmp_path / "data",
            )
    finally:
        engine.dispose()


def test_backup_rejects_symlinked_attachment(tmp_path: Path) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    documents = tmp_path / "data" / "documents"
    documents.mkdir(parents=True)
    outside = tmp_path / "outside.txt"
    outside.write_text("not an attachment", encoding="utf-8")
    link = documents / "linked.txt"
    try:
        link.symlink_to(outside)
    except (OSError, NotImplementedError):
        pytest.skip("Symbolic links are unavailable on this runner.")

    try:
        with pytest.raises(ValueError, match="رابط رمزي"):
            create_backup_archive(
                tmp_path / "backup.zip",
                database_engine=engine,
                data_directory=tmp_path / "data",
            )
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()
