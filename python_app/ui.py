from __future__ import annotations

import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk
from typing import Any

from sqlalchemy import select

from .database import SessionLocal, database_health
from .models import Asset, Office
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
)
from .services.excel_service import (
    CATEGORY_LABELS,
    STATUS_LABELS,
    export_assets_to_excel,
    import_assets_from_excel,
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
        self._add_combo(form, "حالة الأصل", "status", list(STATUS_OPTIONS), STATUS_LABELS_AR.get(asset.status, "متوفر") if asset else "متوفر")
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
    def __init__(self, parent: tk.Misc) -> None:
        super().__init__(parent)
        self.result: tuple[str, str, str, str, str] | None = None
        self.title("إضافة مكتب أو موقع")
        self.geometry("480x380")
        self.transient(parent)
        self.grab_set()
        form = ttk.Frame(self, padding=20)
        form.pack(fill="both", expand=True)
        ttk.Label(form, text="تعريف موقع جديد", font=("Tahoma", 16, "bold")).pack(anchor="e", pady=(0, 12))
        self.fields: dict[str, tk.StringVar] = {}
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
            var = tk.StringVar()
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
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("IT Fix — نظام جرد الأصول")
        self.root.geometry("1360x850")
        self.root.minsize(1080, 700)
        self.root.configure(bg="#f3f6f8")
        self.actor_name = "مدير محلي"

        self._configure_style()
        self._build_header()
        self._build_dashboard()
        self._build_tabs()
        self._build_status_bar()
        self.refresh_all()

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
        tk.Label(
            header, text="نسخة Python مستقلة — تعمل محلياً دون Docker",
            bg="#173f5f", fg="#d4e4ef", font=("Tahoma", 10),
        ).pack(side="left", padx=24)

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
        self.offices_tab = ttk.Frame(self.notebook, padding=12)
        self.movements_tab = ttk.Frame(self.notebook, padding=12)
        self.excel_tab = ttk.Frame(self.notebook, padding=12)
        self.notebook.add(self.assets_tab, text="الأصول والأجهزة")
        self.notebook.add(self.offices_tab, text="المكاتب والمواقع")
        self.notebook.add(self.movements_tab, text="سجل الحركات")
        self.notebook.add(self.excel_tab, text="استيراد وتصدير Excel")
        self._build_assets_tab()
        self._build_offices_tab()
        self._build_movements_tab()
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

    def _build_offices_tab(self) -> None:
        toolbar = ttk.Frame(self.offices_tab)
        toolbar.pack(fill="x", pady=(0, 10))
        ttk.Button(toolbar, text="إضافة مكتب", command=self.add_office).pack(side="left")
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
        self.refresh_dashboard()
        self.refresh_assets()
        self.refresh_offices()
        self.refresh_movements()

    def refresh_dashboard(self) -> None:
        with SessionLocal() as session:
            summary = get_dashboard_summary(session)
        for key, value in summary.__dict__.items() if hasattr(summary, "__dict__") else [
            (name, getattr(summary, name)) for name in summary.__dataclass_fields__
        ]:
            if key in self.stat_values:
                self.stat_values[key].configure(text=str(value))

    def refresh_assets(self) -> None:
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

    def _selected_asset(self) -> Asset | None:
        selected = self.assets_tree.selection()
        if not selected:
            messagebox.showinfo("تحديد أصل", "حدد أصلاً من الجدول أولاً.", parent=self.root)
            return None
        with SessionLocal() as session:
            return session.get(Asset, selected[0])

    def add_asset(self) -> None:
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

    def import_excel(self) -> None:
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


def run_app() -> None:
    root = tk.Tk()
    try:
        from .database import initialize_database
        initialize_database()
    except Exception as exc:
        root.withdraw()
        messagebox.showerror(
            "تعذر تهيئة قاعدة البيانات",
            f"{exc}\n\nراجع إعدادات python_app/.env ودليل python_app/README.md.",
            parent=root,
        )
        root.destroy()
        return
    AssetInventoryApp(root)
    root.mainloop()
