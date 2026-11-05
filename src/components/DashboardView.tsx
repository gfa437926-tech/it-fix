import React from 'react';
import {
  Building2,
  CheckCircle2,
  Wrench,
  PlusCircle,
  FileCheck2,
  UploadCloud,
  Sheet,
  ArrowRight,
  Clock,
  AlertTriangle,
  Boxes,
  Laptop2,
  BarChart3,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  Asset,
  Office,
  AssetMovement,
  CustodyRecord,
  SparePart,
  MaintenanceRecord,
  AssetCategory,
  ASSET_CATEGORY_LABELS,
  MOVEMENT_TYPE_LABELS,
} from '../types';
import { NavTab } from './Sidebar';

interface DashboardViewProps {
  assets: Asset[];
  offices: Office[];
  movements: AssetMovement[];
  custodyCards: CustodyRecord[];
  spareParts: SparePart[];
  maintenanceRecords?: MaintenanceRecord[];
  onNavigate: (tab: NavTab) => void;
  onOpenAddAsset: () => void;
  onOpenAddCustody: () => void;
  onOpenAddMaintenance: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  assets,
  offices,
  movements,
  custodyCards,
  spareParts,
  maintenanceRecords = [],
  onNavigate,
  onOpenAddAsset,
  onOpenAddCustody,
  onOpenAddMaintenance,
}) => {
  const totalAssets = assets.length;
  const assignedAssets = assets.filter((a) => a.status === 'assigned').length;
  const maintenanceAssets = assets.filter((a) => a.status === 'maintenance').length;
  const availableAssets = assets.filter((a) => a.status === 'available' || a.status === 'returned').length;
  const activeOffices = offices.filter((o) => o.isActive).length;

  const pendingApprovals = custodyCards.filter(
    (c) => c.status === 'active' && c.approvalStatus === 'pending'
  );

  const lowStockParts = spareParts.filter((p) => p.quantity <= p.minimumQuantity);

  // Intelligent periodic maintenance alerts
  const periodicMaintenanceDueAssets = React.useMemo(() => {
    const now = new Date().getTime();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;

    return assets.filter((asset) => {
      const assetRecords = maintenanceRecords.filter(
        (r) => r.assetId === asset.id && r.status === 'completed'
      );
      if (assetRecords.length === 0) {
        if (asset.receivedAt) {
          const receivedTime = new Date(asset.receivedAt).getTime();
          return now - receivedTime > 60 * 24 * 60 * 60 * 1000;
        }
        return false;
      }
      assetRecords.sort((a, b) => new Date(b.completedAt || b.reportedAt).getTime() - new Date(a.completedAt || a.reportedAt).getTime());
      const lastService = new Date(assetRecords[0].completedAt || assetRecords[0].reportedAt).getTime();
      return now - lastService > ninetyDaysMs;
    });
  }, [assets, maintenanceRecords]);

  const categories: AssetCategory[] = [
    'desktop',
    'laptop',
    'monitor',
    'printer',
    'scanner',
    'network',
    'storage',
    'ups',
    'accessory',
    'other',
  ];

  // Chart 1: Assets by Office
  const officeChartData = offices.map((office) => {
    const count = assets.filter(
      (a) => a.officeId === office.id || (a.officeName && a.officeName.trim() === office.name.trim())
    ).length;
    return {
      name: office.name.length > 14 ? office.name.slice(0, 14) + '...' : office.name,
      fullName: office.name,
      count,
    };
  }).filter((o) => o.count > 0 || offices.length <= 6);

  // Chart 2: Maintenance Status
  const maintenanceChartData = [
    { name: 'مفتوحة', value: maintenanceRecords.filter((r) => r.status === 'open').length, color: '#f59e0b' },
    { name: 'قيد التنفيذ', value: maintenanceRecords.filter((r) => r.status === 'inProgress').length, color: '#3b82f6' },
    { name: 'مكتملة', value: maintenanceRecords.filter((r) => r.status === 'completed').length, color: '#10b981' },
    { name: 'ملغاة', value: maintenanceRecords.filter((r) => r.status === 'cancelled').length, color: '#64748b' },
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      {/* Page Title & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#183B56]">لوحة التحكم الرئيسية</h2>
          <p className="text-sm text-slate-500">
            إدارة بطاقات الأجهزة والعهد ومزامنة Google Sheets والرسوم البيانية التفاعلية
          </p>
        </div>

        {/* Quick action triggers */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onOpenAddAsset}
            className="flex items-center gap-2 px-3.5 py-2 bg-[#168C8C] hover:bg-[#137676] text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>إضافة بطاقة جديدة</span>
          </button>
          <button
            onClick={() => onNavigate('google-sheets')}
            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
          >
            <Sheet className="w-4 h-4" />
            <span>مزامنة Google Sheets</span>
          </button>
          <button
            onClick={() => onNavigate('import')}
            className="flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
          >
            <UploadCloud className="w-4 h-4" />
            <span>رفع وتعديل شيت</span>
          </button>
          <button
            onClick={onOpenAddCustody}
            className="flex items-center gap-2 px-3.5 py-2 bg-[#183B56] hover:bg-[#122c42] text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
          >
            <FileCheck2 className="w-4 h-4" />
            <span>تسليم عهدة</span>
          </button>
        </div>
      </div>

      {/* Critical & Intelligent Alert Banners */}
      {(pendingApprovals.length > 0 || lowStockParts.length > 0 || periodicMaintenanceDueAssets.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pendingApprovals.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-amber-900 text-sm">
                    {pendingApprovals.length} بطاقات عهدة بانتظار الاعتماد
                  </h4>
                  <p className="text-xs text-amber-700">
                    يلزم مراجعة واعتماد طلبات تسليم العهد للموظفين
                  </p>
                </div>
              </div>
              <button
                onClick={() => onNavigate('custody')}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                مراجعة
              </button>
            </div>
          )}

          {lowStockParts.length > 0 && (
            <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center text-rose-700">
                  <Boxes className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-rose-900 text-sm">
                    {lowStockParts.length} قطع غيار أوشكت على النفاد
                  </h4>
                  <p className="text-xs text-rose-700">
                    وصل المخزون للحد الأدنى المحدد مسبقاً
                  </p>
                </div>
              </div>
              <button
                onClick={() => onNavigate('spare-parts')}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                عرض المخزون
              </button>
            </div>
          )}

          {periodicMaintenanceDueAssets.length > 0 && (
            <div className="bg-teal-50 border border-teal-200 rounded-2xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center text-teal-700">
                  <Wrench className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-teal-900 text-sm">
                    {periodicMaintenanceDueAssets.length} أصول بحاجة لصيانة دورية
                  </h4>
                  <p className="text-xs text-teal-700">
                    تجاوزت فترة آخر صيانة دورية المدى الموصى به (90 يوماً)
                  </p>
                </div>
              </div>
              <button
                onClick={() => onNavigate('maintenance')}
                className="px-3 py-1.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                جدولة صيانة
              </button>
            </div>
          )}
        </div>
      )}

      {/* 4 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Assets */}
        <div
          onClick={() => onNavigate('assets')}
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs hover:border-[#183B56]/40 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">إجمالي الأصول المسجلة</span>
            <div className="w-10 h-10 rounded-xl bg-[#183B56]/10 text-[#183B56] flex items-center justify-center group-hover:bg-[#183B56] group-hover:text-white transition-colors">
              <Laptop2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-black text-[#183B56]">{totalAssets}</span>
            <span className="text-xs text-slate-400 mr-2">أصل تقني</span>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>المتوفر بالمستودع: {availableAssets}</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400 rotate-180" />
          </div>
        </div>

        {/* Assigned */}
        <div
          onClick={() => onNavigate('custody')}
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs hover:border-purple-300 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">أجهزة بعهدة الموظفين</span>
            <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center group-hover:bg-purple-700 group-hover:text-white transition-colors">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-black text-purple-900">{assignedAssets}</span>
            <span className="text-xs text-slate-400 mr-2">جهاز موزع</span>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>
              {totalAssets > 0 ? Math.round((assignedAssets / totalAssets) * 100) : 0}% من إجمالي الأجهزة
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400 rotate-180" />
          </div>
        </div>

        {/* Maintenance */}
        <div
          onClick={() => onNavigate('maintenance')}
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs hover:border-amber-300 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">أجهزة قيد الصيانة</span>
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center group-hover:bg-amber-600 group-hover:text-white transition-colors">
              <Wrench className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-black text-amber-900">{maintenanceAssets}</span>
            <span className="text-xs text-slate-400 mr-2">تذكرة مفتوحة</span>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>تتطلب إجراءات فنية</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400 rotate-180" />
          </div>
        </div>

        {/* Offices */}
        <div
          onClick={() => onNavigate('offices')}
          className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs hover:border-teal-300 transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500">المكاتب والمواقع</span>
            <div className="w-10 h-10 rounded-xl bg-[#168C8C]/10 text-[#168C8C] flex items-center justify-center group-hover:bg-[#168C8C] group-hover:text-white transition-colors">
              <Building2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-black text-[#168C8C]">{activeOffices}</span>
            <span className="text-xs text-slate-400 mr-2">مكتب نشط</span>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>من أصل {offices.length} موقع</span>
            <ArrowRight className="w-3.5 h-3.5 text-slate-400 rotate-180" />
          </div>
        </div>
      </div>

      {/* Recharts Visual Overview Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Total Assets by Office (Bar Chart) */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-[#183B56] text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[#168C8C]" />
                <span>إجمالي الأصول حسب المكتب</span>
              </h3>
              <p className="text-xs text-slate-500">توزيع الأجهزة والمعدات على المكاتب والمواقع</p>
            </div>
            <button
              onClick={() => onNavigate('offices')}
              className="text-xs font-bold text-[#168C8C] hover:underline"
            >
              عرض المكاتب
            </button>
          </div>

          <div className="h-64 w-full" dir="ltr">
            {officeChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                لا توجد بيانات مكاتب كافية للعرض
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={officeChartData} margin={{ top: 10, right: 10, left: -20, bottom: 25 }}>
                  <XAxis
                    dataKey="name"
                    angle={-25}
                    textAnchor="end"
                    tick={{ fontSize: 10 }}
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip
                    formatter={(val: any) => [`${val} أصل`, 'العدد']}
                    labelStyle={{ fontFamily: 'Cairo', fontWeight: 'bold' }}
                  />
                  <Bar dataKey="count" fill="#168C8C" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Chart 2: Maintenance Status Breakdown (Pie/Bar Chart) */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-[#183B56] text-base flex items-center gap-2">
                <Wrench className="w-4 h-4 text-amber-600" />
                <span>حالة الصيانة وتذاكر الأعطال</span>
              </h3>
              <p className="text-xs text-slate-500">توزيع تذاكر الصيانة حسب الحالة الحالية</p>
            </div>
            <button
              onClick={() => onNavigate('maintenance')}
              className="text-xs font-bold text-[#168C8C] hover:underline"
            >
              إدارة الصيانة
            </button>
          </div>

          <div className="h-64 w-full flex items-center justify-center" dir="ltr">
            {maintenanceChartData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                لا توجد سجلات صيانة مسجلة حالياً
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={maintenanceChartData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    innerRadius={40}
                    paddingAngle={4}
                    label={({ name, percent }) => `${name} (${(((percent ?? 0) * 100)).toFixed(0)}%)`}
                    labelLine={false}
                  >
                    {maintenanceChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val: any) => [`${val} طلب`, 'العدد']} />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Two Columns: Category Overview + Activity Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Category Breakdown (3 Cols) */}
        <div className="lg:col-span-3 bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-[#183B56] text-base">
                توزيع الأصول حسب نوع الجهاز
              </h3>
              <p className="text-xs text-slate-500">
                إحصائية كميات الأجهزة الحالية في النظام
              </p>
            </div>
            <button
              onClick={() => onNavigate('assets')}
              className="text-xs font-bold text-[#168C8C] hover:underline"
            >
              عرض الجرد الكامل
            </button>
          </div>

          <div className="space-y-3">
            {categories.map((cat) => {
              const count = assets.filter((a) => a.category === cat).length;
              const pct = totalAssets > 0 ? Math.round((count / totalAssets) * 100) : 0;
              return (
                <div key={cat} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-700">{ASSET_CATEGORY_LABELS[cat]}</span>
                    <span className="text-slate-500">
                      {count} جهاز ({pct}%)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-[#168C8C] h-2 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Movements Feed (2 Cols) */}
        <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-[#183B56] text-base">آخر النشاطات والحركات</h3>
              <p className="text-xs text-slate-500">سجل زمني لعمليات النقل والصيانة</p>
            </div>
            <button
              onClick={() => onNavigate('movements')}
              className="text-xs font-bold text-[#168C8C] hover:underline"
            >
              السجل الكامل
            </button>
          </div>

          {movements.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-sm">
              <Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>لا توجد حركات أصول مسجلة بعد</p>
            </div>
          ) : (
            <div className="space-y-3">
              {movements.slice(0, 6).map((m) => {
                const label = MOVEMENT_TYPE_LABELS[m.movementType] || 'حركة أصل';
                const employee = m.toEmployee || m.fromEmployee || '';
                const office = m.toOffice || m.fromOffice || '';
                return (
                  <div
                    key={m.id}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-start gap-3 text-xs"
                  >
                    <div className="w-7 h-7 rounded-lg bg-teal-100 text-[#168C8C] flex items-center justify-center shrink-0 mt-0.5">
                      <Clock className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800">{label}</span>
                        <span className="text-[11px] text-slate-400">
                          {new Date(m.occurredAt).toLocaleDateString('ar-EG', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                      <p className="text-slate-600 truncate mt-0.5 font-medium">
                        {m.assetLabel} {employee && `• ${employee}`} {office && `• ${office}`}
                      </p>
                      {m.notes && <p className="text-[11px] text-slate-400 truncate">{m.notes}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
