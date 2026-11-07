from __future__ import annotations

import json
import sqlite3
import zipfile
from types import SimpleNamespace
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from python_app.models import Base
from python_app.services.assets import AssetInput, create_asset
from python_app.services.backup import create_backup_archive, _safe_zip_member, _validate_archive_limits
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


def test_restore_replaces_database_and_documents_after_safety_backup(tmp_path: Path) -> None:
    from python_app.services.backup import restore_sqlite_backup_archive

    database_path = tmp_path / "live-data" / "itfix_assets.db"
    database_path.parent.mkdir(parents=True)
    engine = create_engine(f"sqlite:///{database_path}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    session = factory()
    try:
        original_asset = create_asset(
            session, AssetInput("laptop", "HP", "ProBook", "RESTORE-ORIGINAL")
        )
        data_dir = tmp_path / "live-data"
        original_file = tmp_path / "original.pdf"
        original_file.write_bytes(b"%PDF-1.7\\noriginal backup\\n%%EOF")
        original_document = attach_asset_document(
            session,
            asset_id=original_asset.id,
            source_path=original_file,
            uploaded_by="مدير",
            document_type="invoice",
            storage_root=data_dir,
        )
        archive_path = tmp_path / "known-good-backup.zip"
        create_backup_archive(
            archive_path,
            database_engine=engine,
            data_directory=data_dir,
        )

        changed_asset = create_asset(
            session, AssetInput("desktop", "Dell", "OptiPlex", "RESTORE-NEW")
        )
        changed_file = tmp_path / "new.pdf"
        changed_file.write_bytes(b"%PDF-1.7\\nnew live attachment\\n%%EOF")
        attach_asset_document(
            session,
            asset_id=changed_asset.id,
            source_path=changed_file,
            uploaded_by="مدير",
            document_type="other",
            storage_root=data_dir,
        )
        session.close()

        safety_path = tmp_path / "before-restore.zip"
        result = restore_sqlite_backup_archive(
            archive_path,
            database_engine=engine,
            data_directory=data_dir,
            confirmed=True,
            safety_backup_path=safety_path,
        )

        assert result.database_path == database_path.resolve()
        assert result.restored_attachment_count == 1
        assert result.safety_backup_path == safety_path.resolve()
        assert safety_path.is_file()
        with sqlite3.connect(database_path) as restored:
            assets = restored.execute(
                "select serial_number from assets order by serial_number"
            ).fetchall()
            documents = restored.execute(
                "select id, file_name from asset_documents"
            ).fetchall()
        assert assets == [("RESTORE-ORIGINAL",)]
        assert documents == [(original_document.id, "original.pdf")]
        restored_files = list((data_dir / "documents").iterdir())
        assert len(restored_files) == 1
        assert restored_files[0].read_bytes() == original_file.read_bytes()

        safety_result = create_backup_archive(
            tmp_path / "safety-repacked.zip",
            database_engine=engine,
            data_directory=data_dir,
        )
        assert safety_result.attachment_count == 1
    finally:
        session.close()
        engine.dispose()


def test_restore_rolls_back_documents_when_database_install_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import python_app.services.backup as backup_module
    from python_app.services.backup import restore_sqlite_backup_archive

    database_path = tmp_path / "live-data" / "itfix_assets.db"
    database_path.parent.mkdir(parents=True)
    data_dir = tmp_path / "live-data"
    engine = create_engine(f"sqlite:///{database_path}")
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    try:
        create_asset(session, AssetInput("laptop", "HP", "ProBook", "ROLLBACK-ORIGINAL"))
        session.commit()
        source = tmp_path / "rollback-source.zip"
        create_backup_archive(source, database_engine=engine, data_directory=data_dir)

        original_documents = data_dir / "documents"
        original_documents.mkdir(parents=True)
        (original_documents / "keep.txt").write_text("original live document", encoding="utf-8")
        session.close()

        real_replace = backup_module.os.replace

        def fail_database_install(src: str | Path, dst: str | Path) -> None:
            if Path(dst).resolve() == database_path.resolve() and ".itfix-database-restore-" in str(src):
                raise OSError("simulated database replacement failure")
            real_replace(src, dst)

        monkeypatch.setattr(backup_module.os, "replace", fail_database_install)
        with pytest.raises(OSError, match="simulated database replacement failure"):
            restore_sqlite_backup_archive(
                source,
                database_engine=engine,
                data_directory=data_dir,
                confirmed=True,
                safety_backup_path=tmp_path / "rollback-safety.zip",
            )

        assert (data_dir / "documents" / "keep.txt").read_text(encoding="utf-8") == "original live document"
        with sqlite3.connect(database_path) as connection:
            serials = connection.execute("select serial_number from assets").fetchall()
        assert serials == [("ROLLBACK-ORIGINAL",)]
    finally:
        session.close()
        engine.dispose()


def test_restore_requires_explicit_confirmation(tmp_path: Path) -> None:
    from python_app.services.backup import restore_sqlite_backup_archive

    engine = create_engine("sqlite://")
    try:
        with pytest.raises(ValueError, match="تأكيداً صريحاً"):
            restore_sqlite_backup_archive(
                tmp_path / "missing.zip",
                database_engine=engine,
                data_directory=tmp_path / "data",
            )
    finally:
        engine.dispose()


def test_backup_verification_detects_manifest_hash_tampering(tmp_path: Path) -> None:
    from python_app.services.backup import verify_backup_archive

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    session = factory()
    try:
        target = tmp_path / "original.zip"
        create_backup_archive(
            target,
            database_engine=engine,
            data_directory=tmp_path / "data",
        )

        tampered = tmp_path / "tampered.zip"
        with zipfile.ZipFile(target, "r") as source, zipfile.ZipFile(tampered, "w") as destination:
            for item in source.infolist():
                content = source.read(item.filename)
                if item.filename == "manifest.json":
                    manifest = json.loads(content.decode("utf-8"))
                    manifest["database_sha256"] = "0" * 64
                    content = json.dumps(manifest).encode("utf-8")
                destination.writestr(item.filename, content)

        with pytest.raises(ValueError, match="بصمة قاعدة البيانات"):
            verify_backup_archive(tampered)
    finally:
        session.close()
        engine.dispose()


def test_backup_never_overwrites_existing_archive(tmp_path: Path) -> None:
    engine = create_engine("sqlite://")
    target = tmp_path / "existing-backup.zip"
    original = b"keep previous backup"
    target.write_bytes(original)
    try:
        with pytest.raises(FileExistsError, match="موجود مسبقاً"):
            create_backup_archive(
                target,
                database_engine=engine,
                data_directory=tmp_path / "data",
            )
        assert target.read_bytes() == original
    finally:
        engine.dispose()


def test_backup_rejects_destination_inside_attachment_directory(tmp_path: Path) -> None:
    engine = create_engine("sqlite://")
    documents = tmp_path / "data" / "documents"
    documents.mkdir(parents=True)
    try:
        with pytest.raises(ValueError, match="خارج مجلد مرفقات الأصول"):
            create_backup_archive(
                documents / "backup.zip",
                database_engine=engine,
                data_directory=tmp_path / "data",
            )
    finally:
        engine.dispose()


def test_restore_rejects_archive_inside_documents_that_will_be_replaced(tmp_path: Path) -> None:
    from python_app.services.backup import restore_sqlite_backup_archive

    database_path = tmp_path / "live-data" / "itfix_assets.db"
    database_path.parent.mkdir(parents=True)
    engine = create_engine(f"sqlite:///{database_path}")
    Base.metadata.create_all(engine)
    try:
        good_archive = tmp_path / "good-backup.zip"
        create_backup_archive(
            good_archive,
            database_engine=engine,
            data_directory=tmp_path / "live-data",
        )
        documents = tmp_path / "live-data" / "documents"
        documents.mkdir()
        archive_inside_documents = documents / "restore-source.zip"
        archive_inside_documents.write_bytes(good_archive.read_bytes())

        with pytest.raises(ValueError, match="داخل مجلد المرفقات"):
            restore_sqlite_backup_archive(
                archive_inside_documents,
                database_engine=engine,
                data_directory=tmp_path / "live-data",
                confirmed=True,
            )
        assert archive_inside_documents.is_file()
    finally:
        engine.dispose()


@pytest.mark.parametrize(
    "member",
    [
        "data/documents/..\\\\escape.txt",
        "data/documents/sub\\\\file.txt",
        "data/documents/file\x00name.txt",
    ],
)
def test_backup_member_validation_rejects_windows_separators_and_null_bytes(member: str) -> None:
    assert _safe_zip_member(member) is False


def test_backup_member_validation_accepts_safe_posix_relative_path() -> None:
    assert _safe_zip_member("data/documents/2026/invoice.pdf") is True



def test_backup_limits_reject_excessive_member_count() -> None:
    infos = [SimpleNamespace(filename=f"file-{index}", file_size=0) for index in range(10_003)]
    with pytest.raises(ValueError, match="عدداً كبيراً"):
        _validate_archive_limits(infos)


def test_backup_limits_reject_oversized_member() -> None:
    infos = [SimpleNamespace(filename="database/itfix_assets.sqlite3", file_size=512 * 1024 * 1024 + 1)]
    with pytest.raises(ValueError, match="يتجاوز الحجم المسموح"):
        _validate_archive_limits(infos)


def test_backup_limits_reject_excessive_total_expanded_size() -> None:
    infos = [
        SimpleNamespace(filename=f"part-{index}.bin", file_size=512 * 1024 * 1024)
        for index in range(4)
    ] + [
        SimpleNamespace(filename="overflow.bin", file_size=1),
    ]
    with pytest.raises(ValueError, match="الإجمالي"):
        _validate_archive_limits(infos)


def test_backup_limits_reject_oversized_manifest() -> None:
    infos = [SimpleNamespace(filename="manifest.json", file_size=8 * 1024 * 1024 + 1)]
    with pytest.raises(ValueError, match="manifest"):
        _validate_archive_limits(infos)


def test_backup_verification_rejects_unmanifested_archive_member(tmp_path: Path) -> None:
    from python_app.services.backup import verify_backup_archive

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    try:
        original = tmp_path / "valid.zip"
        create_backup_archive(
            original,
            database_engine=engine,
            data_directory=tmp_path / "data",
        )
        tampered = tmp_path / "with-hidden-file.zip"
        with zipfile.ZipFile(original, "r") as source, zipfile.ZipFile(tampered, "w") as destination:
            for item in source.infolist():
                destination.writestr(item.filename, source.read(item.filename))
            destination.writestr("data/documents/unlisted-payload.txt", b"not in manifest")

        with pytest.raises(ValueError, match="غير مسجلة في manifest"):
            verify_backup_archive(tampered)
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_backup_limits_accept_normal_archive() -> None:
    infos = [
        SimpleNamespace(filename="database/itfix_assets.sqlite3", file_size=2 * 1024 * 1024),
        SimpleNamespace(filename="data/documents/invoice.pdf", file_size=5 * 1024 * 1024),
        SimpleNamespace(filename="manifest.json", file_size=2048),
    ]
    _validate_archive_limits(infos)
