from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import Engine, create_engine, event, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from .config import settings
from .models import Base


def build_engine(database_url: str | None = None) -> Engine:
    url = database_url or settings.database_url
    connect_args: dict[str, object] = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    elif url.startswith("postgresql"):
        parsed_url = make_url(url)
        explicit_sslmode = parsed_url.query.get("sslmode")
        is_local = parsed_url.host in {"localhost", "127.0.0.1", "::1"}
        if explicit_sslmode:
            connect_args["sslmode"] = explicit_sslmode
        else:
            # Local native PostgreSQL usually has TLS disabled by default.
            # Remote PostgreSQL/Supabase connections must use TLS.
            connect_args["sslmode"] = "disable" if is_local else "require"

    return create_engine(
        url,
        connect_args=connect_args,
        pool_pre_ping=True,
        future=True,
    )


engine = build_engine()


@event.listens_for(engine, "connect")
def _enable_sqlite_integrity(dbapi_connection: object, _connection_record: object) -> None:
    if engine.dialect.name != "sqlite":
        return
    cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=30000")
    finally:
        cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, class_=Session)


def initialize_database(target_engine: Engine = engine, *, allow_schema_creation: bool | None = None) -> None:
    is_sqlite = target_engine.dialect.name == "sqlite"
    can_create = settings.auto_create_schema if allow_schema_creation is None else allow_schema_creation

    if can_create:
        Base.metadata.create_all(target_engine)
        return

    inspector = inspect(target_engine)
    required_tables = {
        "offices",
        "assets",
        "asset_movements",
        "import_batches",
        "audit_logs",
        "app_users",
        "custody_cards",
        "custody_items",
        "maintenance_records",
        "spare_parts",
        "maintenance_part_usage",
        "purchase_records",
        "asset_documents",
    }
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
