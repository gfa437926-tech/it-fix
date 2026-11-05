from __future__ import annotations

import pytest
from sqlalchemy import create_engine, text

from python_app.database import engine, initialize_database
from python_app.models import Base


def test_application_sqlite_engine_enables_foreign_key_enforcement() -> None:
    if engine.dialect.name != "sqlite":
        pytest.skip("SQLite-specific pragma test")

    with engine.connect() as connection:
        enabled = connection.scalar(text("PRAGMA foreign_keys"))

    assert enabled == 1


def test_external_database_requires_the_complete_inventory_schema() -> None:
    target = create_engine("sqlite://")

    try:
        with pytest.raises(RuntimeError, match="app_users") as error:
            initialize_database(target, allow_schema_creation=False)

        assert "asset_documents" in str(error.value)
        assert "purchase_records" in str(error.value)
        assert "maintenance_part_usage" in str(error.value)
    finally:
        target.dispose()


def test_complete_inventory_schema_passes_readiness_without_implicit_creation() -> None:
    target = create_engine("sqlite://")
    try:
        Base.metadata.create_all(target)

        # Production mode validates the existing schema and must not create it.
        initialize_database(target, allow_schema_creation=False)

        with target.connect() as connection:
            tables = set(connection.execute(text(
                "select name from sqlite_master where type='table'"
            )).scalars())
        assert {
            "assets",
            "app_users",
            "custody_cards",
            "maintenance_records",
            "purchase_records",
            "asset_documents",
            "audit_logs",
        } <= tables
    finally:
        target.dispose()


def test_empty_local_database_is_created_with_all_current_tables() -> None:
    target = create_engine("sqlite://")
    try:
        initialize_database(target, allow_schema_creation=True)
        with target.connect() as connection:
            tables = set(connection.execute(text(
                "select name from sqlite_master where type='table'"
            )).scalars())
        assert set(Base.metadata.tables) <= tables
    finally:
        target.dispose()


def test_existing_schema_with_missing_columns_is_rejected_before_auto_creation() -> None:
    target = create_engine("sqlite://")
    try:
        with target.begin() as connection:
            connection.execute(text(
                "create table assets (id varchar(36) primary key, brand varchar(120), model varchar(160))"
            ))

        with pytest.raises(RuntimeError, match="الأعمدة الناقصة") as error:
            initialize_database(target, allow_schema_creation=True)

        assert "serial_number" in str(error.value)
        with target.connect() as connection:
            tables = set(connection.execute(text(
                "select name from sqlite_master where type='table'"
            )).scalars())
        assert tables == {"assets"}
    finally:
        target.dispose()


def test_schema_readiness_detects_missing_column_when_tables_exist() -> None:
    target = create_engine("sqlite://")
    try:
        with target.begin() as connection:
            connection.execute(text(
                "create table assets (id varchar(36) primary key, brand varchar(120), model varchar(160))"
            ))

        with pytest.raises(RuntimeError, match="مخطط قاعدة البيانات لا يطابق"):
            initialize_database(target, allow_schema_creation=False)
    finally:
        target.dispose()
