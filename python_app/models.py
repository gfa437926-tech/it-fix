from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def new_id() -> str:
    return str(uuid4())


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Office(Base):
    __tablename__ = "offices"
    __table_args__ = (UniqueConstraint("name", "building", "room", name="uq_office_location"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    building: Mapped[str | None] = mapped_column(String(120))
    directorate: Mapped[str | None] = mapped_column(String(160))
    department: Mapped[str | None] = mapped_column(String(160))
    room: Mapped[str | None] = mapped_column(String(80))
    manager: Mapped[str | None] = mapped_column(String(160))
    phone: Mapped[str | None] = mapped_column(String(40))
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class Asset(Base):
    __tablename__ = "assets"
    __table_args__ = (
        CheckConstraint(
            "category in ('desktop','laptop','monitor','printer','scanner','network','storage','ups','accessory','other')",
            name="ck_asset_category",
        ),
        CheckConstraint(
            "status in ('available','assigned','maintenance','damaged','retired','returned')",
            name="ck_asset_status",
        ),
        Index("ix_assets_brand_model", "brand", "model"),
        Index("ix_assets_office_status", "office_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    category: Mapped[str] = mapped_column(String(24), nullable=False, default="other")
    brand: Mapped[str] = mapped_column(String(120), nullable=False)
    model: Mapped[str] = mapped_column(String(160), nullable=False)
    serial_number: Mapped[str | None] = mapped_column(String(160))
    serial_key: Mapped[str | None] = mapped_column(String(160), unique=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="available")
    cpu: Mapped[str | None] = mapped_column(String(120))
    ram: Mapped[str | None] = mapped_column(String(80))
    storage: Mapped[str | None] = mapped_column(String(120))
    office_id: Mapped[str | None] = mapped_column(ForeignKey("offices.id", ondelete="RESTRICT"))
    office_name: Mapped[str | None] = mapped_column(String(180))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    retirement_reason: Mapped[str | None] = mapped_column(Text)
    transferred_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    office: Mapped[Office | None] = relationship()


class AssetMovement(Base):
    __tablename__ = "asset_movements"
    __table_args__ = (Index("ix_asset_movements_asset_date", "asset_id", "occurred_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id", ondelete="RESTRICT"), nullable=False)
    asset_label: Mapped[str] = mapped_column(String(300), nullable=False)
    movement_type: Mapped[str] = mapped_column(String(40), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    from_office_id: Mapped[str | None] = mapped_column(String(36))
    from_office_name: Mapped[str | None] = mapped_column(String(180))
    to_office_id: Mapped[str | None] = mapped_column(String(36))
    to_office_name: Mapped[str | None] = mapped_column(String(180))
    from_employee: Mapped[str | None] = mapped_column(String(180))
    to_employee: Mapped[str | None] = mapped_column(String(180))
    notes: Mapped[str | None] = mapped_column(Text)


class ImportBatch(Base):
    __tablename__ = "import_batches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_name: Mapped[str] = mapped_column(String(260), nullable=False)
    created_by: Mapped[str] = mapped_column(String(160), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    total_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    attempted_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    succeeded_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_invalid_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="completed")
    row_errors: Mapped[str | None] = mapped_column(Text)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    entity_type: Mapped[str] = mapped_column(String(60), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(36), nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    actor_name: Mapped[str] = mapped_column(String(160), nullable=False, default="النظام")
    details: Mapped[str | None] = mapped_column(Text)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class CustodyCard(Base):
    __tablename__ = "custody_cards"
    __table_args__ = (
        CheckConstraint("status in ('active','returned','rejected')", name="ck_custody_status"),
        CheckConstraint("approval_status in ('pending','approved','rejected')", name="ck_custody_approval_status"),
        Index("ix_custody_cards_employee_status", "responsible_name", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    card_number: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    form_number: Mapped[str | None] = mapped_column(String(100))
    province_region: Mapped[str | None] = mapped_column(String(120))
    responsible_name: Mapped[str] = mapped_column(String(180), nullable=False)
    role_title: Mapped[str | None] = mapped_column(String(180))
    directorate: Mapped[str | None] = mapped_column(String(180))
    department: Mapped[str | None] = mapped_column(String(180))
    office_name: Mapped[str] = mapped_column(String(180), nullable=False)
    office_room: Mapped[str | None] = mapped_column(String(80))
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    approval_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    approved_by: Mapped[str | None] = mapped_column(String(160))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rejected_by: Mapped[str | None] = mapped_column(String(160))
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    returned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    notes: Mapped[str | None] = mapped_column(Text)
    it_department_head: Mapped[str | None] = mapped_column(String(180))
    inventory_tech_name: Mapped[str | None] = mapped_column(String(180))
    responsible_signature_name: Mapped[str | None] = mapped_column(String(180))
    created_by: Mapped[str] = mapped_column(String(160), nullable=False, default="النظام")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    items: Mapped[list["CustodyItem"]] = relationship(
        back_populates="card", cascade="all, delete-orphan", order_by="CustodyItem.seq"
    )


class CustodyItem(Base):
    __tablename__ = "custody_items"
    __table_args__ = (
        CheckConstraint("quantity_number > 0", name="ck_custody_item_quantity"),
        CheckConstraint("balance >= 0", name="ck_custody_item_balance"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    custody_card_id: Mapped[str] = mapped_column(
        ForeignKey("custody_cards.id", ondelete="CASCADE"), nullable=False
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    item_name: Mapped[str] = mapped_column(String(200), nullable=False)
    item_description: Mapped[str | None] = mapped_column(Text)
    unit: Mapped[str | None] = mapped_column(String(60))
    quantity_number: Mapped[float] = mapped_column(Float, nullable=False, default=1)
    quantity_text: Mapped[str | None] = mapped_column(String(100))
    item_code: Mapped[str | None] = mapped_column(String(120))
    card_code: Mapped[str | None] = mapped_column(String(120))
    receipt_doc_number: Mapped[str | None] = mapped_column(String(100))
    receipt_date: Mapped[str | None] = mapped_column(String(32))
    return_doc_number: Mapped[str | None] = mapped_column(String(100))
    return_date: Mapped[str | None] = mapped_column(String(32))
    balance: Mapped[float] = mapped_column(Float, nullable=False, default=1)
    notes: Mapped[str | None] = mapped_column(Text)
    asset_id: Mapped[str | None] = mapped_column(ForeignKey("assets.id", ondelete="RESTRICT"))

    card: Mapped[CustodyCard] = relationship(back_populates="items")
    asset: Mapped[Asset | None] = relationship()


class MaintenanceRecord(Base):
    __tablename__ = "maintenance_records"
    __table_args__ = (
        CheckConstraint("priority in ('low','normal','high','urgent')", name="ck_maintenance_priority"),
        CheckConstraint("status in ('open','inProgress','completed','cancelled')", name="ck_maintenance_status"),
        CheckConstraint("cost is null or cost >= 0", name="ck_maintenance_cost"),
        CheckConstraint("parts_cost >= 0", name="ck_maintenance_parts_cost"),
        Index("ix_maintenance_asset_status", "asset_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id", ondelete="RESTRICT"), nullable=False)
    asset_label: Mapped[str] = mapped_column(String(300), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[str] = mapped_column(String(16), nullable=False, default="normal")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    technician: Mapped[str | None] = mapped_column(String(180))
    cost: Mapped[float | None] = mapped_column(Float)
    parts_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    resolution: Mapped[str | None] = mapped_column(Text)
    previous_asset_status: Mapped[str | None] = mapped_column(String(24))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    asset: Mapped[Asset] = relationship()


class SparePart(Base):
    __tablename__ = "spare_parts"
    __table_args__ = (
        CheckConstraint("quantity >= 0", name="ck_spare_part_quantity"),
        CheckConstraint("minimum_quantity >= 0", name="ck_spare_part_minimum"),
        CheckConstraint("unit_cost >= 0", name="ck_spare_part_unit_cost"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    sku: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    minimum_quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    unit_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    supplier: Mapped[str] = mapped_column(String(180), nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class MaintenancePartUsage(Base):
    __tablename__ = "maintenance_part_usage"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_part_usage_quantity"),
        CheckConstraint("unit_cost >= 0 and total_cost >= 0", name="ck_part_usage_cost"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    part_id: Mapped[str] = mapped_column(ForeignKey("spare_parts.id", ondelete="RESTRICT"), nullable=False)
    part_name: Mapped[str] = mapped_column(String(180), nullable=False)
    maintenance_id: Mapped[str] = mapped_column(
        ForeignKey("maintenance_records.id", ondelete="RESTRICT"), nullable=False
    )
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id", ondelete="RESTRICT"), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit_cost: Mapped[float] = mapped_column(Float, nullable=False)
    total_cost: Mapped[float] = mapped_column(Float, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class PurchaseRecord(Base):
    __tablename__ = "purchase_records"
    __table_args__ = (CheckConstraint("total_cost >= 0", name="ck_purchase_total_cost"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id", ondelete="RESTRICT"), nullable=False)
    asset_label: Mapped[str] = mapped_column(String(300), nullable=False)
    supplier: Mapped[str] = mapped_column(String(180), nullable=False)
    invoice_number: Mapped[str] = mapped_column(String(100), nullable=False)
    purchase_date: Mapped[str] = mapped_column(String(32), nullable=False)
    warranty_until: Mapped[str | None] = mapped_column(String(32))
    total_cost: Mapped[float] = mapped_column(Float, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class AssetDocument(Base):
    __tablename__ = "asset_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id", ondelete="RESTRICT"), nullable=False)
    purchase_record_id: Mapped[str | None] = mapped_column(ForeignKey("purchase_records.id", ondelete="RESTRICT"))
    file_name: Mapped[str] = mapped_column(String(260), nullable=False)
    document_type: Mapped[str] = mapped_column(String(32), nullable=False, default="other")
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_by: Mapped[str] = mapped_column(String(160), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
