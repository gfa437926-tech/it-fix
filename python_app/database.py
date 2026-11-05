from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from .config import settings
from .models import Base


def build_engine(database_url: str | None = None) -> Engine:
    url = database_url or settings.database_url
    connect_args: dict[str, object] = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    elif url.startswith("postgresql") and "sslmode=" not in url:
        # Require TLS for hosted PostgreSQL/Supabase connections. Localhost
        # native PostgreSQL can explicitly opt out in its own connection URL.
        connect_args["sslmode"] = "require"

    return create_engine(
        url,
        connect_args=connect_args,
        pool_pre_ping=True,
        future=True,
    )


engine = build_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, class_=Session)


def initialize_database(target_engine: Engine = engine, *, allow_schema_creation: bool | None = None) -> None:
    is_sqlite = target_engine.dialect.name == "sqlite"
    can_create = settings.auto_create_schema if allow_schema_creation is None else allow_schema_creation

    if can_create:
        Base.metadata.create_all(target_engine)
        return

    inspector = inspect(target_engine)
    required_tables = {"offices", "assets", "asset_movements", "import_batches"}
    existing_tables = set(inspector.get_table_names())
    missing = sorted(required_tables - existing_tables)
    if missing:
        raise RuntimeError(
            "قاعدة البيانات متصلة، لكن مخطط IT Fix غير مهيأ. "
            "راجع python_app/README.md ثم شغّل أمر تهيئة المخطط صراحة. "
            f"الجداول الناقصة: {', '.join(missing)}"
        )


def get_session() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def database_health(target_engine: Engine = engine) -> tuple[bool, str]:
    try:
        with target_engine.connect() as connection:
            connection.execute(text("select 1"))
        return True, target_engine.dialect.name
    except Exception as exc:  # surfaced to the UI as a safe diagnostic
        return False, str(exc)
