# IT Fix — نسخة Python المستقلة

هذه نسخة مستقلة من برنامج جرد الأصول، ولا تستبدل تطبيق React/Firebase الحالي ولا تتصل به تلقائياً. الكود موجود في مجلد `python_app/`.

## ما يعمل في النسخة الحالية

- واجهة سطح مكتب عربية باتجاه RTL باستخدام Tkinter.
- إضافة الأصول وتعديلها والبحث والتصفية حسب الحالة.
- منع تكرار الرقم التسلسلي بعد تحويله إلى أحرف كبيرة وإزالة المسافات.
- إدارة المكاتب والمواقع.
- نقل الأصل بين المكاتب مع تسجيل الحركة.
- استبعاد الأصل مع إلزامية السبب، ومنع استبعاد أصل في عهدة أو صيانة.
- لوحة مؤشرات مختصرة للأصول والمكاتب.
- استيراد XLSX مع التحقق من الصفوف وتقرير الأخطاء.
- تصدير XLSX عربي، مع حماية الخلايا النصية التي قد تُفسر كصيغ Excel.
- سجل حركات وتدقيق لعمليات الأصول الأساسية.

لم تُنقل بعد جميع وحدات النسخة الأصلية؛ لا تزال العهد متعددة البنود، الصيانة، قطع الغيار، المشتريات والمرفقات، إدارة المستخدمين والصلاحيات تحتاج إلى استكمال وربطها.

## تشغيل سريع على Windows — دون Docker

1. ثبّت Python 3.11 أو أحدث.
2. افتح PowerShell داخل مجلد المستودع.
3. نفّذ:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r python_app\requirements.txt
py -m python_app.app
```

عند عدم وجود ملف `.env` أو متغير `DATABASE_URL`، ينشئ التطبيق قاعدة SQLite محلية تلقائياً في:

`python_app/data/itfix_assets.db`

هذا الوضع يتيح تشغيل البرنامج وتجربة الوظائف فوراً، ولا يحتاج إلى Docker أو خادم قاعدة بيانات منفصل.

## قاعدة PostgreSQL محلية من دون Docker

يمكن تثبيت PostgreSQL كخدمة Windows عادية، ثم إنشاء قاعدة ومستخدم للتطبيق من خلال `psql`:

```sql
CREATE ROLE itfix_app LOGIN PASSWORD 'ضع-كلمة-مرور-قوية-هنا';
CREATE DATABASE itfix_assets OWNER itfix_app;
```

انسخ `.env.example` إلى `.env` داخل مجلد `python_app`، ثم اضبط:

```dotenv
DATABASE_URL=postgresql+psycopg://itfix_app:كلمة_المرور@127.0.0.1:5432/itfix_assets
AUTO_CREATE_SCHEMA=false
```

بعد مراجعة نماذج الجداول في `python_app/models.py`، أنشئ الجداول صراحةً:

```powershell
py -m python_app.init_database --confirm-create-schema
py -m python_app.app
```

لا تُخزّن كلمة المرور في Git، ولا تضع ملف `.env` في المستودع.

## ما المقصود بـ Supabase دون Docker؟

التطبيق يستخدم SQLAlchemy وموصل psycopg، لذلك يستطيع الاتصال بمحرك PostgreSQL محلي مثبت مباشرة، أو بعنوان اتصال PostgreSQL لمشروع Supabase مستضاف. عند الاتصال بخادم خارجي يجب استخدام TLS:

```dotenv
DATABASE_URL=postgresql+psycopg://USER:PASSWORD@HOST:5432/postgres?sslmode=require
AUTO_CREATE_SCHEMA=false
```

**تنبيه مهم:** قاعدة PostgreSQL المحلية المتوافقة مع مخطط Supabase ليست هي مجموعة خدمات Supabase المحلية الكاملة؛ هذه النسخة لا تشغّل Supabase Auth أو Storage أو REST API محلياً. لا تحتاج هذه النسخة إلى Docker لتشغيل سطح المكتب أو قاعدة PostgreSQL الأصلية. تكامل هوية وصلاحيات متعدد المستخدمين يحتاج قراراً منفصلاً قبل اعتماده.

## اختبارات المطور

```powershell
py -m pip install pytest
py -m compileall -q python_app
py -m pytest python_app/tests
```

الاختبارات الحالية تستخدم SQLite مؤقتة داخل الذاكرة، ولا تتصل ببيانات المستخدم أو قاعدة خارجية.
