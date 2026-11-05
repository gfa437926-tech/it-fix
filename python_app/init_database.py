from __future__ import annotations

import argparse

from .database import engine
from .models import Base


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create the IT Fix asset inventory schema in the configured database."
    )
    parser.add_argument(
        "--confirm-create-schema",
        action="store_true",
        help="Required confirmation before creating tables.",
    )
    args = parser.parse_args()
    if not args.confirm_create_schema:
        parser.error("أعد تشغيل الأمر مع --confirm-create-schema بعد مراجعة المخطط.")

    Base.metadata.create_all(engine)
    print("تم إنشاء مخطط IT Fix بنجاح.")


if __name__ == "__main__":
    main()
