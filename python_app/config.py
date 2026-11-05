from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR / "data"
load_dotenv(APP_DIR / ".env")


@dataclass(frozen=True, slots=True)
class Settings:
    database_url: str
    auto_create_schema: bool
    app_title: str = "IT Fix — نظام جرد الأصول"

    @classmethod
    def from_environment(cls) -> "Settings":
        configured_url = os.getenv("DATABASE_URL", "").strip()
        if configured_url:
            database_url = configured_url
            default_auto_create = "false"
        else:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            database_url = f"sqlite:///{(DATA_DIR / 'itfix_assets.db').as_posix()}"
            default_auto_create = "true"

        raw_auto_create = os.getenv("AUTO_CREATE_SCHEMA", default_auto_create).strip().lower()
        auto_create = raw_auto_create in {"1", "true", "yes", "on"}
        return cls(
            database_url=database_url,
            auto_create_schema=auto_create,
        )


settings = Settings.from_environment()
