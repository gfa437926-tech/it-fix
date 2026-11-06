import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart3,
  Download,
  FileSpreadsheet,
  Printer,
  Filter,
  QrCode,
  Laptop2,
  Building2,
  CheckCircle,
  Wrench,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import QRCode from 'qrcode';
import {
  Asset,
  Office,
  CustodyRecord,
  MaintenanceRecord,
  AssetCategory,
  AssetStatus,
  ASSET_CATEGORY_LABELS,
  ASSET_STATUS_LABELS,
} from '../types';

interface ReportsViewProps {
  assets: Asset[];
  offices: Office[];
  custodyCards: CustodyRecord[];
  maintenanceRecords: MaintenanceRecord[];
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  assets,
  offices,
  custodyCards,
  maintenanceRecords,
}) => {
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [officeFilter, setOfficeFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [printQrMode, setPrintQrMode] = useState(false);
  const [qrCodesMap, setQrCodesMap] = useState<Record<string, string>>({});

  // Keep the filtered collection stable so QR generation does not restart on every render.
  const dateRangeValid = !dateFrom || !dateTo || dateFrom <= dateTo;
  const filteredAssets = useMemo(() => {
    if (!dateRangeValid) return [];
    return assets.filter((asset) => {
      const receivedDate = asset.receivedAt?.slice(0, 10) || '';
      const matchesCat = categoryFilter === 'all' || asset.category === categoryFilter;
      const matchesStatus = statusFilter === 'all' || asset.status === statusFilter;
      const matchesOffice = officeFilter === 'all' || asset.officeId === officeFilter;
      const matchesFrom = !dateFrom || (receivedDate !== '' && receivedDate >= dateFrom);
      const matchesTo = !dateTo || (receivedDate !== '' && receivedDate <= dateTo);
      return matchesCat && matchesStatus && matchesOffice && matchesFrom && matchesTo;
    });
  }, [assets, categoryFilter, statusFilter, officeFilter, dateFrom, dateTo, dateRangeValid]);

  // Maintenance indicators use the same selected period, based on ticket opening date.
  const filteredMaintenance = useMemo(() => {
    if (!dateRangeValid) return [];
    return maintenanceRecords.filter((record) => {
      const openedDate = record.reportedAt?.slice(0, 10) || '';
      return (!dateFrom || (openedDate !== '' && openedDate >= dateFrom)) &&
        (!dateTo || (openedDate !== '' && openedDate <= dateTo));
    });
  }, [maintenanceRecords, dateFrom, dateTo, dateRangeValid]);

  const maintenanceLaborCost = filteredMaintenance.reduce((sum, record) => sum + (Number(record.cost) || 0), 0);
  const maintenancePartsCost = filteredMaintenance.reduce((sum, record) => sum + (Number(record.partsCost) || 0), 0);
  const completedMaintenance = filteredMaintenance.filter((record) => record.status === 'completed').length;

  const categoryBreakdown = Object.entries(ASSET_CATEGORY_LABELS)
    .map(([key, label]) => ({
      key,
      label,
      count: filteredAssets.filter((asset) => asset.category === key).length,
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
  const statusBreakdown = Object.entries(ASSET_STATUS_LABELS)
    .map(([key, info]) => ({
      key,
      label: info.label,
      count: filteredAssets.filter((asset) => asset.status === key).length,
      color: info.color,
      background: info.bg,
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
  const maxCategoryCount = Math.max(1, ...categoryBreakdown.map((item) => item.count));
  const officeBreakdown = Object.values(filteredAssets.reduce<Record<string, { name: string; count: number; available: number; assigned: number; maintenance: number }>>((groups, asset) => {
    const key = asset.officeId || asset.officeName || 'warehouse';
    const name = asset.officeName || (asset.officeId ? offices.find((office) => office.id === asset.officeId)?.name : '') || 'المستودع / غير محدد';
    const group = groups[key] || (groups[key] = { name, count: 0, available: 0, assigned: 0, maintenance: 0 });
    group.count += 1;
    if (asset.status === 'available') group.available += 1;
    if (asset.status === 'assigned') group.assigned += 1;
    if (asset.status === 'maintenance') group.maintenance += 1;
    return groups;
  }, {})).sort((a, b) => b.count - a.count);
  const maxOfficeCount = Math.max(1, ...officeBreakdown.map((item) => item.count));

  // Pre-generate QR codes for labels sheet when in QR mode
  useEffect(() => {
    if (!printQrMode) return;
    const generateAll = async () => {
      const map: Record<string, string> = {};
      for (const asset of filteredAssets.slice(0, 48)) {
        const payload = JSON.stringify({
          id: asset.id,
          sn: asset.serialNumber,
          label: `${asset.brand} ${asset.model}`,
        });
        try {
          const url = await QRCode.toDataURL(payload, { width: 140, margin: 1 });
          map[asset.id] = url;
        } catch (e) {
          console.error(e);
        }
      }
      setQrCodesMap(map);
    };
    generateAll();
  }, [printQrMode, filteredAssets]);

  // Export to Excel
  const handleExportExcel = () => {
    const data = filteredAssets.map((a) => ({
      'الرقم التعريفي': a.id,
      'الشركة المصنعة': a.brand,
      'الموديل': a.model,
      'التصنيف': ASSET_CATEGORY_LABELS[a.category] || a.category,
      'الرقم التسلسلي': a.serialNumber,
      'المكتب / الموقع': a.officeName || 'المستودع',
      'الحالة': ASSET_STATUS_LABELS[a.status]?.label || a.status,
      'المعالج': a.cpu || '',
      'الذاكرة': a.ram || '',
      'التخزين': a.storage || '',
      'تاريخ الاستلام': a.receivedAt ? new Date(a.receivedAt).toLocaleDateString('ar-EG') : '',
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const maintenanceData = filteredMaintenance.map((record) => ({
      'رقم التذكرة': record.id,
      'الأصل المرتبط': record.assetLabel,
      'عنوان العطل': record.title,
      'وصف العطل': record.description,
      'الأولوية': record.priority,
      'الحالة': record.status,
      'الفني': record.technician || '',
      'تاريخ الفتح': record.reportedAt ? new Date(record.reportedAt).toLocaleDateString('ar-EG') : '',
      'تاريخ الإكمال': record.completedAt ? new Date(record.completedAt).toLocaleDateString('ar-EG') : '',
      'تكلفة العمل': Number(record.cost) || 0,
      'تكلفة القطع': Number(record.partsCost) || 0,
      'الإجمالي': (Number(record.cost) || 0) + (Number(record.partsCost) || 0),
      'نتيجة الإصلاح': record.resolution || '',
    }));
    const maintenanceSheet = XLSX.utils.json_to_sheet(maintenanceData);
    const summarySheet = XLSX.utils.aoa_to_sheet([
      ['ملخص التقرير'],
      ['الفترة', dateFrom || 'بداية السجل', dateTo || 'حتى اليوم'],
      ['عدد الأصول', filteredAssets.length],
      ['عدد تذاكر الصيانة', filteredMaintenance.length],
      ['التذاكر المكتملة', completedMaintenance],
      ['تكلفة أعمال الصيانة', maintenanceLaborCost],
      ['تكلفة قطع الصيانة', maintenancePartsCost],
      ['إجمالي تكلفة الصيانة', maintenanceLaborCost + maintenancePartsCost],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, summarySheet, 'الملخص');
    XLSX.utils.book_append_sheet(wb, ws, 'الأصول');
    XLSX.utils.book_append_sheet(wb, maintenanceSheet, 'الصيانة');
    XLSX.writeFile(wb, `تقرير_الأصول_والصيانة_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // Export to CSV
  const handleExportCSV = () => {
    const headers = [
      'id',
      'brand',
      'model',
      'category',
      'serialNumber',
      'officeName',
      'status',
      'cpu',
      'ram',
      'storage',
      'receivedAt',
    ];
    const escapeCsv = (value: unknown) => {
      let text = String(value ?? '');
      // Prevent spreadsheet formula execution when opening exported CSV files.
      if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
      return `"${text.replace(/"/g, '""')}"`;
    };
    const rows = filteredAssets.map((a) => [
      a.id,
      a.brand,
      a.model,
      a.category,
      a.serialNumber,
      a.officeName || '',
      a.status,
      a.cpu || '',
      a.ram || '',
      a.storage || '',
      a.receivedAt || '',
    ].map(escapeCsv));

    const csvContent =
      '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `تقرير_أصول_تقنية_المعلومات_${new Date().toISOString().split('T')[0]}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <h2 className="text-2xl font-black text-[#183B56]">التقارير والتصدير والطباعة</h2>
          <p className="text-sm text-slate-500">
            استخراج تقارير الجرد المخصصة، تصدير ملفات Excel و CSV، وطباعة ملصقات QR
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>تصدير Excel (.xlsx)</span>
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>تصدير CSV</span>
          </button>
          <button
            onClick={() => {
              setPrintQrMode(false);
              setTimeout(() => window.print(), 100);
            }}
            className="flex items-center gap-2 px-3.5 py-2 bg-[#183B56] hover:bg-[#122c42] text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة التقرير</span>
          </button>
          <button
            onClick={() => setPrintQrMode(!printQrMode)}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer border ${
              printQrMode
                ? 'bg-[#168C8C] text-white border-[#168C8C]'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <QrCode className="w-4 h-4" />
            <span>{printQrMode ? 'إلغاء وضع ملصقات QR' : 'تجهيز ملصقات QR للطباعة'}</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-wrap items-center gap-3 no-print">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
          <Filter className="w-4 h-4 text-slate-400" />
          <span>تصفية التقرير:</span>
        </div>

        {/* Category */}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="text-xs font-semibold py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
        >
          <option value="all">كل التصنيفات ({assets.length})</option>
          {Object.entries(ASSET_CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v} ({assets.filter((a) => a.category === k).length})
            </option>
          ))}
        </select>

        {/* Status */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs font-semibold py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
        >
          <option value="all">كل الحالات</option>
          {Object.entries(ASSET_STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>

        {/* Office */}
        <select
          value={officeFilter}
          onChange={(e) => setOfficeFilter(e.target.value)}
          className="text-xs font-semibold py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
        >
          <option value="all">كل المكاتب</option>
          {offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>

        {/* Received date range */}
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <span>من تاريخ الاستلام</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            className="text-xs py-2 px-2 bg-slate-50 border border-slate-200 rounded-xl"
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <span>إلى تاريخ الاستلام</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            className="text-xs py-2 px-2 bg-slate-50 border border-slate-200 rounded-xl"
          />
        </label>
        {(dateFrom || dateTo) && (
          <button
            type="button"
            onClick={() => { setDateFrom(''); setDateTo(''); }}
            className="text-xs font-bold text-[#168C8C] hover:underline"
          >
            مسح الفترة
          </button>
        )}

        <span className="text-xs font-bold text-slate-400 mr-auto">
          {dateRangeValid ? `نتائج التقرير: ${filteredAssets.length} أصل` : 'الفترة غير صحيحة: تاريخ البداية بعد تاريخ النهاية'}
        </span>
      </div>

      {/* Maintenance summary for the selected reporting period */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <p className="text-xs font-bold text-slate-500">تذاكر الصيانة ضمن الفترة</p>
          <p className="text-2xl font-black text-[#183B56] mt-2">{filteredMaintenance.length}</p>
          <p className="text-[11px] text-slate-400 mt-1">حسب تاريخ فتح التذكرة</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <p className="text-xs font-bold text-slate-500">التذاكر المكتملة</p>
          <p className="text-2xl font-black text-emerald-700 mt-2">{completedMaintenance}</p>
          <p className="text-[11px] text-slate-400 mt-1">من إجمالي تذاكر الفترة</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <p className="text-xs font-bold text-slate-500">تكلفة أعمال الصيانة</p>
          <p className="text-2xl font-black text-amber-700 mt-2">{maintenanceLaborCost.toLocaleString('ar-EG')}</p>
          <p className="text-[11px] text-slate-400 mt-1">تكلفة العمل المسجلة</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
          <p className="text-xs font-bold text-slate-500">تكلفة قطع الصيانة</p>
          <p className="text-2xl font-black text-indigo-700 mt-2">{maintenancePartsCost.toLocaleString('ar-EG')}</p>
          <p className="text-[11px] text-slate-400 mt-1">قيمة القطع المسجلة في التذاكر</p>
        </div>
      </div>

      {/* Asset distribution analytics */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <h3 className="font-black text-[#183B56] mb-4">توزيع الأصول حسب التصنيف</h3>
          {categoryBreakdown.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-5">لا توجد بيانات ضمن التصفية الحالية</p>
          ) : (
            <div className="space-y-3">
              {categoryBreakdown.map((item) => (
                <div key={item.key}>
                  <div className="flex justify-between text-xs font-bold mb-1.5">
                    <span className="text-slate-600">{item.label}</span>
                    <span className="text-[#183B56]">{item.count} أصل ({Math.round((item.count / Math.max(1, filteredAssets.length)) * 100)}%)</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full bg-[#168C8C]" style={{ width: `${(item.count / maxCategoryCount) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <h3 className="font-black text-[#183B56] mb-4">توزيع الأصول حسب الحالة</h3>
          {statusBreakdown.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-5">لا توجد بيانات ضمن التصفية الحالية</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {statusBreakdown.map((item) => (
                <div key={item.key} className={`rounded-xl border p-3 ${item.background}`}>
                  <p className={`text-xs font-bold ${item.color}`}>{item.label}</p>
                  <p className={`text-2xl font-black mt-1 ${item.color}`}>{item.count}</p>
                  <p className="text-[10px] text-slate-500 mt-1">{Math.round((item.count / Math.max(1, filteredAssets.length)) * 100)}% من الأصول</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Office comparison */}
      <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="font-black text-[#183B56]">مقارنة توزيع الأصول بين المكاتب</h3>
            <p className="text-xs text-slate-400 mt-1">عدد الأصول وحالتها التشغيلية وفق نتائج التصفية الحالية</p>
          </div>
          <span className="text-xs font-bold text-slate-500">{officeBreakdown.length} موقع</span>
        </div>
        {officeBreakdown.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-5">لا توجد بيانات للمقارنة</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="p-3 font-bold">المكتب / الموقع</th>
                  <th className="p-3 font-bold">إجمالي الأصول</th>
                  <th className="p-3 font-bold">متوفر</th>
                  <th className="p-3 font-bold">في العهدة</th>
                  <th className="p-3 font-bold">قيد الصيانة</th>
                  <th className="p-3 font-bold min-w-36">الحصة من النتائج</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {officeBreakdown.map((item) => (
                  <tr key={item.name}>
                    <td className="p-3 font-bold text-slate-700">{item.name}</td>
                    <td className="p-3 font-black text-[#183B56]">{item.count}</td>
                    <td className="p-3 text-emerald-700 font-bold">{item.available}</td>
                    <td className="p-3 text-blue-700 font-bold">{item.assigned}</td>
                    <td className="p-3 text-amber-700 font-bold">{item.maintenance}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-[#168C8C]" style={{ width: `${(item.count / maxOfficeCount) * 100}%` }} />
                        </div>
                        <span className="text-slate-500 w-9 text-left">{Math.round((item.count / Math.max(1, filteredAssets.length)) * 100)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Printable QR Code Labels Sheet View */}
      {printQrMode ? (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs space-y-4">
          <div className="flex items-center justify-between no-print border-b pb-3">
            <div>
              <h3 className="font-bold text-[#183B56] text-base">ورقة ملصقات QR للأصول (A4 Sheet)</h3>
              <p className="text-xs text-slate-500">جاهزة للإرسال إلى الطابعة مباشرة</p>
            </div>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2 bg-[#168C8C] text-white text-xs font-bold rounded-xl cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة الملصقات</span>
            </button>
          </div>

          {filteredAssets.length > 48 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              يتم تجهيز أول 48 ملصقاً في كل دفعة طباعة. قلّص نتائج التصفية لطباعة مجموعة أخرى.
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 print:grid-cols-3">
            {filteredAssets.slice(0, 48).map((asset) => (
              <div
                key={asset.id}
                className="p-3 border-2 border-dashed border-slate-300 rounded-xl text-center bg-white break-inside-avoid"
              >
                {qrCodesMap[asset.id] ? (
                  <img
                    src={qrCodesMap[asset.id]}
                    alt="QR"
                    className="w-24 h-24 mx-auto mb-1"
                  />
                ) : (
                  <div className="w-24 h-24 bg-slate-100 rounded-lg mx-auto flex items-center justify-center text-xs text-slate-400">
                    جاري التوليد...
                  </div>
                )}
                <p className="font-bold text-xs text-slate-800 truncate">
                  {asset.brand} {asset.model}
                </p>
                <p className="font-mono text-[10px] text-slate-600 mt-0.5">{asset.serialNumber}</p>
                <p className="text-[9px] text-slate-400 truncate mt-0.5">
                  {asset.officeName || 'المستودع الرئيسي'}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Standard Printable Report View */
        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-xs space-y-6">
          {/* Printable Report Header */}
          <div className="border-b-2 border-slate-800 pb-4 text-center">
            <h3 className="text-xl font-black text-[#183B56]">
              منظومة جرد وإدارة أصول تقنية المعلومات
            </h3>
            <p className="text-sm font-bold text-slate-600 mt-1">تقرير جرد الأصول الشامل والمفصل</p>
            <div className="flex items-center justify-between text-xs text-slate-500 mt-3 pt-2 border-t border-slate-100">
              <span>تاريخ التقرير: {new Date().toLocaleDateString('ar-EG')}</span>
              <span>الفترة: {dateFrom || 'بداية السجل'} — {dateTo || 'حتى اليوم'}</span>
              <span>عدد الأصول المشمولة: {filteredAssets.length} جهاز</span>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-100 text-slate-700 border-b border-slate-300">
                <tr>
                  <th className="py-2.5 px-3 font-bold">#</th>
                  <th className="py-2.5 px-3 font-bold">الأصل والموديل</th>
                  <th className="py-2.5 px-3 font-bold">التصنيف</th>
                  <th className="py-2.5 px-3 font-bold">الرقم التسلسلي (SN)</th>
                  <th className="py-2.5 px-3 font-bold">الموقع / المكتب</th>
                  <th className="py-2.5 px-3 font-bold">الحالة</th>
                  <th className="py-2.5 px-3 font-bold">المواصفات الفنية</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredAssets.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400">
                      لا توجد أصول مطابقة لمعايير التقرير
                    </td>
                  </tr>
                ) : (
                  filteredAssets.map((asset, index) => {
                    const statusInfo = ASSET_STATUS_LABELS[asset.status];
                    return (
                      <tr key={asset.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-400">
                          {index + 1}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-slate-800">
                          {asset.brand} {asset.model}
                        </td>
                        <td className="py-2.5 px-3 font-medium">
                          {ASSET_CATEGORY_LABELS[asset.category] || asset.category}
                        </td>
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-700">
                          {asset.serialNumber}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">
                          {asset.officeName || 'المستودع الرئيسي'}
                        </td>
                        <td className="py-2.5 px-3 font-bold">{statusInfo?.label || asset.status}</td>
                        <td className="py-2.5 px-3 text-slate-500">
                          {[asset.cpu, asset.ram, asset.storage].filter(Boolean).join(' • ') || '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Report Footer / Signature Area for print */}
          <div className="pt-8 border-t-2 border-slate-800 grid grid-cols-2 text-center text-xs mt-8">
            <div>
              <p className="font-bold text-slate-800">إعداد / مدخل البيانات</p>
              <div className="h-12 mt-1 border-b border-dashed border-slate-400" />
            </div>
            <div>
              <p className="font-bold text-slate-800">اعتماد مدير تقنية المعلومات</p>
              <div className="h-12 mt-1 border-b border-dashed border-slate-400" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
