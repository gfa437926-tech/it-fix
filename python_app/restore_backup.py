from __future__ import annotations

import argparse

from .config import DATA_DIR
from .database import engine
from .services.backup import restore_sqlite_backup_archive, verify_backup_archive


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verify or restore an IT Fix asset inventory backup archive."
    )
    parser.add_argument("archive", help="Path to the IT Fix backup ZIP archive.")
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Verify archive structure and SHA-256 checksums without changing data.",
    )
    parser.add_argument(
        "--confirm-restore",
        action="store_true",
        help="Required to restore SQLite. Close every running IT Fix instance first.",
    )
    parser.add_argument(
        "--safety-backup",
        help="Optional ZIP path for a backup of the current database and attachments before restore.",
    )
    args = parser.parse_args()

    if args.verify_only:
        result = verify_backup_archive(args.archive)
        print("النسخة الاحتياطية سليمة.")
        print(f"قاعدة البيانات: {result.database_type}")
        print(f"الحجم: {result.database_bytes:,} بايت")
        print(f"المرفقات: {result.attachment_count}")
        print(f"تاريخ الإنشاء UTC: {result.created_at_utc}")
        return

    if not args.confirm_restore:
        parser.error("أغلق التطبيق ثم أعد الأمر مع --confirm-restore بعد التأكد من اختيار النسخة الصحيحة.")

    result = restore_sqlite_backup_archive(
        args.archive,
        database_engine=engine,
        data_directory=DATA_DIR,
        confirmed=True,
        safety_backup_path=args.safety_backup,
    )
    print("تمت استعادة قاعدة البيانات والمرفقات بنجاح.")
    print(f"قاعدة البيانات: {result.database_path}")
    print(f"مجلد المرفقات: {result.documents_directory}")
    print(f"عدد المرفقات: {result.restored_attachment_count}")
    print(f"نسخة الأمان السابقة: {result.safety_backup_path}")


if __name__ == "__main__":
    main()
