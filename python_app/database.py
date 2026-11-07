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


def _validate_schema(target_engine: Engine) -> None:
    inspector = inspect(target_engine)
    expected_tables = set(Base.metadata.tables)
    existing_tables = set(inspector.get_table_names())
    missing_tables = sorted(expected_tables - existing_tables)

    missing_columns: dict[str, list[str]] = {}
    for table_name in sorted(expected_tables & existing_tables):
        actual_columns = {
            column["name"] for column in inspector.get_columns(table_name)
        }
        expected_columns = {
            column.name for column in Base.metadata.tables[table_name].columns
        }
        missing = sorted(expected_columns - actual_columns)
        if missing:
            missing_columns[table_name] = missing

    details: list[str] = []
    if missing_tables:
        details.append("الجداول الناقصة: " + ", ".join(missing_tables))
    if missing_columns:
        details.append(
            "الأعمدة الناقصة: "
            + "; ".join(
                f"{table}: {', '.join(columns)}"
                for table, columns in missing_columns.items()
            )
        )
    if details:
        raise RuntimeError(
            "مخطط قاعدة البيانات لا يطابق إصدار IT Fix الحالي. "
            "لم يجرِ البرنامج أي تعديل تلقائي على مخطط موجود. "
            "راجع python_app/models.py وأنشئ ترحيل قاعدة البيانات بعد المراجعة. "
            + " | ".join(details)
        )


def initialize_database(target_engine: Engine = engine, *, allow_schema_creation: bool | None = None) -> None:
    can_create = settings.auto_create_schema if allow_schema_creation is None else allow_schema_creation

    if can_create:
        existing_app_tables = set(inspect(target_engine).get_table_names()) & set(Base.metadata.tables)
        if existing_app_tables:
            # create_all() does not migrate existing tables. Validate first so that
            # old schemas fail clearly instead of partially creating new objects.
            _validate_schema(target_engine)
        else:
            Base.metadata.create_all(target_engine)

    _validate_schema(target_engine)


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
        # Driver exceptions can embed a full connection URL, including credentials.
        # Do not expose raw exception text in the desktop diagnostics UI.
        return False, "تعذر الاتصال بقاعدة البيانات. تحقق من الإعدادات والاتصال ثم أعد المحاولة."
