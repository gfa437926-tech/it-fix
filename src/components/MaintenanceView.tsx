import React, { useState } from 'react';
import {
  Wrench,
  CheckCircle,
  Clock,
  AlertTriangle,
  Plus,
  Search,
  DollarSign,
  Package,
  X,
  Boxes,
} from 'lucide-react';
import {
  MaintenanceRecord,
  Asset,
  SparePart,
  MaintenancePriority,
  MAINTENANCE_PRIORITY_LABELS,
  MAINTENANCE_STATUS_LABELS,
} from '../types';
import {
  createMaintenanceRecord,
  completeMaintenanceRecord,
} from '../services/maintenanceService';
import { consumeSparePart } from '../services/sparePartsService';
import { useAuth } from '../context/AuthContext';

interface MaintenanceViewProps {
  maintenanceRecords: MaintenanceRecord[];
  assets: Asset[];
  spareParts: SparePart[];
  initialAssetForMaintenance?: Asset | null;
  onClearInitialAsset?: () => void;
}

export const MaintenanceView: React.FC<MaintenanceViewProps> = ({
  maintenanceRecords,
  assets,
  spareParts,
  initialAssetForMaintenance,
  onClearInitialAsset,
}) => {
  const { profile } = useAuth();
  const actorName = profile?.displayName || 'المسؤول';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals
  const [isOpenAddModal, setIsOpenAddModal] = useState(Boolean(initialAssetForMaintenance));
  const [selectedAssetId, setSelectedAssetId] = useState(initialAssetForMaintenance?.id || '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<MaintenancePriority>('normal');
  const [technician, setTechnician] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // Complete ticket modal
  const [completingRecord, setCompletingRecord] = useState<MaintenanceRecord | null>(null);
  const [resolution, setResolution] = useState('');
  const [cost, setCost] = useState<number>(0);

  // Consume spare part modal
  const [consumingRecord, setConsumingRecord] = useState<MaintenanceRecord | null>(null);
  const [selectedPartId, setSelectedPartId] = useState('');
  const [partQty, setPartQty] = useState<number>(1);
  const [partNotes, setPartNotes] = useState('');
  const [partError, setPartError] = useState('');

  // Assets that can enter maintenance
  const eligibleAssets = assets.filter(
    (a) => a.status !== 'retired' && (a.status !== 'maintenance' || a.id === selectedAssetId)
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssetId || !title.trim() || !description.trim()) {
      setFormError('يرجى اختيار الأصل وعنوان ووصف المشكلة');
      return;
    }

    setFormLoading(true);
    setFormError('');

    try {
      const chosenAsset = assets.find((a) => a.id === selectedAssetId);
      await createMaintenanceRecord(
        {
          assetId: selectedAssetId,
          assetLabel: chosenAsset ? `${chosenAsset.brand} ${chosenAsset.model}` : '',
          title: title.trim(),
          description: description.trim(),
          priority,
          technician: technician.trim(),
        },
        actorName
      );

      setIsOpenAddModal(false);
      setSelectedAssetId('');
      setTitle('');
      setDescription('');
      setTechnician('');
      if (onClearInitialAsset) onClearInitialAsset();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'تعذر فتح طلب الصيانة');
    } finally {
      setFormLoading(false);
    }
  };

  const handleCompleteSubmit = async () => {
    if (!completingRecord || !resolution.trim()) return;

    try {
      await completeMaintenanceRecord(completingRecord, resolution.trim(), cost, actorName);
      setCompletingRecord(null);
      setResolution('');
      setCost(0);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'تعذر إكمال طلب الصيانة');
    }
  };

  const handleConsumePart = async () => {
    if (!consumingRecord || !selectedPartId || partQty <= 0) return;
    setPartError('');

    try {
      await consumeSparePart(selectedPartId, consumingRecord.id, partQty, partNotes, actorName);
      setConsumingRecord(null);
      setSelectedPartId('');
      setPartQty(1);
      setPartNotes('');
    } catch (err: unknown) {
      setPartError(err instanceof Error ? err.message : 'تعذر صرف قطعة الغيار');
    }
  };

  // Filtered
  const filtered = maintenanceRecords.filter((rec) => {
    const matchesSearch =
      search.trim() === '' ||
      rec.title.toLowerCase().includes(search.toLowerCase()) ||
      rec.assetLabel.toLowerCase().includes(search.toLowerCase()) ||
      (rec.technician && rec.technician.toLowerCase().includes(search.toLowerCase()));

    const matchesStatus = statusFilter === 'all' || rec.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#183B56]">الصيانة والتذاكر الفنية</h2>
          <p className="text-sm text-slate-500">
            متابعة الأعطال، فنيي الصيانة، قطع الغيار المستهلكة، وتكاليف الإصلاح
          </p>
        </div>

        <button
          onClick={() => {
            setSelectedAssetId(eligibleAssets[0]?.id || '');
            setTitle('');
            setDescription('');
            setTechnician('');
            setFormError('');
            setIsOpenAddModal(true);
          }}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold rounded-xl shadow-xs transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>فتح تذكرة صيانة</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="relative min-w-[240px] flex-1">
          <Search className="w-4 h-4 absolute right-3.5 top-3 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالعنوان، الأصل، أو الفني..."
            className="w-full pl-4 pr-10 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs font-semibold py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
          >
            <option value="all">كل الحالات ({maintenanceRecords.length})</option>
            {Object.entries(MAINTENANCE_STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label} ({maintenanceRecords.filter((r) => r.status === k).length})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Tickets List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.length === 0 ? (
          <div className="col-span-full py-16 text-center text-slate-400 bg-white rounded-2xl border border-slate-200/90">
            <Wrench className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="font-bold">لا توجد طلبات صيانة مطابقة</p>
          </div>
        ) : (
          filtered.map((record) => {
            const statusInfo = MAINTENANCE_STATUS_LABELS[record.status] || {
              label: record.status,
              color: 'text-slate-700',
              bg: 'bg-slate-50',
            };
            const priorityInfo = MAINTENANCE_PRIORITY_LABELS[record.priority] || {
              label: record.priority,
              color: 'text-slate-600 bg-slate-100',
            };

            const isOpen = record.status === 'open' || record.status === 'inProgress';
            const totalRecordCost = (record.cost || 0) + (record.partsCost || 0);

            return (
              <div
                key={record.id}
                className="bg-white p-5 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between hover:border-amber-300 transition-all"
              >
                <div>
                  {/* Top Bar */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${statusInfo.bg} ${statusInfo.color}`}
                    >
                      {statusInfo.label}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${priorityInfo.color}`}
                    >
                      أولوية: {priorityInfo.label}
                    </span>
                  </div>

                  {/* Title & Asset */}
                  <h4 className="font-bold text-base text-[#183B56] leading-snug">{record.title}</h4>
                  <p className="text-xs text-[#168C8C] font-semibold mt-1">{record.assetLabel}</p>

                  {/* Description */}
                  <p className="text-xs text-slate-600 line-clamp-3 mt-2 bg-slate-50 p-2.5 rounded-xl">
                    {record.description}
                  </p>

                  {/* Technician & Date */}
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                    <span>الفني: {record.technician || 'فريق الدعم الفني'}</span>
                    <span>
                      {new Date(record.reportedAt).toLocaleDateString('ar-EG', {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  </div>

                  {/* Resolution if completed */}
                  {record.resolution && (
                    <div className="mt-2 text-xs text-emerald-800 bg-emerald-50/70 p-2 rounded-lg">
                      <span className="font-bold block">الحل المنفذ:</span>
                      <p>{record.resolution}</p>
                    </div>
                  )}
                </div>

                {/* Bottom Actions for Open Tickets */}
                {isOpen && (
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                    <button
                      onClick={() => {
                        setConsumingRecord(record);
                        setSelectedPartId(spareParts[0]?.id || '');
                        setPartQty(1);
                        setPartNotes('');
                        setPartError('');
                      }}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                    >
                      <Boxes className="w-3.5 h-3.5 text-slate-500" />
                      <span>صرف قطعة غيار</span>
                    </button>
                    <button
                      onClick={() => {
                        setCompletingRecord(record);
                        setResolution('');
                        setCost(0);
                      }}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      <span>إكمال وإغلاق</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Open Maintenance Modal */}
      {isOpenAddModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl relative">
            <button
              onClick={() => {
                setIsOpenAddModal(false);
                if (onClearInitialAsset) onClearInitialAsset();
              }}
              className="absolute left-4 top-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold text-[#183B56] mb-1">فتح طلب صيانة فنية</h3>
            <p className="text-xs text-slate-500 mb-4">
              سيتم تحويل حالة الجهاز فورياً إلى "قيد الصيانة" مع حفظ حالته السابقة
            </p>

            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-bold">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">اختر الأصل المتعطل *</label>
                <select
                  value={selectedAssetId}
                  onChange={(e) => setSelectedAssetId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs font-semibold"
                  required
                >
                  <option value="">اختر الجهاز...</option>
                  {eligibleAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.brand} {a.model} — SN: {a.serialNumber} ({a.officeName || 'المستودع'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">عنوان العطل / المشكلة *</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="مثال: الشاشة لا تعمل، تبديل بطارية، عطل في منفذ الشبكة"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">درجة الأولوية</label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as MaintenancePriority)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs font-semibold"
                  >
                    {Object.entries(MAINTENANCE_PRIORITY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الفني المسؤول</label>
                  <input
                    type="text"
                    value={technician}
                    onChange={(e) => setTechnician(e.target.value)}
                    placeholder="اسم الفني أو ورشة الصيانة..."
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">وصف العطل بالتفصيل *</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="أعراض المشكلة الفنية، ما حدث قبل العطل..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs h-24"
                  required
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsOpenAddModal(false);
                    if (onClearInitialAsset) onClearInitialAsset();
                  }}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="px-5 py-2 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {formLoading ? 'جاري الفتح...' : 'إرسال طلب الصيانة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Complete Maintenance Modal */}
      {completingRecord && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl relative">
            <button
              onClick={() => setCompletingRecord(null)}
              className="absolute left-4 top-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold text-[#183B56] mb-1">إكمال طلب الصيانة</h3>
            <p className="text-xs text-slate-500 mb-4">
              الجهاز: {completingRecord.assetLabel} ({completingRecord.title})
            </p>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الحل الفني المنفذ *</label>
                <textarea
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  placeholder="تفاصيل الإصلاح، الإجراءات الفنية، وقطع الغيار التي تم تركيبها..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs h-24"
                  required
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  onClick={() => setCompletingRecord(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleCompleteSubmit}
                  disabled={!resolution.trim()}
                  className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  إغلاق الطلب واسترجاع الجهاز
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Consume Spare Part Modal */}
      {consumingRecord && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl relative">
            <button
              onClick={() => setConsumingRecord(null)}
              className="absolute left-4 top-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold text-[#183B56] mb-1">صرف قطعة غيار من المخزون</h3>
            <p className="text-xs text-slate-500 mb-4">
              خصم الكمية من المخزون وإضافتها لتكلفة صيانة: {consumingRecord.assetLabel}
            </p>

            {partError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-bold">
                {partError}
              </div>
            )}

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">اختر قطعة الغيار *</label>
                <select
                  value={selectedPartId}
                  onChange={(e) => setSelectedPartId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs font-semibold"
                >
                  <option value="">اختر من المخزون...</option>
                  {spareParts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (SKU: {p.sku}) — المتاح: {p.quantity} — بسعر: {p.unitCost} ر.س
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الكمية المصروفة *</label>
                <input
                  type="number"
                  min="1"
                  value={partQty}
                  onChange={(e) => setPartQty(parseInt(e.target.value) || 1)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات الصرف</label>
                <input
                  type="text"
                  value={partNotes}
                  onChange={(e) => setPartNotes(e.target.value)}
                  placeholder="سبب الاستبدال..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  onClick={() => setConsumingRecord(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleConsumePart}
                  disabled={!selectedPartId || partQty <= 0}
                  className="px-5 py-2 text-xs font-bold bg-[#183B56] hover:bg-[#122c42] text-white rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  تأكيد الصرف وتحديث المخزون
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
