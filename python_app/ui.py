from __future__ import annotations

import tkinter as tk
import webbrowser
from datetime import datetime, timezone
from tkinter import filedialog, messagebox, simpledialog, ttk
from typing import Any

from sqlalchemy import select

from .database import SessionLocal, database_health, engine as database_engine
from .models import AppUser, Asset, AssetDocument, Office
from .services.auth import (
    authenticate_user,
    bootstrap_first_admin,
    change_own_password,
    count_users,
    create_user,
    list_users,
    set_user_active,
    require_active_admin,
    require_active_user,
    reset_user_password,
)
from .services.assets import (
    ASSET_CATEGORIES,
    ASSET_STATUSES,
    AssetInput,
    create_asset,
    create_office,
    get_dashboard_summary,
    list_assets,
    list_offices,
    list_recent_movements,
    retire_asset,
    transfer_asset,
    update_asset,
    update_office,
    set_office_active,
)
from .services.purchases import create_purchase_record, list_purchase_records
from .services.audit import export_audit_logs_to_csv, list_audit_logs
from .services.backup import create_backup_archive
from .services.reports import export_management_report
from .services.documents import attach_asset_document, list_asset_documents, resolve_asset_document_path
from .services.excel_service import (
    CATEGORY_LABELS,
    STATUS_LABELS,
    export_assets_to_excel,
    import_assets_from_excel,
)
from .services.workflows import (
    CustodyItemInput,
    approve_custody_card,
    consume_spare_part,
    create_custody_card,
    create_spare_part,
    list_custody_cards,
    list_maintenance_tickets,
    list_spare_parts,
    open_maintenance_ticket,
    reject_custody_card,
    return_custody_card,
    update_maintenance_ticket,
)

CATEGORY_OPTIONS = {label: code for code, label in CATEGORY_LABELS.items()}
STATUS_OPTIONS = {
    "متوفر": "available",
    "في العهدة": "assigned",
    "قيد الصيانة": "maintenance",
    "تالف": "damaged",
    "مستبعد": "retired",
    "معاد للمستودع": "returned",
}
STATUS_LABELS_AR = {code: label for label, code in STATUS_OPTIONS.items()}


def _display_date(value: Any) -> str:
    return value.strftime("%Y-%m-%d") if value else "—"


class LoginDialog(tk.Toplevel):
    def __init__(self, parent: tk.Tk) -> None:
        super().__init__(parent)
        self.user: AppUser | None = None
        self.first_run = False
        with SessionLocal() as session:
            self.first_run = count_users(session) == 0

        self.title("إعداد المدير الأول" if self.first_run else "تسجيل الدخول")
        self.geometry("480x430" if self.first_run else "440x320")
        self.resizable(False, False)
        self.transient(parent)
        self.grab_set()
        self.protocol("WM_DELETE_WINDOW", self._cancel)
        self.configure(bg="#f3f6f8")

        container = ttk.Frame(self, padding=24)
        container.pack(fill="both", expand=True)
        ttk.Label(
            container,
            text="تهيئة نظام جرد الأصول" if self.first_run else "تسجيل الدخول إلى IT Fix",
            font=("Tahoma", 17, "bold"),
        ).pack(anchor="e", pady=(0, 6))
        description = (
            "أنشئ حساب مدير النظام الأول. لا توجد كلمة مرور افتراضية؛ كلمة المرور لا تقل عن 12 محرفاً."
            if self.first_run
            else "أدخل بيانات حساب محلي نشط للمتابعة."
        )
        ttk.Label(
            container, text=description, wraplength=400, justify="right",
            style="Muted.TLabel",
        ).pack(anchor="e", pady=(0, 15))

        self.fields: dict[str, tk.StringVar] = {}
        self._field(container, "username", "اسم الدخول", "admin")
        if self.first_run:
            self._field(container, "display_name", "الاسم الظاهر", "")
        self._field(container, "password", "كلمة المرور", "")
        if self.first_run:
            self._field(container, "confirm", "تأكيد كلمة المرور", "")

        controls = ttk.Frame(container)
        controls.pack(fill="x", pady=(18, 0))
        ttk.Button(controls, text="دخول" if not self.first_run else "إنشاء المدير الأول",
                   command=self._submit).pack(side="right")
        ttk.Button(controls, text="إغلاق", command=self._cancel).pack(side="right", padx=8)
        self.bind("<Return>", lambda _event: self._submit())
        self.wait_visibility()
        self.focus_set()

    def _field(self, parent: ttk.Frame, key: str, label: str, value: str) -> None:
        row = ttk.Frame(parent)
        row.pack(fill="x", pady=5)
        ttk.Label(row, text=label, width=18).pack(side="right", padx=(0, 8))
        variable = tk.StringVar(value=value)
        self.fields[key] = variable
        entry = ttk.Entry(
            row,
            textvariable=variable,
            justify="right",
            show="*" if key in {"password", "confirm"} else "",
        )
        entry.pack(side="right", fill="x", expand=True)
        if key == "username":
            entry.focus_set()

    def _submit(self) -> None:
        username = self.fields["username"].get().strip()
        password = self.fields["password"].get()
        try:
            with SessionLocal() as session:
                if self.first_run:
                    if password != self.fields["confirm"].get():
                        raise ValueError("كلمتا المرور غير متطابقتين.")
                    self.user = bootstrap_first_admin(
                        session,
                        username,
                        self.fields["display_name"].get(),
                        password,
                    )
                else:
                    self.user = authenticate_user(session, username, password)
            self.destroy()
        except Exception as exc:
            messagebox.showerror("تعذر تسجيل الدخول", str(exc), parent=self)

    def _cancel(self) -> None:
        self.user = None
        self.destroy()


class AssetDialog(tk.Toplevel):
    def __init__(
        self,
        parent: tk.Misc,
        offices: list[Office],
        asset: Asset | None = None,
    ) -> None:
        super().__init__(parent)
        self.result: AssetInput | None = None
        self.offices = offices
        self.office_by_label = {
            f"{office.name} — {office.building or 'بدون مبنى'} — {office.room or 'بدون غرفة'}": office
            for office in offices
        }
        self.title("تعديل بيانات أصل" if asset else "إضافة أصل جديد")
        self.geometry("590x610")
        self.minsize(520, 560)
        self.transient(parent)
        self.grab_set()
        self.configure(bg="#f4f7fa")

        container = ttk.Frame(self, padding=20)
        container.pack(fill="both", expand=True)
        ttk.Label(
            container,
            text="بيانات الأصل" if asset else "تسجيل أصل جديد",
            font=("Tahoma", 17, "bold"),
        ).pack(anchor="e", pady=(0, 14))

        form = ttk.Frame(container)
        form.pack(fill="both", expand=True)
        form.columnconfigure(1, weight=1)

        self.vars: dict[str, tk.StringVar] = {}
        self._add_combo(form, "الفئة", "category", list(CATEGORY_OPTIONS), CATEGORY_LABELS.get(asset.category, "أخرى") if asset else "أخرى")
        self._add_entry(form, "الشركة المصنعة", "brand", asset.brand if asset else "")
        self._add_entry(form, "الطراز / الموديل", "model", asset.model if asset else "")
        self._add_entry(form, "الرقم التسلسلي", "serial", asset.serial_number if asset and asset.serial_number else "")
        # Status transitions are performed only by custody, maintenance,
        # return and retirement workflows; the asset editor cannot bypass them.
        status_label = STATUS_LABELS_AR.get(asset.status, "متوفر") if asset else "متوفر"
        self._add_combo(form, "حالة الأصل", "status", [status_label], status_label)
        self._add_entry(form, "المعالج", "cpu", asset.cpu if asset and asset.cpu else "")
        self._add_entry(form, "الذاكرة RAM", "ram", asset.ram if asset and asset.ram else "")
        self._add_entry(form, "التخزين", "storage", asset.storage if asset and asset.storage else "")

        office_labels = ["المستودع الرئيسي", *self.office_by_label.keys()]
        selected_office = "المستودع الرئيسي"
        if asset:
            for label, office_item in self.office_by_label.items():
                if office_item.id == asset.office_id:
                    selected_office = label
                    break
            if asset.office_name and selected_office == "المستودع الرئيسي":
                selected_office = asset.office_name
                office_labels.insert(1, selected_office)
        self._add_combo(form, "المكتب / الموقع", "office", office_labels, selected_office)

        buttons = ttk.Frame(container)
        buttons.pack(fill="x", pady=(16, 0))
        ttk.Button(buttons, text="حفظ البيانات", command=self._save).pack(side="right", padx=(0, 8))
        ttk.Button(buttons, text="إلغاء", command=self.destroy).pack(side="right")

        self.bind("<Escape>", lambda _event: self.destroy())
        self.wait_visibility()
        self.focus_set()

    def _add_entry(self, parent: ttk.Frame, label: str, key: str, value: str) -> None:
        row = len(self.vars)
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="e", padx=(0, 12), pady=6)
        variable = tk.StringVar(value=value)
        self.vars[key] = variable
        entry = ttk.Entry(parent, textvariable=variable, justify="right")
        entry.grid(row=row, column=1, sticky="ew", pady=6)

    def _add_combo(
        self, parent: ttk.Frame, label: str, key: str, values: list[str], value: str
    ) -> None:
        row = len(self.vars)
        ttk.Label(parent, text=label).grid(row=row, column=0, sticky="e", padx=(0, 12), pady=6)
        variable = tk.StringVar(value=value)
        self.vars[key] = variable
        combo = ttk.Combobox(parent, textvariable=variable, values=values, state="readonly", justify="right")
        combo.grid(row=row, column=1, sticky="ew", pady=6)

    def _save(self) -> None:
        category = CATEGORY_OPTIONS.get(self.vars["category"].get())
        status = STATUS_OPTIONS.get(self.vars["status"].get())
        if not category or not status:
            messagebox.showerror("بيانات غير صحيحة", "اختر فئة الأصل وحالته من القوائم.", parent=self)
            return
        office_label = self.vars["office"].get()
        office = self.office_by_label.get(office_label)
        self.result = AssetInput(
            category=category,
            brand=self.vars["brand"].get(),
            model=self.vars["model"].get(),
            serial_number=self.vars["serial"].get(),
            status=status,
            cpu=self.vars["cpu"].get(),
            ram=self.vars["ram"].get(),
            storage=self.vars["storage"].get(),
            office_name=office.name if office else office_label,
            office_id=office.id if office else None,
        )
        self.destroy()


class OfficeDialog(tk.Toplevel):
    def __init__(self, parent: tk.Misc, office: Office | None = None) -> None:
        super().__init__(parent)
        self.result: tuple[str, str, str, str, str] | None = None
        self.title("تعديل مكتب أو موقع" if office else "إضافة مكتب أو موقع")
        self.geometry("480x380")
        self.transient(parent)
        self.grab_set()
        form = ttk.Frame(self, padding=20)
        form.pack(fill="both", expand=True)
        ttk.Label(form, text="تعريف موقع جديد", font=("Tahoma", 16, "bold")).pack(anchor="e", pady=(0, 12))
        self.fields: dict[str, tk.StringVar] = {}
        initial_values = {
            "name": office.name if office else "",
            "building": office.building or "" if office else "",
            "department": office.department or "" if office else "",
            "room": office.room or "" if office else "",
            "manager": office.manager or "" if office else "",
        }
        for key, label in [
            ("name", "اسم المكتب"),
            ("building", "المبنى"),
            ("department", "القسم / الدائرة"),
            ("room", "الغرفة"),
            ("manager", "المسؤول"),
        ]:
            row = ttk.Frame(form)
            row.pack(fill="x", pady=6)
            ttk.Label(row, text=label, width=16).pack(side="right")
            var = tk.StringVar(value=initial_values[key])
            self.fields[key] = var
            ttk.Entry(row, textvariable=var, justify="right").pack(side="right", fill="x", expand=True)
        controls = ttk.Frame(form)
        controls.pack(fill="x", pady=(12, 0))
        ttk.Button(controls, text="حفظ المكتب", command=self._save).pack(side="right", padx=(0, 8))
        ttk.Button(controls, text="إلغاء", command=self.destroy).pack(side="right")

    def _save(self) -> None:
        self.result = tuple(self.fields[key].get().strip() for key in (
            "name", "building", "department", "room", "manager"
        ))  # type: ignore[assignment]
        if not self.result[0]:
            messagebox.showerror("بيانات ناقصة", "اسم المكتب مطلوب.", parent=self)
            self.result = None
            return
        self.destroy()


class AssetInventoryApp:
    def __init__(self, root: tk.Tk, user: AppUser) -> None:
        self.root = root
        self.user = user
        self.actor_name = user.display_name
        self.root.title("IT Fix — نظام جرد الأصول")
        self.root.geometry("1360x850")
        self.root.minsize(1080, 700)
        self.root.configure(bg="#f3f6f8")

        self._configure_style()
        self._build_header()
        self._build_dashboard()
        self._build_tabs()
        self._build_status_bar()
        self.refresh_all()

    def _ensure_active_session(self, *, admin_only: bool = False) -> bool:
        try:
            with SessionLocal() as session:
                current_user = require_active_user(session, self.user)
                if admin_only:
                    current_user = require_active_admin(session, current_user)
        except PermissionError as exc:
            messagebox.showerror(
                "انتهت صلاحية الجلسة",
                str(exc),
                parent=self.root,
            )
            self.root.destroy()
            return False

        self.user = current_user
        self.actor_name = current_user.display_name
        return True

    def _configure_style(self) -> None:
        style = ttk.Style(self.root)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("Treeview", rowheight=30, font=("Tahoma", 10), background="white", fieldbackground="white")
        style.configure("Treeview.Heading", font=("Tahoma", 10, "bold"), padding=8)
        style.configure("TButton", font=("Tahoma", 10), padding=(10, 7))
        style.configure("TNotebook.Tab", font=("Tahoma", 10, "bold"), padding=(18, 10))
        style.configure("Header.TLabel", font=("Tahoma", 20, "bold"), foreground="#173f5f")
        style.configure("Muted.TLabel", font=("Tahoma", 9), foreground="#617481")
        style.configure("StatValue.TLabel", font=("Tahoma", 21, "bold"), foreground="#173f5f")

    def _build_header(self) -> None:
        header = tk.Frame(self.root, bg="#173f5f", height=82)
        header.pack(fill="x")
        header.pack_propagate(False)
        tk.Label(
            header, text="IT Fix  |  نظام إدارة وجرد الأصول",
            bg="#173f5f", fg="white", font=("Tahoma", 20, "bold"),
        ).pack(side="right", padx=24, pady=18)
        actions = tk.Frame(header, bg="#173f5f")
        actions.pack(side="left", padx=18, pady=12)
        role = "مدير النظام" if self.user.role == "admin" else "مدير أصول"
        tk.Label(
            actions,
            text=f"المستخدم: {self.user.display_name}  ·  {role}",
            bg="#173f5f", fg="#d4e4ef", font=("Tahoma", 9),
        ).pack(side="top", anchor="w", pady=(0, 5))
        controls = tk.Frame(actions, bg="#173f5f")
        controls.pack(side="left")
        tk.Button(
            controls, text="تغيير كلمة المرور", command=self.change_password,
            bg="#315a76", fg="white", activebackground="#426b87",
            activeforeground="white", relief="flat", font=("Tahoma", 9),
            padx=8, pady=4,
        ).pack(side="left", padx=(0, 6))
        tk.Button(
            controls, text="تسجيل الخروج", command=self.logout,
            bg="#7b3d45", fg="white", activebackground="#914b54",
            activeforeground="white", relief="flat", font=("Tahoma", 9),
            padx=8, pady=4,
        ).pack(side="left")

    def _build_dashboard(self) -> None:
        self.stats_frame = ttk.Frame(self.root, padding=(18, 14, 18, 4))
        self.stats_frame.pack(fill="x")
        self.stat_values: dict[str, ttk.Label] = {}
        cards = [
            ("total_assets", "إجمالي الأصول"),
            ("available", "متوفر بالمستودع"),
            ("assigned", "في العهدة"),
            ("maintenance", "قيد الصيانة"),
            ("damaged", "تالف"),
            ("active_offices", "المكاتب الفعالة"),
        ]
        for index, (key, label) in enumerate(cards):
            card = tk.Frame(self.stats_frame, bg="white", highlightbackground="#dfe7ed", highlightthickness=1)
            card.grid(row=0, column=index, sticky="nsew", padx=5, pady=3)
            self.stats_frame.columnconfigure(index, weight=1)
            tk.Label(card, text=label, bg="white", fg="#687b88", font=("Tahoma", 9)).pack(anchor="e", padx=12, pady=(10, 2))
            value = ttk.Label(card, text="0", style="StatValue.TLabel")
            value.pack(anchor="e", padx=12, pady=(0, 10))
            self.stat_values[key] = value

    def _build_tabs(self) -> None:
        self.notebook = ttk.Notebook(self.root)
        self.notebook.pack(fill="both", expand=True, padx=18, pady=12)
        self.assets_tab = ttk.Frame(self.notebook, padding=12)
        self.custody_tab = ttk.Frame(self.notebook, padding=12)
        self.maintenance_tab = ttk.Frame(self.notebook, padding=12)
        self.offices_tab = ttk.Frame(self.notebook, padding=12)
        self.movements_tab = ttk.Frame(self.notebook, padding=12)
        self.purchases_tab = ttk.Frame(self.notebook, padding=12)
        self.documents_tab = ttk.Frame(self.notebook, padding=12)
        self.users_tab = ttk.Frame(self.notebook, padding=12)
        self.audit_tab = ttk.Frame(self.notebook, padding=12)
        self.reports_tab = ttk.Frame(self.notebook, padding=12)
        self.excel_tab = ttk.Frame(self.notebook, padding=12)
        self.notebook.add(self.assets_tab, text="الأصول والأجهزة")
        self.notebook.add(self.custody_tab, text="بطاقات العهدة")
        self.notebook.add(self.maintenance_tab, text="الصيانة وقطع الغيار")
        self.notebook.add(self.offices_tab, text="المكاتب والمواقع")
        self.notebook.add(self.movements_tab, text="سجل الحركات")
        self.notebook.add(self.purchases_tab, text="المشتريات والضمان")
        self.notebook.add(self.documents_tab, text="مرفقات الأصول")
        if self.user.role == "admin":
            self.notebook.add(self.users_tab, text="المستخدمون والصلاحيات")
            self.notebook.add(self.audit_tab, text="سجل التدقيق")
            self.notebook.add(self.reports_tab, text="التقارير الشاملة")
        self.notebook.add(self.excel_tab, text="استيراد وتصدير Excel")
        self._build_assets_tab()
        self._build_custody_tab()
        self._build_maintenance_tab()
        self._build_offices_tab()
        self._build_movements_tab()
        self._build_purchases_tab()
        self._build_documents_tab()
        if self.user.role == "admin":
            self._build_users_tab()
            self._build_audit_tab()
            self._build_reports_tab()
        self._build_excel_tab()

    def _tree(
        self, parent: ttk.Frame, columns: tuple[str, ...], headings: dict[str, str],
        widths: dict[str, int] | None = None,
    ) -> ttk.Treeview:
        wrapper = ttk.Frame(parent)
        wrapper.pack(fill="both", expand=True)
        tree = ttk.Treeview(wrapper, columns=columns, show="headings", selectmode="browse")
        for column in columns:
            tree.heading(column, text=headings.get(column, column), anchor="e")
            tree.column(column, width=(widths or {}).get(column, 130), anchor="e", stretch=True)
        ybar = ttk.Scrollbar(wrapper, orient="vertical", command=tree.yview)
        xbar = ttk.Scrollbar(wrapper, orient="horizontal", command=tree.xview)
        tree.configure(yscrollcommand=ybar.set, xscrollcommand=xbar.set)
        tree.grid(row=0, column=0, sticky="nsew")
        ybar.grid(row=0, column=1, sticky="ns")
        xbar.grid(row=1, column=0, sticky="ew")
        wrapper.rowconfigure(0, weight=1)
        wrapper.columnconfigure(0, weight=1)
        return tree

    def _build_assets_tab(self) -> None:
        toolbar = ttk.Frame(self.assets_tab)
        toolbar.pack(fill="x", pady=(0, 10))
        self.asset_search = tk.StringVar()
        search = ttk.Entry(toolbar, textvariable=self.asset_search, width=32, justify="right")
        search.pack(side="right", padx=(0, 8))
        search.bind("<KeyRelease>", lambda _event: self.refresh_assets())
        self.asset_status_filter = tk.StringVar(value="جميع الحالات")
        ttk.Combobox(
            toolbar, textvariable=self.asset_status_filter,
            values=["جميع الحالات", *STATUS_OPTIONS.keys()], state="readonly", width=16,
        ).pack(side="right", padx=6)
        ttk.Button(toolbar, text="تصفية", command=self.refresh_assets).pack(side="right", padx=4)
        ttk.Button(toolbar, text="إضافة أصل", command=self.add_asset).pack(side="left", padx=4)
        ttk.Button(toolbar, text="تعديل الأصل", command=self.edit_asset).pack(side="left", padx=4)
        ttk.Button(toolbar, text="نقل إلى مكتب", command=self.transfer_selected_asset).pack(side="left", padx=4)
        ttk.Button(toolbar, text="استبعاد أصل", command=self.retire_selected_asset).pack(side="left", padx=4)

        columns = ("id", "category", "brand", "model", "serial", "status", "office", "received")
        self.assets_tree = self._tree(
            self.assets_tab, columns,
            {
                "id": "المعرّف", "category": "الفئة", "brand": "الشركة",
                "model": "الطراز", "serial": "الرقم التسلسلي",
                "status": "الحالة", "office": "المكتب", "received": "تاريخ الإضافة",
            },
            {"id": 220, "category": 130, "brand": 145, "model": 170, "serial": 150, "status": 110, "office": 160, "received": 110},
        )
        self.assets_tree.bind("<Double-1>", lambda _event: self.edit_asset())

    def _build_custody_tab(self) -> None:
        toolbar = ttk.Frame(self.custody_tab)
        toolbar.pack(fill="x", pady=(0, 10))
        ttk.Button(toolbar, text="إنشاء بطاقة عهدة", command=self.add_custody_card).pack(side="left", padx=4)
        ttk.Button(toolbar, text="اعتماد البطاقة", command=self.approve_selected_custody).pack(side="left", padx=4)
        ttk.Button(toolbar, text="رفض البطاقة", command=self.reject_selected_custody).pack(side="left", padx=4)
        ttk.Button(toolbar, text="إرجاع العهدة", command=self.return_selected_custody).pack(side="left", padx=4)
        columns = ("id", "number", "employee", "office", "items", "status", "approval")
        self.custody_tree = self._tree(
            self.custody_tab, columns,
            {
                "id": "المعرّف", "number": "رقم البطاقة", "employee": "المسؤول",
                "office": "المكتب", "items": "عدد البنود", "status": "حالة العهدة",
                "approval": "حالة الاعتماد",
            },
            {"id": 210, "number": 120, "employee": 170, "office": 160, "items": 90, "status": 120, "approval": 120},
        )

    def _build_maintenance_tab(self) -> None:
        sub_tabs = ttk.Notebook(self.maintenance_tab)
        sub_tabs.pack(fill="both", expand=True)
        self.maintenance_requests_tab = ttk.Frame(sub_tabs, padding=10)
        self.spare_parts_tab = ttk.Frame(sub_tabs, padding=10)
        sub_tabs.add(self.maintenance_requests_tab, text="طلبات الصيانة")
        sub_tabs.add(self.spare_parts_tab, text="مخزون قطع الغيار")

        ticket_toolbar = ttk.Frame(self.maintenance_requests_tab)
        ticket_toolbar.pack(fill="x", pady=(0, 10))
        ttk.Button(ticket_toolbar, text="فتح طلب صيانة", command=self.add_maintenance_ticket).pack(side="left", padx=4)
        ttk.Button(ticket_toolbar, text="بدء التنفيذ", command=self.start_selected_maintenance).pack(side="left", padx=4)
        ttk.Button(ticket_toolbar, text="إكمال الطلب", command=self.complete_selected_maintenance).pack(side="left", padx=4)
        ttk.Button(ticket_toolbar, text="إلغاء الطلب", command=self.cancel_selected_maintenance).pack(side="left", padx=4)
        self.maintenance_tree = self._tree(
            self.maintenance_requests_tab,
            ("id", "asset", "title", "priority", "status", "technician", "parts_cost", "reported"),
            {
                "id": "المعرّف", "asset": "الأصل", "title": "عنوان العطل",
                "priority": "الأولوية", "status": "الحالة", "technician": "الفني",
                "parts_cost": "تكلفة القطع", "reported": "تاريخ البلاغ",
            },
            {"id": 200, "asset": 180, "title": 190, "priority": 100, "status": 110, "technician": 140, "parts_cost": 100, "reported": 120},
        )

        part_toolbar = ttk.Frame(self.spare_parts_tab)
        part_toolbar.pack(fill="x", pady=(0, 10))
        ttk.Button(part_toolbar, text="إضافة قطعة غيار", command=self.add_spare_part).pack(side="left", padx=4)
        ttk.Label(part_toolbar, text="طلب الصيانة").pack(side="right", padx=(8, 4))
        self.maintenance_ticket_choice = tk.StringVar()
        self.maintenance_ticket_combo = ttk.Combobox(
            part_toolbar, textvariable=self.maintenance_ticket_choice,
            state="readonly", width=48,
        )
        self.maintenance_ticket_combo.pack(side="right", padx=4)
        ttk.Button(part_toolbar, text="صرف للطلب المحدد", command=self.consume_selected_spare_part).pack(side="left", padx=4)
        self.spare_parts_tree = self._tree(
            self.spare_parts_tab,
            ("id", "sku", "name", "quantity", "minimum", "unit_cost", "supplier", "stock"),
            {
                "id": "المعرّف", "sku": "الرمز", "name": "قطعة الغيار",
                "quantity": "المتوفر", "minimum": "الحد الأدنى", "unit_cost": "سعر الوحدة",
                "supplier": "المورد", "stock": "تنبيه المخزون",
            },
            {"id": 200, "sku": 130, "name": 210, "quantity": 90, "minimum": 90, "unit_cost": 100, "supplier": 150, "stock": 120},
        )

    def _build_offices_tab(self) -> None:
        toolbar = ttk.Frame(self.offices_tab)
        toolbar.pack(fill="x", pady=(0, 10))
        ttk.Button(toolbar, text="إضافة مكتب", command=self.add_office).pack(side="left", padx=4)
        ttk.Button(toolbar, text="تعديل المكتب", command=self.edit_office).pack(side="left", padx=4)
        ttk.Button(toolbar, text="تفعيل / إيقاف", command=self.toggle_selected_office).pack(side="left", padx=4)
        columns = ("id", "name", "building", "department", "room", "manager", "status")
        self.offices_tree = self._tree(
            self.offices_tab, columns,
            {"id": "المعرّف", "name": "المكتب", "building": "المبنى", "department": "القسم", "room": "الغرفة", "manager": "المسؤول", "status": "الحالة"},
        )

    def _build_movements_tab(self) -> None:
        columns = ("date", "asset", "type", "from", "to", "notes")
        self.movements_tree = self._tree(
            self.movements_tab, columns,
            {"date": "التاريخ", "asset": "الأصل", "type": "الحركة", "from": "من", "to": "إلى", "notes": "التفاصيل"},
            {"date": 150, "asset": 200, "type": 150, "from": 150, "to": 150, "notes": 300},
        )

    def _build_purchases_tab(self) -> None:
        toolbar = ttk.Frame(self.purchases_tab)
        toolbar.pack(fill="x", pady=(0, 10))
        ttk.Label(toolbar, text="الأصل المرتبط بالفاتورة").pack(side="right", padx=(8, 4))
        self.purchase_asset_choice = tk.StringVar()
        self.purchase_asset_combo = ttk.Combobox(
            toolbar, textvariable=self.purchase_asset_choice,
            state="readonly", width=52,
        )
        self.purchase_asset_combo.pack(side="right", padx=4)
        ttk.Button(toolbar, text="تسجيل فاتورة شراء", command=self.add_purchase_record).pack(side="left", padx=4)
        ttk.Button(toolbar, text="تحديث السجل", command=self.refresh_purchases).pack(side="left", padx=4)
        ttk.Label(
            self.purchases_tab,
            text="سجل الفواتير والضمانات المرتبطة بكل أصل. لا يغيّر تسجيل الفاتورة حالة الأصل أو بيانات العهدة.",
            style="Muted.TLabel",
        ).pack(anchor="e", pady=(0, 8))
        self.purchases_tree = self._tree(
            self.purchases_tab,
            ("id", "asset", "supplier", "invoice", "purchase_date", "warranty", "total_cost", "notes"),
            {
                "id": "المعرّف", "asset": "الأصل", "supplier": "المورد",
                "invoice": "رقم الفاتورة", "purchase_date": "تاريخ الشراء",
                "warranty": "انتهاء الضمان", "total_cost": "القيمة",
                "notes": "ملاحظات",
            },
            {"id": 180, "asset": 190, "supplier": 150, "invoice": 130,
             "purchase_date": 110, "warranty": 110, "total_cost": 100, "notes": 220},
        )

    def _build_documents_tab(self) -> None:
        toolbar = ttk.Frame(self.documents_tab)
        toolbar.pack(fill="x", pady=(0, 10))
        ttk.Label(toolbar, text="الأصل").pack(side="right", padx=(8, 4))
        self.document_asset_choice = tk.StringVar()
        self.document_asset_combo = ttk.Combobox(
            toolbar, textvariable=self.document_asset_choice,
            state="readonly", width=48,
        )
        self.document_asset_combo.pack(side="right", padx=4)
        self.document_asset_combo.bind("<<ComboboxSelected>>", lambda _event: self.refresh_documents())
        ttk.Button(toolbar, text="إرفاق مستند", command=self.attach_document).pack(side="left", padx=4)
        ttk.Button(toolbar, text="فتح المرفق", command=self.open_selected_document).pack(side="left", padx=4)
        ttk.Button(toolbar, text="تحديث", command=self.refresh_documents).pack(side="left", padx=4)
        ttk.Label(
            self.documents_tab,
            text="المرفقات تحفظ محلياً في مجلد البيانات، وتُربط بمعرّف الأصل. الأنواع المقبولة PDF وPNG وJPG وTXT، بحد أقصى 20 ميغابايت.",
            style="Muted.TLabel", wraplength=1000, justify="right",
        ).pack(anchor="e", pady=(0, 8))
        self.documents_tree = self._tree(
            self.documents_tab,
            ("id", "file", "type", "content_type", "size", "uploaded", "date"),
            {
                "id": "المعرّف", "file": "اسم الملف", "type": "التصنيف",
                "content_type": "نوع المحتوى", "size": "الحجم", "uploaded": "أضيف بواسطة",
                "date": "تاريخ الإرفاق",
            },
            {"id": 180, "file": 250, "type": 100, "content_type": 150,
             "size": 100, "uploaded": 150, "date": 120},
        )

    def _build_users_tab(self) -> None:
        toolbar = ttk.Frame(self.users_tab)
        toolbar.pack(fill="x", pady=(0, 10))
        ttk.Button(toolbar, text="إضافة مستخدم", command=self.add_local_user).pack(side="left", padx=4)
        ttk.Button(toolbar, text="تفعيل / إيقاف الحساب", command=self.toggle_selected_user).pack(side="left", padx=4)
        ttk.Button(toolbar, text="إعادة تعيين كلمة المرور", command=self.reset_selected_user_password).pack(side="left", padx=4)
        ttk.Button(toolbar, text="تحديث القائمة", command=self.refresh_users).pack(side="left", padx=4)
        ttk.Label(
            self.users_tab,
            text="يُخزّن النظام كلمات المرور بصيغة scrypt مع ملح عشوائي. الحساب الجديد يطلب تغيير كلمة المرور عند أول تسجيل دخول.",
            style="Muted.TLabel", wraplength=950, justify="right",
        ).pack(anchor="e", pady=(0, 8))
        self.users_tree = self._tree(
            self.users_tab,
            ("id", "username", "display_name", "role", "active", "last_login"),
            {
                "id": "المعرّف", "username": "اسم الدخول", "display_name": "اسم المستخدم",
                "role": "الصلاحية", "active": "الحالة", "last_login": "آخر دخول",
            },
            {"id": 210, "username": 150, "display_name": 200, "role": 130, "active": 100, "last_login": 170},
        )

    def _build_audit_tab(self) -> None:
        toolbar = ttk.Frame(self.audit_tab)
        toolbar.pack(fill="x", pady=(0, 10))
        ttk.Label(toolbar, text="بحث").pack(side="right", padx=(8, 3))
        self.audit_search = tk.StringVar()
        ttk.Entry(toolbar, textvariable=self.audit_search, width=28, justify="right").pack(side="right", padx=3)
        ttk.Label(toolbar, text="الكيان").pack(side="right", padx=(8, 3))
        self.audit_entity_filter = tk.StringVar(value="الكل")
        ttk.Combobox(
            toolbar,
            textvariable=self.audit_entity_filter,
            values=["الكل", "asset", "office", "custody_card", "maintenance_record",
                    "spare_part", "purchase_record", "asset_document", "app_user"],
            state="readonly",
            width=19,
        ).pack(side="right", padx=3)
        ttk.Label(toolbar, text="العملية").pack(side="right", padx=(8, 3))
        self.audit_action_filter = tk.StringVar(value="الكل")
        ttk.Combobox(
            toolbar,
            textvariable=self.audit_action_filter,
            values=["الكل", "created", "updated", "approved", "rejected", "returned",
                    "deactivated", "activated", "password_changed", "attached"],
            state="readonly",
            width=16,
        ).pack(side="right", padx=3)
        ttk.Button(toolbar, text="تطبيق التصفية", command=self.refresh_audit).pack(side="left", padx=4)
        ttk.Button(toolbar, text="تصدير CSV", command=self.export_audit_csv).pack(side="left", padx=4)
        ttk.Label(
            self.audit_tab,
            text="آخر 1000 عملية كحد أقصى. يظهر هذا السجل لمدير النظام فقط، ويحتفظ بهوية المنفّذ وتفاصيل العملية.",
            style="Muted.TLabel",
        ).pack(anchor="e", pady=(0, 8))
        self.audit_tree = self._tree(
            self.audit_tab,
            ("id", "date", "entity", "entity_id", "action", "actor", "details"),
            {
                "id": "معرف السجل", "date": "التاريخ UTC", "entity": "نوع الكيان",
                "entity_id": "معرف الكيان", "action": "العملية",
                "actor": "المنفذ", "details": "التفاصيل",
            },
            {"id": 170, "date": 155, "entity": 130, "entity_id": 170,
             "action": 120, "actor": 150, "details": 360},
        )

    def _build_reports_tab(self) -> None:
        panel = ttk.Frame(self.reports_tab, padding=16)
        panel.pack(fill="both", expand=True)
        ttk.Label(
            panel,
            text="تقرير شامل لإدارة الأصول",
            font=("Tahoma", 16, "bold"),
        ).pack(anchor="e", pady=(0, 8))
        ttk.Label(
            panel,
            text=(
                "ينشئ ملف Excel متعدد الأوراق يتضمن الملخص والأصول والمكاتب والعهدة "
                "وبنود العهدة والصيانة وقطع الغيار والمشتريات والمرفقات والحركات والتدقيق. "
                "التقرير للقراءة فقط ولا يغيّر بيانات النظام."
            ),
            style="Muted.TLabel",
            wraplength=980,
            justify="right",
        ).pack(anchor="e", pady=(0, 16))
        actions = ttk.Frame(panel)
        actions.pack(anchor="e")
        ttk.Button(
            actions,
            text="إنشاء تقرير Excel شامل",
            command=self.export_management_report,
        ).pack(side="right", padx=5)
        ttk.Button(
            actions,
            text="تحديث سجل التدقيق",
            command=self.refresh_audit,
        ).pack(side="right", padx=5)
        ttk.Button(
            actions,
            text="نسخة احتياطية كاملة",
            command=self.create_full_backup,
        ).pack(side="right", padx=5)
        self.report_status = tk.StringVar(value="جاهز لإنشاء التقرير.")
        ttk.Label(
            panel,
            textvariable=self.report_status,
            style="Muted.TLabel",
            wraplength=980,
            justify="right",
        ).pack(anchor="e", pady=(18, 0))

    def _build_excel_tab(self) -> None:
        panel = ttk.Frame(self.excel_tab)
        panel.pack(fill="x", pady=10)
        ttk.Label(panel, text="تبادل بيانات الأصول مع Excel", font=("Tahoma", 15, "bold")).pack(anchor="e", pady=(0, 8))
        ttk.Label(
            panel,
            text="الاستيراد يراجع الصفوف والأرقام التسلسلية المكررة، ثم يسجل نتيجة كل دفعة. "
                 "التصدير ينشئ ملف XLSX عربيّاً مع ترويسات وتصفية.",
            style="Muted.TLabel", wraplength=900, justify="right",
        ).pack(anchor="e", pady=(0, 12))
        buttons = ttk.Frame(panel)
        buttons.pack(anchor="e")
        ttk.Button(buttons, text="استيراد ملف Excel", command=self.import_excel).pack(side="right", padx=5)
        ttk.Button(buttons, text="تصدير جميع الأصول", command=self.export_excel).pack(side="right", padx=5)
        ttk.Button(buttons, text="تحميل قالب Excel", command=self.export_template).pack(side="right", padx=5)
        ttk.Label(panel, text="نتائج آخر عملية", font=("Tahoma", 11, "bold")).pack(anchor="e", pady=(20, 6))
        self.import_log = tk.Text(panel, height=18, wrap="word", font=("Tahoma", 10), state="disabled")
        self.import_log.pack(fill="both", expand=True)

    def _build_status_bar(self) -> None:
        self.status_var = tk.StringVar(value="جاهز")
        ttk.Label(self.root, textvariable=self.status_var, anchor="e", style="Muted.TLabel").pack(fill="x", padx=20, pady=(0, 8))

    def _set_status(self, message: str) -> None:
        self.status_var.set(message)

    def refresh_all(self) -> None:
        if not self._ensure_active_session():
            return
        self.refresh_dashboard()
        self.refresh_assets()
        self.refresh_custody()
        self.refresh_maintenance()
        self.refresh_spare_parts()
        self.refresh_purchases()
        self.refresh_documents()
        if hasattr(self, "users_tree"):
            self.refresh_users()
            self.refresh_audit()
        self.refresh_offices()
        self.refresh_movements()

    def refresh_dashboard(self) -> None:
        if not self._ensure_active_session():
            return
        with SessionLocal() as session:
            summary = get_dashboard_summary(session)
        for key, value in summary.__dict__.items() if hasattr(summary, "__dict__") else [
            (name, getattr(summary, name)) for name in summary.__dataclass_fields__
        ]:
            if key in self.stat_values:
                self.stat_values[key].configure(text=str(value))

    def refresh_assets(self) -> None:
        if not self._ensure_active_session():
            return
        with SessionLocal() as session:
            assets = list_assets(
                session, self.asset_search.get() if hasattr(self, "asset_search") else "",
                STATUS_OPTIONS.get(self.asset_status_filter.get(), "all")
                if hasattr(self, "asset_status_filter") else "all",
            )
        self.assets_tree.delete(*self.assets_tree.get_children())
        for asset in assets:
            self.assets_tree.insert("", "end", iid=asset.id, values=(
                asset.id,
                CATEGORY_LABELS.get(asset.category, asset.category),
                asset.brand,
                asset.model,
                asset.serial_number or "—",
                STATUS_LABELS.get(asset.status, asset.status),
                asset.office_name or "—",
                _display_date(asset.received_at),
            ))
        self._set_status(f"عدد الأصول المعروضة: {len(assets)}")

    def refresh_offices(self) -> None:
        if not self._ensure_active_session():
            return
        with SessionLocal() as session:
            offices = list_offices(session)
        self.offices_tree.delete(*self.offices_tree.get_children())
        for office in offices:
            self.offices_tree.insert("", "end", iid=office.id, values=(
                office.id, office.name, office.building or "—",
                office.department or "—", office.room or "—",
                office.manager or "—", "فعال" if office.is_active else "غير فعال",
            ))

    def refresh_movements(self) -> None:
        if not self._ensure_active_session():
            return
        with SessionLocal() as session:
            movements = list_recent_movements(session, 200)
        self.movements_tree.delete(*self.movements_tree.get_children())
        movement_labels = {
            "registered": "تسجيل أصل جديد", "transferred": "نقل موقع",
            "retired": "استبعاد",
        }
        for movement in movements:
            self.movements_tree.insert("", "end", iid=movement.id, values=(
                _display_date(movement.occurred_at),
                movement.asset_label,
                movement_labels.get(movement.movement_type, movement.movement_type),
                movement.from_office_name or "—",
                movement.to_office_name or "—",
                movement.notes or "",
            ))

    def refresh_custody(self) -> None:
        if not self._ensure_active_session():
            return
        if not hasattr(self, "custody_tree"):
            return
        with SessionLocal() as session:
            cards = list_custody_cards(session)
        self.custody_tree.delete(*self.custody_tree.get_children())
        status_labels = {"active": "فعالة", "returned": "معادة", "rejected": "مرفوضة"}
        approval_labels = {"pending": "بانتظار الاعتماد", "approved": "معتمدة", "rejected": "مرفوضة"}
        for card in cards:
            self.custody_tree.insert("", "end", iid=card.id, values=(
                card.id, card.card_number, card.responsible_name, card.office_name,
                len(card.items), status_labels.get(card.status, card.status),
                approval_labels.get(card.approval_status, card.approval_status),
            ))

    def refresh_maintenance(self) -> None:
        if not self._ensure_active_session():
            return
        if not hasattr(self, "maintenance_tree"):
            return
        with SessionLocal() as session:
            tickets = list_maintenance_tickets(session)
        self.maintenance_tree.delete(*self.maintenance_tree.get_children())
        self._maintenance_ticket_ids: dict[str, str] = {}
        options: list[str] = []
        priority_labels = {"low": "منخفضة", "normal": "عادية", "high": "عالية", "urgent": "عاجلة"}
        status_labels = {"open": "مفتوح", "inProgress": "قيد التنفيذ", "completed": "مكتمل", "cancelled": "ملغى"}
        for ticket in tickets:
            display = f"{ticket.id[:8]} — {ticket.title} — {ticket.asset_label}"
            self._maintenance_ticket_ids[display] = ticket.id
            options.append(display)
            self.maintenance_tree.insert("", "end", iid=ticket.id, values=(
                ticket.id, ticket.asset_label, ticket.title,
                priority_labels.get(ticket.priority, ticket.priority),
                status_labels.get(ticket.status, ticket.status),
                ticket.technician or "—", f"{ticket.parts_cost:.2f}",
                _display_date(ticket.reported_at),
            ))
        if hasattr(self, "maintenance_ticket_combo"):
            current = self.maintenance_ticket_choice.get()
            self.maintenance_ticket_combo.configure(values=options)
            if current not in options:
                self.maintenance_ticket_choice.set(options[0] if options else "")

    def refresh_spare_parts(self) -> None:
        if not self._ensure_active_session():
            return
        if not hasattr(self, "spare_parts_tree"):
            return
        with SessionLocal() as session:
            parts = list_spare_parts(session)
        self.spare_parts_tree.delete(*self.spare_parts_tree.get_children())
        for part in parts:
            low = part.quantity <= part.minimum_quantity
            self.spare_parts_tree.insert("", "end", iid=part.id, values=(
                part.id, part.sku, part.name, f"{part.quantity:g}",
                f"{part.minimum_quantity:g}", f"{part.unit_cost:.2f}",
                part.supplier or "—", "يحتاج تزويد" if low else "متوفر",
            ), tags=("low",) if low else ())
        self.spare_parts_tree.tag_configure("low", background="#fff0e8")

    def refresh_purchases(self) -> None:
        if not self._ensure_active_session():
            return
        if not hasattr(self, "purchases_tree"):
            return
        with SessionLocal() as session:
            assets = list_assets(session)
            records = list_purchase_records(session)

        self._purchase_asset_ids = {}
        choices: list[str] = []
        for asset in assets:
            label = f"{asset.brand} {asset.model} — {asset.serial_number or asset.id[:8]}"
            self._purchase_asset_ids[label] = asset.id
            choices.append(label)
        current_choice = self.purchase_asset_choice.get()
        self.purchase_asset_combo.configure(values=choices)
        if current_choice not in choices:
            self.purchase_asset_choice.set(choices[0] if choices else "")

        self.purchases_tree.delete(*self.purchases_tree.get_children())
        for record in records:
            self.purchases_tree.insert("", "end", iid=record.id, values=(
                record.id,
                record.asset_label,
                record.supplier,
                record.invoice_number,
                record.purchase_date,
                record.warranty_until or "—",
                f"{record.total_cost:,.2f}",
                record.notes or "—",
            ))

    def refresh_documents(self) -> None:
        if not self._ensure_active_session():
            return
        if not hasattr(self, "documents_tree"):
            return
        with SessionLocal() as session:
            assets = list_assets(session)
            selected_asset_id = getattr(self, "_document_asset_ids", {}).get(
                self.document_asset_choice.get()
            )
            if selected_asset_id not in {asset.id for asset in assets}:
                selected_asset_id = assets[0].id if assets else None
            documents = list_asset_documents(session, selected_asset_id) if selected_asset_id else []

        self._document_asset_ids = {}
        choices: list[str] = []
        for asset in assets:
            label = f"{asset.brand} {asset.model} — {asset.serial_number or asset.id[:8]}"
            self._document_asset_ids[label] = asset.id
            choices.append(label)
        self.document_asset_combo.configure(values=choices)
        selected_label = next(
            (label for label, asset_id in self._document_asset_ids.items() if asset_id == selected_asset_id),
            "",
        )
        self.document_asset_choice.set(selected_label)

        self.documents_tree.delete(*self.documents_tree.get_children())
        type_labels = {
            "invoice": "فاتورة", "warranty": "ضمان", "manual": "دليل",
            "photo": "صورة", "other": "أخرى",
        }
        for document in documents:
            self.documents_tree.insert("", "end", iid=document.id, values=(
                document.id,
                document.file_name,
                type_labels.get(document.document_type, document.document_type),
                document.content_type,
                f"{document.size_bytes / 1024:.1f} KB",
                document.uploaded_by,
                _display_date(document.created_at),
            ))

    def attach_document(self) -> None:
        if not self._ensure_active_session():
            return
        asset_label = self.document_asset_choice.get()
        asset_id = getattr(self, "_document_asset_ids", {}).get(asset_label)
        if not asset_id:
            messagebox.showinfo("اختر الأصل", "اختر الأصل الذي تريد إرفاق المستند به.", parent=self.root)
            return
        source = filedialog.askopenfilename(
            parent=self.root,
            title="اختر مستند الأصل",
            filetypes=[("مستندات مسموحة", "*.pdf *.png *.jpg *.jpeg *.txt")],
        )
        if not source:
            return
        raw_type = simpledialog.askstring(
            "تصنيف المستند",
            "اكتب التصنيف: invoice / warranty / manual / photo / other",
            initialvalue="other",
            parent=self.root,
        )
        if raw_type is None:
            return
        type_map = {
            "فاتورة": "invoice", "ضمان": "warranty", "دليل": "manual",
            "صورة": "photo", "أخرى": "other",
        }
        document_type = type_map.get(raw_type.strip(), raw_type.strip().lower())
        try:
            with SessionLocal() as session:
                document = attach_asset_document(
                    session,
                    asset_id=asset_id,
                    source_path=source,
                    uploaded_by=self.actor_name,
                    document_type=document_type,
                )
            self.refresh_documents()
            messagebox.showinfo(
                "تم إرفاق المستند",
                f"تم حفظ {document.file_name} وربطه بالأصل المحدد.",
                parent=self.root,
            )
        except Exception as exc:
            messagebox.showerror("تعذر إرفاق المستند", str(exc), parent=self.root)

    def open_selected_document(self) -> None:
        if not self._ensure_active_session():
            return
        selected = self.documents_tree.selection()
        if not selected:
            messagebox.showinfo("فتح المرفق", "حدد مستنداً من الجدول أولاً.", parent=self.root)
            return
        try:
            with SessionLocal() as session:
                document = session.get(AssetDocument, selected[0])
                if document is None:
                    raise ValueError("المرفق لم يعد موجوداً في قاعدة البيانات.")
                path = resolve_asset_document_path(document)
            webbrowser.open(path.as_uri())
        except Exception as exc:
            messagebox.showerror("تعذر فتح المرفق", str(exc), parent=self.root)

    def refresh_audit(self) -> None:
        if not self._ensure_active_session(admin_only=True):
            return
        if self.user.role != "admin" or not hasattr(self, "audit_tree"):
            return
        entity_type = self.audit_entity_filter.get()
        action = self.audit_action_filter.get()
        with SessionLocal() as session:
            try:
                require_active_admin(session, self.user)
            except PermissionError:
                self.audit_tree.delete(*self.audit_tree.get_children())
                if hasattr(self, "report_status"):
                    self.report_status.set("تم إيقاف صلاحية هذا الحساب؛ أُخفي سجل التدقيق.")
                return
            rows = list_audit_logs(
                session,
                search=self.audit_search.get(),
                entity_type="" if entity_type == "الكل" else entity_type,
                action="" if action == "الكل" else action,
                limit=1000,
            )
        self.audit_tree.delete(*self.audit_tree.get_children())
        for row in rows:
            timestamp = row.occurred_at
            if timestamp.tzinfo is None:
                timestamp_text = timestamp.replace(tzinfo=timezone.utc).strftime("%Y-%m-%d %H:%M")
            else:
                timestamp_text = timestamp.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")
            self.audit_tree.insert("", "end", iid=row.id, values=(
                row.id,
                timestamp_text,
                row.entity_type,
                row.entity_id,
                row.action,
                row.actor_name,
                row.details or "",
            ))
        if hasattr(self, "report_status"):
            self.report_status.set(f"تم تحميل {len(rows)} سجل تدقيق.")

    def export_audit_csv(self) -> None:
        if not self._ensure_active_session(admin_only=True):
            return
        if self.user.role != "admin":
            messagebox.showerror("غير مسموح", "تصدير سجل التدقيق يتطلب صلاحية مدير النظام.", parent=self.root)
            return
        destination = filedialog.asksaveasfilename(
            parent=self.root,
            title="تصدير سجل التدقيق",
            defaultextension=".csv",
            initialfile="ITFix-Audit-Log.csv",
            filetypes=[("CSV", "*.csv")],
        )
        if not destination:
            return
        try:
            with SessionLocal() as session:
                require_active_admin(session, self.user)
                entity_type = self.audit_entity_filter.get()
                action = self.audit_action_filter.get()
                count = export_audit_logs_to_csv(
                    session,
                    destination,
                    search=self.audit_search.get(),
                    entity_type="" if entity_type == "الكل" else entity_type,
                    action="" if action == "الكل" else action,
                    limit=10000,
                )
            messagebox.showinfo(
                "تم تصدير سجل التدقيق",
                f"تم تصدير {count} سجلاً إلى الملف المحدد.",
                parent=self.root,
            )
        except Exception as exc:
            messagebox.showerror("تعذر تصدير السجل", str(exc), parent=self.root)

    def export_management_report(self) -> None:
        if not self._ensure_active_session(admin_only=True):
            return
        if self.user.role != "admin":
            messagebox.showerror("غير مسموح", "إنشاء التقرير الشامل يتطلب صلاحية مدير النظام.", parent=self.root)
            return
        destination = filedialog.asksaveasfilename(
            parent=self.root,
            title="حفظ التقرير الشامل",
            defaultextension=".xlsx",
            initialfile="ITFix-Management-Report.xlsx",
            filetypes=[("Excel workbook", "*.xlsx")],
        )
        if not destination:
            return
        try:
            with SessionLocal() as session:
                require_active_admin(session, self.user)
                sheets = export_management_report(session, destination)
            self.report_status.set(
                f"اكتمل التقرير بنجاح: {sheets} ورقة عمل. تم حفظ الملف في: {destination}"
            )
            messagebox.showinfo(
                "اكتمل التقرير",
                f"تم إنشاء التقرير الشامل بنجاح بعدد {sheets} ورقة عمل.",
                parent=self.root,
            )
        except Exception as exc:
            messagebox.showerror("تعذر إنشاء التقرير", str(exc), parent=self.root)

    def create_full_backup(self) -> None:
        if not self._ensure_active_session(admin_only=True):
            return
        if self.user.role != "admin":
            messagebox.showerror(
                "غير مسموح",
                "إنشاء النسخ الاحتياطية يتطلب صلاحية مدير النظام.",
                parent=self.root,
            )
            return
        destination = filedialog.asksaveasfilename(
            parent=self.root,
            title="حفظ النسخة الاحتياطية الكاملة",
            defaultextension=".zip",
            initialfile=f"ITFix-Backup-{datetime.now():%Y%m%d-%H%M%S}.zip",
            filetypes=[("نسخة IT Fix الاحتياطية", "*.zip")],
        )
        if not destination:
            return
        try:
            with SessionLocal() as session:
                require_active_admin(session, self.user)
            result = create_backup_archive(
                destination,
                database_engine=database_engine,
            )
            self.report_status.set(
                f"تم إنشاء النسخة الاحتياطية: {result.file_path} — "
                f"المرفقات: {result.attachment_count} — "
                f"الحجم: {result.archive_bytes:,} بايت."
            )
            messagebox.showwarning(
                "تم إنشاء النسخة الاحتياطية",
                f"تم حفظ نسخة قاعدة البيانات والمرفقات بنجاح.\n"
                f"قاعدة البيانات: {result.database_type}\n"
                f"عدد المرفقات: {result.attachment_count}\n"
                f"الحجم: {result.archive_bytes:,} بايت.\n\n"
                "تنبيه أمني: ملف ZIP غير مشفّر بكلمة مرور ويحتوي بيانات الأصول والمرفقات؛ "
                "احفظه في موقع محمي ومقيّد الصلاحيات.",
                parent=self.root,
            )
        except Exception as exc:
            messagebox.showerror(
                "تعذر إنشاء النسخة الاحتياطية",
                str(exc),
                parent=self.root,
            )

    def refresh_users(self) -> None:
        if not self._ensure_active_session(admin_only=True):
            return
        if not hasattr(self, "users_tree") or self.user.role != "admin":
            return
        with SessionLocal() as session:
            try:
                require_active_admin(session, self.user)
            except PermissionError:
                self.users_tree.delete(*self.users_tree.get_children())
                return
            users = list_users(session)
        self.users_tree.delete(*self.users_tree.get_children())
        role_labels = {"admin": "مدير النظام", "it_manager": "مدير الأصول"}
        for item in users:
            self.users_tree.insert("", "end", iid=item.id, values=(
                item.id,
                item.username,
                item.display_name,
                role_labels.get(item.role, item.role),
                "فعال" if item.is_active else "موقوف",
                _display_date(item.last_login_at),
            ))

    def add_local_user(self) -> None:
        if not self._ensure_active_session(admin_only=True):
            return
        if self.user.role != "admin":
            messagebox.showerror("غير مسموح", "إنشاء المستخدمين يتطلب صلاحية مدير النظام.", parent=self.root)
            return
        username = simpledialog.askstring("إضافة مستخدم", "اسم الدخول (أحرف إنجليزية):", parent=self.root)
        if username is None:
            return
        display_name = simpledialog.askstring("إضافة مستخدم", "الاسم الظاهر:", parent=self.root)
        if display_name is None:
            return
        password = simpledialog.askstring(
            "كلمة المرور الأولية", "كلمة مرور أولية (12 محرفاً على الأقل):",
            show="*", parent=self.root,
        )
        if password is None:
            return
        confirm = simpledialog.askstring("تأكيد كلمة المرور", "أعد إدخال كلمة المرور:", show="*", parent=self.root)
        if confirm is None:
            return
        if password != confirm:
            messagebox.showerror("كلمتا المرور مختلفتان", "أعد العملية وتأكد من تطابق كلمتي المرور.", parent=self.root)
            return
        role_choice = simpledialog.askstring(
            "دور المستخدم", "اكتب: admin لمدير النظام أو it_manager لمدير الأصول:",
            initialvalue="it_manager", parent=self.root,
        )
        if role_choice is None:
            return
        role = role_choice.strip().lower()
        try:
            with SessionLocal() as session:
                created = create_user(
                    session, self.user, username, display_name, password, role
                )
            self.refresh_users()
            messagebox.showinfo(
                "تم إنشاء الحساب",
                f"تم إنشاء حساب {created.username}. سيُطلب من صاحبه تغيير كلمة المرور عند أول دخول.",
                parent=self.root,
            )
        except Exception as exc:
            messagebox.showerror("تعذر إنشاء الحساب", str(exc), parent=self.root)

    def toggle_selected_user(self) -> None:
        if not self._ensure_active_session(admin_only=True):
            return
        selected = self.users_tree.selection() if hasattr(self, "users_tree") else ()
        if not selected:
            messagebox.showinfo("تحديد مستخدم", "حدد حساباً من الجدول أولاً.", parent=self.root)
            return
        target_id = selected[0]
        if target_id == self.user.id:
            messagebox.showwarning(
                "الحساب الحالي",
                "لا توقف الحساب الذي تستخدمه حالياً من داخل جلسته.",
                parent=self.root,
            )
            return
        try:
            with SessionLocal() as session:
                target = session.get(AppUser, target_id)
                if target is None:
                    raise ValueError("الحساب المطلوب غير موجود.")
                next_state = not target.is_active
                state_label = "تفعيل" if next_state else "إيقاف"
                if not messagebox.askyesno(
                    state_label + " حساب",
                    f"هل تريد {state_label} حساب {target.username}؟",
                    parent=self.root,
                ):
                    return
                set_user_active(session, self.user, target.id, next_state)
            self.refresh_users()
        except Exception as exc:
            messagebox.showerror("تعذر تغيير حالة الحساب", str(exc), parent=self.root)

    def reset_selected_user_password(self) -> None:
        if not self._ensure_active_session(admin_only=True):
            return
        selected = self.users_tree.selection() if hasattr(self, "users_tree") else ()
        if not selected:
            messagebox.showinfo("تحديد مستخدم", "حدد حساباً من الجدول أولاً.", parent=self.root)
            return
        target_id = selected[0]
        if target_id == self.user.id:
            messagebox.showwarning(
                "الحساب الحالي",
                "استخدم زر تغيير كلمة المرور لتحديث كلمة مرور حسابك.",
                parent=self.root,
            )
            return

        temporary = simpledialog.askstring(
            "إعادة تعيين كلمة المرور",
            "أدخل كلمة مرور مؤقتة قوية (12 محرفاً على الأقل):",
            show="*",
            parent=self.root,
        )
        if temporary is None:
            return
        confirmation = simpledialog.askstring(
            "تأكيد كلمة المرور المؤقتة",
            "أعد إدخال كلمة المرور المؤقتة:",
            show="*",
            parent=self.root,
        )
        if confirmation is None:
            return
        if temporary != confirmation:
            messagebox.showerror(
                "كلمتا المرور غير متطابقتين",
                "أعد العملية وتأكد من تطابق كلمتي المرور.",
                parent=self.root,
            )
            return

        try:
            with SessionLocal() as session:
                target = reset_user_password(
                    session,
                    self.user,
                    target_id,
                    temporary,
                )
            messagebox.showinfo(
                "تمت إعادة تعيين كلمة المرور",
                f"تم تعيين كلمة مرور مؤقتة للحساب {target.username}. "
                "سيُجبر المستخدم على تغييرها عند تسجيل الدخول التالي.",
                parent=self.root,
            )
            self.refresh_users()
        except Exception as exc:
            messagebox.showerror(
                "تعذر إعادة تعيين كلمة المرور",
                str(exc),
                parent=self.root,
            )

    def change_password(self) -> None:
        if not self._ensure_active_session():
            return
        current = simpledialog.askstring(
            "تغيير كلمة المرور", "كلمة المرور الحالية:", show="*", parent=self.root
        )
        if current is None:
            return
        new = simpledialog.askstring(
            "تغيير كلمة المرور", "كلمة المرور الجديدة (12 محرفاً على الأقل):",
            show="*", parent=self.root,
        )
        if new is None:
            return
        confirm = simpledialog.askstring(
            "تأكيد كلمة المرور", "أعد إدخال كلمة المرور الجديدة:",
            show="*", parent=self.root,
        )
        if confirm is None:
            return
        if new != confirm:
            messagebox.showerror("كلمتا المرور مختلفتان", "كلمتا المرور غير متطابقتين.", parent=self.root)
            return
        try:
            with SessionLocal() as session:
                change_own_password(session, self.user.id, current, new)
            self.user.must_change_password = False
            messagebox.showinfo("تم التغيير", "تم تحديث كلمة المرور بنجاح.", parent=self.root)
        except Exception as exc:
            messagebox.showerror("تعذر تغيير كلمة المرور", str(exc), parent=self.root)

    def logout(self) -> None:
        if messagebox.askyesno("تسجيل الخروج", "هل تريد إنهاء الجلسة وإغلاق التطبيق؟", parent=self.root):
            self.root.destroy()

    def _selected_custody(self) -> CustodyCard | None:
        selected = self.custody_tree.selection()
        if not selected:
            messagebox.showinfo("تحديد بطاقة", "حدد بطاقة عهدة أولاً.", parent=self.root)
            return None
        with SessionLocal() as session:
            return session.get(CustodyCard, selected[0])

    def _selected_maintenance(self) -> MaintenanceRecord | None:
        selected = self.maintenance_tree.selection()
        if not selected:
            messagebox.showinfo("تحديد طلب", "حدد طلب صيانة أولاً.", parent=self.root)
            return None
        with SessionLocal() as session:
            return session.get(MaintenanceRecord, selected[0])

    def _selected_spare_part(self) -> SparePart | None:
        selected = self.spare_parts_tree.selection()
        if not selected:
            messagebox.showinfo("تحديد قطعة", "حدد قطعة غيار من الجدول أولاً.", parent=self.root)
            return None
        with SessionLocal() as session:
            return session.get(SparePart, selected[0])

    def add_custody_card(self) -> None:
        if not self._ensure_active_session():
            return
        with SessionLocal() as session:
            offices = list_offices(session, active_only=True)
            available_assets = [
                asset for asset in list_assets(session)
                if asset.status in {"available", "returned"}
            ]
        card_number = simpledialog.askstring(
            "بطاقة عهدة", "رقم البطاقة:",
            initialvalue=f"CR-{datetime.now():%y%m%d%H%M}", parent=self.root,
        )
        if not card_number:
            return
        responsible = simpledialog.askstring("بطاقة عهدة", "اسم الموظف المستلم:", parent=self.root)
        if not responsible:
            return
        office_default = offices[0].name if offices else "المستودع الرئيسي"
        office_name = simpledialog.askstring(
            "بطاقة عهدة",
            "المكتب / الجهة المستلمة:\n" + "\n".join(item.name for item in offices),
            initialvalue=office_default,
            parent=self.root,
        )
        if not office_name:
            return

        item_count = simpledialog.askinteger(
            "بنود بطاقة العهدة",
            "كم بنداً تريد إضافته إلى البطاقة؟ (1–50)",
            initialvalue=1,
            minvalue=1,
            maxvalue=50,
            parent=self.root,
        )
        if item_count is None:
            return

        asset_hint = "\n".join(
            f"{asset.serial_number or 'بدون رقم'} — {asset.brand} {asset.model}"
            for asset in available_assets[:35]
        )
        items: list[CustodyItemInput] = []
        used_asset_ids: set[str] = set()
        for index in range(1, item_count + 1):
            serial = simpledialog.askstring(
                f"بند العهدة {index}/{item_count}",
                "أدخل الرقم التسلسلي لأصل متاح لربطه، أو اتركه فارغاً لإدخال مادة يدوية.\n" + asset_hint,
                parent=self.root,
            )
            if serial is None:
                return
            linked_asset = None
            if serial.strip():
                with SessionLocal() as session:
                    linked_asset = session.scalar(select(Asset).where(
                        Asset.serial_key == serial.strip().upper()
                    ).limit(1))
                if linked_asset is None or linked_asset.status not in {"available", "returned"}:
                    messagebox.showerror(
                        "أصل غير متاح",
                        f"لم يتم العثور على أصل متاح بالرقم {serial.strip()}.",
                        parent=self.root,
                    )
                    return
                if linked_asset.id in used_asset_ids:
                    messagebox.showerror(
                        "تكرار الأصل",
                        "لا يمكن إضافة الأصل نفسه أكثر من مرة في البطاقة.",
                        parent=self.root,
                    )
                    return
                used_asset_ids.add(linked_asset.id)
                item_name = f"{linked_asset.brand} {linked_asset.model}".strip()
                quantity = 1.0
                unit = "جهاز"
            else:
                item_name = simpledialog.askstring(
                    f"بند العهدة {index}/{item_count}",
                    "اسم المادة أو الجهاز:",
                    parent=self.root,
                ) or ""
                if not item_name.strip():
                    messagebox.showerror("بيانات ناقصة", "اسم بند العهدة مطلوب.", parent=self.root)
                    return
                quantity = simpledialog.askfloat(
                    "كمية البند", f"الكمية لـ {item_name}:",
                    initialvalue=1.0, minvalue=0.0001, parent=self.root,
                )
                if quantity is None:
                    return
                unit = simpledialog.askstring(
                    "وحدة القياس", "وحدة البند (جهاز، قطعة، صندوق...):",
                    initialvalue="قطعة", parent=self.root,
                ) or "قطعة"

            items.append(CustodyItemInput(
                item_name=item_name,
                quantity=quantity,
                unit=unit,
                asset_id=linked_asset.id if linked_asset else None,
            ))

        try:
            with SessionLocal() as session:
                create_custody_card(
                    session,
                    card_number=card_number,
                    responsible_name=responsible,
                    office_name=office_name,
                    items=items,
                    actor_name=self.actor_name,
                )
            self.refresh_all()
            messagebox.showinfo(
                "تم إنشاء البطاقة",
                f"أُنشئت بطاقة العهدة وبها {len(items)} بنداً بانتظار الاعتماد. "
                "لا تتغير حالة الأصول المرتبطة قبل اعتماد البطاقة.",
                parent=self.root,
            )
        except Exception as exc:
            messagebox.showerror("تعذر إنشاء البطاقة", str(exc), parent=self.root)

    def approve_selected_custody(self) -> None:
        if not self._ensure_active_session():
            return
        card = self._selected_custody()
        if card is None:
            return
        try:
            with SessionLocal() as session:
                approve_custody_card(session, card.id, self.actor_name)
            self.refresh_all()
            messagebox.showinfo("تم الاعتماد", "تم اعتماد بطاقة العهدة وتحديث حالة الأصول المرتبطة.", parent=self.root)
        except Exception as exc:
            messagebox.showerror("تعذر الاعتماد", str(exc), parent=self.root)

    def reject_selected_custody(self) -> None:
        if not self._ensure_active_session():
            return
        card = self._selected_custody()
        if card is None:
            return
        reason = simpledialog.askstring("رفض بطاقة عهدة", "سبب الرفض:", parent=self.root)
        if not reason:
            return
        try:
            with SessionLocal() as session:
                reject_custody_card(session, card.id, self.actor_name, reason)
            self.refresh_all()
            messagebox.showinfo("تم الرفض", "تم رفض البطاقة وحفظ سبب الرفض.", parent=self.root)
        except Exception as exc:
            messagebox.showerror("تعذر الرفض", str(exc), parent=self.root)

    def return_selected_custody(self) -> None:
        if not self._ensure_active_session():
            return
        card = self._selected_custody()
        if card is None:
            return
        notes = simpledialog.askstring("إرجاع العهدة", "ملاحظات الإرجاع (اختياري):", parent=self.root) or ""
        try:
            with SessionLocal() as session:
                return_custody_card(session, card.id, self.actor_name, notes)
            self.refresh_all()
            messagebox.showinfo("تم الإرجاع", "تم إغلاق بطاقة العهدة وتحديث حالة الأجهزة المرتبطة.", parent=self.root)
        except Exception as exc:
            messagebox.showerror("تعذر الإرجاع", str(exc), parent=self.root)

    def add_maintenance_ticket(self) -> None:
        if not self._ensure_active_session():
            return
        with SessionLocal() as session:
            assets = [
                asset for asset in list_assets(session)
                if asset.status not in {"retired", "maintenance"}
            ]
        if not assets:
            messagebox.showinfo("الصيانة", "لا توجد أصول متاحة لفتح طلب صيانة.", parent=self.root)
            return
        serial = simpledialog.askstring(
            "فتح طلب صيانة",
            "أدخل الرقم التسلسلي للأصل:\n" + "\n".join(
                f"{asset.serial_number or 'بدون رقم'} — {asset.brand} {asset.model}"
                for asset in assets[:30]
            ),
            parent=self.root,
        )
        if not serial:
            return
        with SessionLocal() as session:
            asset = session.scalar(select(Asset).where(
                Asset.serial_key == serial.strip().upper()
            ).limit(1))
        if asset is None:
            messagebox.showerror("الأصل غير موجود", "لم أجد أصلاً بهذا الرقم التسلسلي.", parent=self.root)
            return
        title = simpledialog.askstring("فتح طلب صيانة", "عنوان العطل:", parent=self.root)
        if not title:
            return
        description = simpledialog.askstring("وصف العطل", "اشرح العطل أو المشكلة:", parent=self.root)
        if not description:
            return
        priority_ar = simpledialog.askstring(
            "أولوية الصيانة", "الأولوية: منخفضة / عادية / عالية / عاجلة",
            initialvalue="عادية", parent=self.root,
        ) or "عادية"
        priority = {"منخفضة": "low", "عادية": "normal", "عالية": "high", "عاجلة": "urgent"}.get(priority_ar, "normal")
        technician = simpledialog.askstring("الفني", "اسم الفني المسؤول (اختياري):", parent=self.root) or ""
        try:
            with SessionLocal() as session:
                open_maintenance_ticket(
                    session, asset.id, title, description, priority, technician, self.actor_name
                )
            self.refresh_all()
            messagebox.showinfo("تم فتح الطلب", "تم تسجيل طلب الصيانة وتحويل حالة الأصل إلى قيد الصيانة.", parent=self.root)
        except Exception as exc:
            messagebox.showerror("تعذر فتح الطلب", str(exc), parent=self.root)

    def start_selected_maintenance(self) -> None:
        if not self._ensure_active_session():
            return
        ticket = self._selected_maintenance()
        if ticket is None:
            return
        try:
            with SessionLocal() as session:
                update_maintenance_ticket(
                    session, ticket.id, "inProgress", self.actor_name
                )
            self.refresh_all()
        except Exception as exc:
            messagebox.showerror("تعذر تحديث الطلب", str(exc), parent=self.root)

    def complete_selected_maintenance(self) -> None:
        if not self._ensure_active_session():
            return
        ticket = self._selected_maintenance()
        if ticket is None:
            return
        resolution = simpledialog.askstring("إكمال الصيانة", "الإصلاح الذي تم تنفيذه:", parent=self.root)
        if not resolution:
            return
        cost_text = simpledialog.askstring("تكلفة الصيانة", "تكلفة أجور الصيانة (رقم):", initialvalue="0", parent=self.root) or "0"
        try:
            cost = float(cost_text.replace(",", "."))
            with SessionLocal() as session:
                update_maintenance_ticket(
                    session, ticket.id, "completed", self.actor_name,
                    resolution=resolution, cost=cost,
                )
            self.refresh_all()
            messagebox.showinfo("تم إكمال الصيانة", "تم إغلاق الطلب وإرجاع الأصل إلى حالته السابقة.", parent=self.root)
        except Exception as exc:
            messagebox.showerror("تعذر إكمال الصيانة", str(exc), parent=self.root)

    def cancel_selected_maintenance(self) -> None:
        if not self._ensure_active_session():
            return
        ticket = self._selected_maintenance()
        if ticket is None:
            return
        if not messagebox.askyesno("إلغاء طلب الصيانة", "هل تريد إلغاء الطلب وإرجاع الأصل إلى حالته السابقة؟", parent=self.root):
            return
        try:
            with SessionLocal() as session:
                update_maintenance_ticket(session, ticket.id, "cancelled", self.actor_name)
            self.refresh_all()
        except Exception as exc:
            messagebox.showerror("تعذر إلغاء الطلب", str(exc), parent=self.root)

    def add_purchase_record(self) -> None:
        if not self._ensure_active_session():
            return
        asset_label = self.purchase_asset_choice.get()
        asset_id = getattr(self, "_purchase_asset_ids", {}).get(asset_label)
        if not asset_id:
            messagebox.showinfo("اختر الأصل", "أضف أصلاً إلى سجل الجرد أولاً ثم اختره هنا.", parent=self.root)
            return

        supplier = simpledialog.askstring("فاتورة شراء", "اسم المورد:", parent=self.root)
        if supplier is None:
            return
        invoice_number = simpledialog.askstring("فاتورة شراء", "رقم الفاتورة:", parent=self.root)
        if invoice_number is None:
            return
        purchase_date = simpledialog.askstring(
            "فاتورة شراء", "تاريخ الشراء (YYYY-MM-DD):",
            initialvalue=datetime.now().date().isoformat(), parent=self.root,
        )
        if purchase_date is None:
            return
        warranty_until = simpledialog.askstring(
            "الضمان", "تاريخ انتهاء الضمان (YYYY-MM-DD) — اتركه فارغاً إن لم يوجد:",
            parent=self.root,
        )
        if warranty_until is None:
            return
        total_cost_text = simpledialog.askstring("قيمة الفاتورة", "إجمالي القيمة:", initialvalue="0", parent=self.root)
        if total_cost_text is None:
            return
        try:
            total_cost = float(total_cost_text.replace(",", ".").replace("٫", "."))
        except ValueError:
            messagebox.showerror("قيمة غير صحيحة", "أدخل قيمة رقمية صحيحة للفاتورة.", parent=self.root)
            return
        notes = simpledialog.askstring("ملاحظات الفاتورة", "ملاحظات (اختياري):", parent=self.root) or ""

        try:
            with SessionLocal() as session:
                create_purchase_record(
                    session,
                    asset_id=asset_id,
                    supplier=supplier,
                    invoice_number=invoice_number,
                    purchase_date=purchase_date,
                    warranty_until=warranty_until,
                    total_cost=total_cost,
                    notes=notes,
                    actor_name=self.actor_name,
                )
            self.refresh_purchases()
            messagebox.showinfo("تم التسجيل", "تم ربط الفاتورة بالأصل وإضافتها إلى سجل المشتريات.", parent=self.root)
        except Exception as exc:
            messagebox.showerror("تعذر تسجيل الفاتورة", str(exc), parent=self.root)

    def add_spare_part(self) -> None:
        if not self._ensure_active_session():
            return
        name = simpledialog.askstring("قطعة غيار", "اسم القطعة:", parent=self.root)
        if not name:
            return
        sku = simpledialog.askstring("قطعة غيار", "رمز القطعة SKU:", parent=self.root)
        if not sku:
            return
        values: list[float] = []
        for prompt, initial in [
            ("الكمية الحالية:", "0"),
            ("الحد الأدنى للمخزون:", "0"),
            ("سعر الوحدة:", "0"),
        ]:
            raw = simpledialog.askstring("بيانات المخزون", prompt, initialvalue=initial, parent=self.root)
            if raw is None:
                return
            try:
                values.append(float(raw.replace(",", ".")))
            except ValueError:
                messagebox.showerror("قيمة غير صحيحة", "أدخل قيمة رقمية صحيحة.", parent=self.root)
                return
        supplier = simpledialog.askstring("المورد", "اسم المورد (اختياري):", parent=self.root) or ""
        try:
            with SessionLocal() as session:
                create_spare_part(session, name, sku, values[0], values[1], values[2], supplier)
            self.refresh_spare_parts()
            messagebox.showinfo("تمت الإضافة", "تم تسجيل قطعة الغيار في المخزون.", parent=self.root)
        except Exception as exc:
            messagebox.showerror("تعذر حفظ القطعة", str(exc), parent=self.root)

    def consume_selected_spare_part(self) -> None:
        if not self._ensure_active_session():
            return
        part = self._selected_spare_part()
        if part is None:
            return
        ticket_label = self.maintenance_ticket_choice.get()
        ticket_id = getattr(self, "_maintenance_ticket_ids", {}).get(ticket_label)
        if not ticket_id:
            messagebox.showinfo("اختر طلب صيانة", "اختر طلب الصيانة من القائمة قبل صرف القطعة.", parent=self.root)
            return
        quantity_text = simpledialog.askstring("صرف قطعة غيار", "الكمية المراد صرفها:", initialvalue="1", parent=self.root)
        if not quantity_text:
            return
        try:
            quantity = float(quantity_text.replace(",", "."))
            with SessionLocal() as session:
                consume_spare_part(
                    session, part.id, ticket_id, quantity,
                    actor_name=self.actor_name,
                )
            self.refresh_all()
            messagebox.showinfo("تم صرف القطعة", "تم خصم الكمية وتحديث تكلفة قطع الغيار في طلب الصيانة.", parent=self.root)
        except Exception as exc:
            messagebox.showerror("تعذر صرف القطعة", str(exc), parent=self.root)

    def _selected_asset(self) -> Asset | None:
        selected = self.assets_tree.selection()
        if not selected:
            messagebox.showinfo("تحديد أصل", "حدد أصلاً من الجدول أولاً.", parent=self.root)
            return None
        with SessionLocal() as session:
            return session.get(Asset, selected[0])

    def add_asset(self) -> None:
        if not self._ensure_active_session():
            return
        with SessionLocal() as session:
            offices = list_offices(session, active_only=True)
        dialog = AssetDialog(self.root, offices)
        self.root.wait_window(dialog)
        if dialog.result is None:
            return
        try:
            with SessionLocal() as session:
                create_asset(session, dialog.result, self.actor_name)
            self.refresh_all()
            messagebox.showinfo("تم الحفظ", "تم تسجيل الأصل وحفظ حركة إضافته.", parent=self.root)
        except Exception as exc:
            messagebox.showerror("تعذر الحفظ", str(exc), parent=self.root)

    def edit_asset(self) -> None:
        if not self._ensure_active_session():
            return
        asset = self._selected_asset()
        if asset is None:
            return
        with SessionLocal() as session:
            offices = list_offices(session, active_only=True)
        dialog = AssetDialog(self.root, offices, asset)
        self.root.wait_window(dialog)
        if dialog.result is None:
            return
        try:
            with SessionLocal() as session:
                update_asset(session, asset.id, dialog.result, self.actor_name)
            self.refresh_all()
            messagebox.showinfo("تم التعديل", "تم تحديث بيانات الأصل.", parent=self.root)
        except Exception as exc:
            messagebox.showerror("تعذر التعديل", str(exc), parent=self.root)

    def transfer_selected_asset(self) -> None:
        if not self._ensure_active_session():
            return
        asset = self._selected_asset()
        if asset is None:
            return
        with SessionLocal() as session:
            offices = [office for office in list_offices(session, active_only=True) if office.id != asset.office_id]
        if not offices:
            messagebox.showinfo("نقل الأصل", "أضف مكتباً فعالاً آخر قبل النقل.", parent=self.root)
            return
        labels = [f"{office.name} — {office.building or 'بدون مبنى'}" for office in offices]
        choice = simpledialog.askstring(
            "نقل الأصل", "اكتب اسم المكتب الوجهة كما يظهر هنا:\n" + "\n".join(labels),
            parent=self.root,
        )
        if not choice:
            return
        destination_by_label = {
            f"{office.name} — {office.building or 'بدون مبنى'}": office for office in offices
        }
        destination = destination_by_label.get(choice.strip())
        if destination is None:
            destination = next((office for office in offices if office.name == choice.strip()), None)
        if destination is None:
            messagebox.showerror("اختيار غير صحيح", "لم أتعرف على اسم المكتب المدخل.", parent=self.root)
            return
        notes = simpledialog.askstring("ملاحظات النقل", "سبب أو ملاحظات النقل (اختياري):", parent=self.root) or ""
        try:
            with SessionLocal() as session:
                transfer_asset(session, asset.id, destination.id, notes, self.actor_name)
            self.refresh_all()
            messagebox.showinfo("تم النقل", "تم نقل الأصل وتسجيل الحركة.", parent=self.root)
        except Exception as exc:
            messagebox.showerror("تعذر النقل", str(exc), parent=self.root)

    def retire_selected_asset(self) -> None:
        if not self._ensure_active_session():
            return
        asset = self._selected_asset()
        if asset is None:
            return
        reason = simpledialog.askstring("استبعاد أصل", "أدخل سبب الاستبعاد:", parent=self.root)
        if reason is None:
            return
        try:
            with SessionLocal() as session:
                retire_asset(session, asset.id, reason, self.actor_name)
            self.refresh_all()
            messagebox.showinfo("تم الاستبعاد", "تم استبعاد الأصل وتسجيل السبب في سجل الحركات.", parent=self.root)
        except Exception as exc:
            messagebox.showerror("تعذر الاستبعاد", str(exc), parent=self.root)

    def add_office(self) -> None:
        if not self._ensure_active_session():
            return
        dialog = OfficeDialog(self.root)
        self.root.wait_window(dialog)
        if dialog.result is None:
            return
        try:
            with SessionLocal() as session:
                create_office(session, *dialog.result, actor_name=self.actor_name)
            self.refresh_all()
            messagebox.showinfo("تم الحفظ", "تم إضافة المكتب.", parent=self.root)
        except Exception as exc:
            messagebox.showerror("تعذر الحفظ", str(exc), parent=self.root)

    def _selected_office(self) -> Office | None:
        selected = self.offices_tree.selection()
        if not selected:
            messagebox.showinfo("تحديد مكتب", "حدد مكتباً من الجدول أولاً.", parent=self.root)
            return None
        with SessionLocal() as session:
            return session.get(Office, selected[0])

    def edit_office(self) -> None:
        if not self._ensure_active_session():
            return
        office = self._selected_office()
        if office is None:
            return
        dialog = OfficeDialog(self.root, office)
        self.root.wait_window(dialog)
        if dialog.result is None:
            return
        try:
            with SessionLocal() as session:
                update_office(session, office.id, *dialog.result, actor_name=self.actor_name)
            self.refresh_all()
            messagebox.showinfo("تم التعديل", "تم تحديث بيانات المكتب.", parent=self.root)
        except Exception as exc:
            messagebox.showerror("تعذر تعديل المكتب", str(exc), parent=self.root)

    def toggle_selected_office(self) -> None:
        if not self._ensure_active_session():
            return
        office = self._selected_office()
        if office is None:
            return
        next_state = not office.is_active
        label = "تفعيل" if next_state else "إيقاف"
        if not messagebox.askyesno(
            label + " المكتب",
            f"هل تريد {label} المكتب {office.name}؟",
            parent=self.root,
        ):
            return
        try:
            with SessionLocal() as session:
                set_office_active(session, office.id, next_state, self.actor_name)
            self.refresh_all()
        except Exception as exc:
            messagebox.showerror("تعذر تغيير حالة المكتب", str(exc), parent=self.root)

    def import_excel(self) -> None:
        if not self._ensure_active_session():
            return
        path = filedialog.askopenfilename(
            parent=self.root, title="اختر ملف Excel",
            filetypes=[("Excel workbook", "*.xlsx *.xlsm")],
        )
        if not path:
            return
        try:
            with SessionLocal() as session:
                result = import_assets_from_excel(session, path, self.actor_name)
            lines = [
                f"رقم الدفعة: {result.batch_id}",
                f"الصفوف الكلية: {result.total_rows}",
                f"تم استيرادها: {result.succeeded_rows}",
                f"فشل استيرادها: {result.failed_rows}",
                f"تم تجاوزها: {result.skipped_rows}",
            ]
            lines.extend(result.row_errors[:100])
            self.import_log.configure(state="normal")
            self.import_log.delete("1.0", "end")
            self.import_log.insert("1.0", "\n".join(lines))
            self.import_log.configure(state="disabled")
            self.refresh_all()
            messagebox.showinfo("اكتمل الاستيراد", "\n".join(lines[:5]), parent=self.root)
        except Exception as exc:
            messagebox.showerror("فشل الاستيراد", str(exc), parent=self.root)

    def export_excel(self) -> None:
        if not self._ensure_active_session():
            return
        path = filedialog.asksaveasfilename(
            parent=self.root, title="حفظ ملف جرد الأصول",
            defaultextension=".xlsx", initialfile="ITFix-Assets.xlsx",
            filetypes=[("Excel workbook", "*.xlsx")],
        )
        if not path:
            return
        try:
            with SessionLocal() as session:
                count = export_assets_to_excel(session, path)
            messagebox.showinfo("تم التصدير", f"تم تصدير {count} أصلاً إلى ملف Excel.", parent=self.root)
        except Exception as exc:
            messagebox.showerror("فشل التصدير", str(exc), parent=self.root)

    def export_template(self) -> None:
        if not self._ensure_active_session():
            return
        path = filedialog.asksaveasfilename(
            parent=self.root, title="حفظ قالب الاستيراد",
            defaultextension=".xlsx", initialfile="ITFix-Import-Template.xlsx",
            filetypes=[("Excel workbook", "*.xlsx")],
        )
        if not path:
            return
        from openpyxl import Workbook
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "الأصول"
        sheet.append(["الفئة", "الشركة المصنعة", "الطراز", "الرقم التسلسلي", "الحالة", "المكتب", "المعالج", "الذاكرة", "التخزين"])
        sheet.append(["لابتوب", "HP", "ProBook", "SN-001", "متوفر", "المستودع الرئيسي", "Core i5", "8GB", "256GB SSD"])
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        try:
            workbook.save(path)
            messagebox.showinfo("تم إنشاء القالب", "يمكنك تعبئة القالب ثم استيراده من الشاشة نفسها.", parent=self.root)
        except Exception as exc:
            messagebox.showerror("تعذر إنشاء القالب", str(exc), parent=self.root)

    def show_database_health(self) -> None:
        healthy, detail = database_health()
        label = "متصل" if healthy else "غير متصل"
        messagebox.showinfo("حالة قاعدة البيانات", f"الحالة: {label}\nالنوع أو التفاصيل: {detail}", parent=self.root)


def _complete_required_password_change(root: tk.Tk, user: AppUser) -> bool:
    while user.must_change_password:
        current = simpledialog.askstring(
            "تغيير كلمة المرور مطلوب",
            "الحساب جديد. أدخل كلمة المرور الأولية التي استلمتها:",
            show="*", parent=root,
        )
        if current is None:
            return False
        new = simpledialog.askstring(
            "تعيين كلمة مرور جديدة",
            "اختر كلمة مرور جديدة لا تقل عن 12 محرفاً:",
            show="*", parent=root,
        )
        if new is None:
            return False
        confirm = simpledialog.askstring(
            "تأكيد كلمة المرور",
            "أعد إدخال كلمة المرور الجديدة:",
            show="*", parent=root,
        )
        if confirm is None:
            return False
        if new != confirm:
            messagebox.showerror("كلمتا المرور مختلفتان", "تأكد من تطابق كلمتي المرور.", parent=root)
            continue
        try:
            with SessionLocal() as session:
                change_own_password(session, user.id, current, new)
            user.must_change_password = False
            return True
        except Exception as exc:
            messagebox.showerror("تعذر تغيير كلمة المرور", str(exc), parent=root)
    return True


def run_app() -> None:
    root = tk.Tk()
    root.withdraw()
    try:
        from .database import initialize_database
        initialize_database()
    except Exception as exc:
        messagebox.showerror(
            "تعذر تهيئة قاعدة البيانات",
            f"{exc}\n\nراجع إعدادات python_app/.env ودليل python_app/README.md.",
            parent=root,
        )
        root.destroy()
        return

    login = LoginDialog(root)
    root.wait_window(login)
    user = login.user
    if user is None:
        root.destroy()
        return

    root.deiconify()
    if not _complete_required_password_change(root, user):
        root.destroy()
        return

    AssetInventoryApp(root, user)
    root.mainloop()
