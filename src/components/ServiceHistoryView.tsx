import React, { useState } from 'react';
import {
  FileText,
  Search,
  Wrench,
  Clock,
  Printer,
  Calendar,
  CheckCircle2,
} from 'lucide-react';
import { MaintenanceRecord, Asset } from '../types';

interface ServiceHistoryViewProps {
  maintenanceRecords: MaintenanceRecord[];
  assets: Asset[];
}

export const ServiceHistoryView: React.FC<ServiceHistoryViewProps> = ({
  maintenanceRecords,
  assets,
}) => {
  const [selectedAssetId, setSelectedAssetId] = useState<string>('all');
  const [search, setSearch] = useState('');

  const completedRecords = maintenanceRecords.filter((r) => r.status === 'completed');

  const filtered = completedRecords.filter((rec) => {
    const matchesAsset = selectedAssetId === 'all' || rec.assetId === selectedAssetId;
    const matchesSearch =
      search.trim() === '' ||
      rec.title.toLowerCase().includes(search.toLowerCase()) ||
      rec.assetLabel.toLowerCase().includes(search.toLowerCase()) ||
      (rec.technician && rec.technician.toLowerCase().includes(search.toLowerCase())) ||
      (rec.resolution && rec.resolution.toLowerCase().includes(search.toLowerCase()));

    return matchesAsset && matchesSearch;
  });

  const uniqueAssetsServiced = new Set(filtered.map((r) => r.assetId)).size;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <h2 className="text-2xl font-black text-[#183B56]">السجل الفني وتاريخ الصيانة</h2>
          <p className="text-sm text-slate-500">
            أرشيف العمليات الفنية المنفذة، الحلول، وسجل الصيانة التقنية لكل أصل
          </p>
        </div>

        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#183B56] hover:bg-[#122c42] text-white text-sm font-bold rounded-xl shadow-xs transition-all cursor-pointer"
        >
          <Printer className="w-4 h-4" />
          <span>طباعة تقرير الصيانة الفنية</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="relative min-w-[240px] flex-1">
          <Search className="w-4 h-4 absolute right-3.5 top-3 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث في سجل الصيانة والحلول الفنية..."
            className="w-full pl-4 pr-10 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-slate-600">الجهاز المستهدف:</label>
          <select
            value={selectedAssetId}
            onChange={(e) => setSelectedAssetId(e.target.value)}
            className="text-xs font-semibold py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
          >
            <option value="all">كافة الأجهزة ({completedRecords.length} عملية)</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.brand} {a.model} — {a.serialNumber}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-xs font-bold text-slate-400">عدد العمليات الفنية المنجزة</span>
          <p className="text-2xl font-black text-[#183B56] mt-1">{filtered.length} عملية</p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-xs font-bold text-slate-400">الأجهزة الفريدة التي تمت صيانتها</span>
          <p className="text-2xl font-black text-[#168C8C] mt-1">
            {uniqueAssetsServiced} أصل تقني
          </p>
        </div>
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
          <span className="text-xs font-bold text-slate-400">حالة التوثيق التقني</span>
          <p className="text-2xl font-black text-emerald-600 mt-1">100% موثق</p>
        </div>
      </div>

      {/* Timeline List */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs space-y-4">
        <h3 className="font-bold text-[#183B56] text-base mb-4 border-b border-slate-100 pb-3">
          الخط الزمني للصيانة الفنية
        </h3>

        {filtered.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-40 text-emerald-500" />
            <p className="font-bold">لا توجد سجلات صيانة منجزة مطابقة</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((record) => (
              <div
                key={record.id}
                className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 hover:bg-white transition-all space-y-2"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                      <Wrench className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-[#183B56]">{record.title}</h4>
                      <p className="text-xs text-[#168C8C] font-semibold">{record.assetLabel}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      {record.completedAt
                        ? new Date(record.completedAt).toLocaleDateString('ar-EG')
                        : new Date(record.reportedAt).toLocaleDateString('ar-EG')}
                    </span>
                  </div>
                </div>

                <div className="text-xs text-slate-600 bg-white p-3 rounded-lg border border-slate-100">
                  <span className="font-bold text-slate-800 block mb-1">الحل الفني والخدمة المنفذة:</span>
                  <p>{record.resolution || 'تمت الصيانة الفنية بنجاح.'}</p>
                </div>

                <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 pt-1">
                  <span>الفني المنفذ: {record.technician || 'فريق الصيانة'}</span>
                  <div className="flex items-center gap-3">
                    <span className="px-2 py-0.5 rounded bg-slate-200/70 font-semibold text-slate-700">
                      مكتمل ومغلق
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
