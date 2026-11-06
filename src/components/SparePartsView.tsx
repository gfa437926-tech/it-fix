import React, { useState } from 'react';
import {
  Boxes,
  Plus,
  Search,
  AlertTriangle,
  CheckCircle,
  PackageMinus,
  X,
  DollarSign,
  TrendingDown,
} from 'lucide-react';
import { SparePart, MaintenanceRecord } from '../types';
import { addSparePart, consumeSparePart } from '../services/sparePartsService';
import { useAuth } from '../context/AuthContext';

interface SparePartsViewProps {
  spareParts: SparePart[];
  maintenanceRecords: MaintenanceRecord[];
}

export const SparePartsView: React.FC<SparePartsViewProps> = ({
  spareParts,
  maintenanceRecords,
}) => {
  const { profile } = useAuth();
  const actorName = profile?.displayName || 'المسؤول';

  const [search, setSearch] = useState('');
  const [filterAlert, setFilterAlert] = useState<boolean>(false);

  // Modals
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [quantity, setQuantity] = useState<number>(10);
  const [minQty, setMinQty] = useState<number>(3);
  const [unitCost, setUnitCost] = useState<number>(0);
  const [supplier, setSupplier] = useState('');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // Quick consume modal
  const [consumingPart, setConsumingPart] = useState<SparePart | null>(null);
  const [selectedTicketId, setSelectedTicketId] = useState('');
  const [consumeQty, setConsumeQty] = useState<number>(1);
  const [consumeNotes, setConsumeNotes] = useState('');
  const [consumeError, setConsumeError] = useState('');

  const openTickets = maintenanceRecords.filter(
    (r) => r.status === 'open' || r.status === 'inProgress'
  );

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !sku.trim()) {
      setFormError('يرجى إدخال اسم القطعة ورمز SKU');
      return;
    }

    setFormLoading(true);
    setFormError('');

    try {
      await addSparePart({
        name: name.trim(),
        sku: sku.trim().toUpperCase(),
        quantity: Number(quantity) || 0,
        minimumQuantity: Number(minQty) || 0,
        unitCost: Number(unitCost) || 0,
        supplier: supplier.trim(),
        warehouseId: profile?.warehouseIds?.[0] || '',
      });

      setIsAddOpen(false);
      setName('');
      setSku('');
      setQuantity(10);
      setMinQty(3);
      setUnitCost(0);
      setSupplier('');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'تعذر إضافة قطعة الغيار');
    } finally {
      setFormLoading(false);
    }
  };

  const handleConsumeSubmit = async () => {
    if (!consumingPart || !selectedTicketId || consumeQty <= 0) return;
    setConsumeError('');

    try {
      await consumeSparePart(
        consumingPart.id,
        selectedTicketId,
        consumeQty,
        consumeNotes,
        actorName,
        profile
      );
      setConsumingPart(null);
      setSelectedTicketId('');
      setConsumeQty(1);
      setConsumeNotes('');
    } catch (err: unknown) {
      setConsumeError(err instanceof Error ? err.message : 'تعذر صرف القطعة');
    }
  };

  // Filtered
  const filtered = spareParts.filter((part) => {
    const matchesSearch =
      search.trim() === '' ||
      part.name.toLowerCase().includes(search.toLowerCase()) ||
      part.sku.toLowerCase().includes(search.toLowerCase()) ||
      part.supplier.toLowerCase().includes(search.toLowerCase());

    const isLow = part.quantity <= part.minimumQuantity;
    const matchesAlert = !filterAlert || isLow;

    return matchesSearch && matchesAlert;
  });

  const lowStockCount = spareParts.filter((p) => p.quantity <= p.minimumQuantity).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#183B56]">مخزون قطع الغيار</h2>
          <p className="text-sm text-slate-500">
            متابعة رصيد المستودع، رموز SKU، تنبيهات انخفاض المخزون، والصرف المباشر لتذاكر الصيانة
          </p>
        </div>

        <button
          onClick={() => {
            setFormError('');
            setIsAddOpen(true);
          }}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#168C8C] hover:bg-[#137676] text-white text-sm font-bold rounded-xl shadow-xs transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة قطعة جديدة</span>
        </button>
      </div>

      {/* Low Stock Banner if any */}
      {lowStockCount > 0 && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h4 className="font-bold text-amber-900 text-sm">
                تنبيه: {lowStockCount} أصناف قطع غيار بلغت الحد الأدنى أو نفدت!
              </h4>
              <p className="text-xs text-amber-700">
                يوصى بطلب توريد وشراء القطع لتفادي تأخير طلبات الصيانة
              </p>
            </div>
          </div>
          <button
            onClick={() => setFilterAlert(!filterAlert)}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg cursor-pointer"
          >
            {filterAlert ? 'عرض كافة الأصناف' : 'تصفية المنخفضة فقط'}
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="relative min-w-[240px] flex-1">
          <Search className="w-4 h-4 absolute right-3.5 top-3 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم القطعة، رمز SKU، أو المورد..."
            className="w-full pl-4 pr-10 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
          />
        </div>

        <button
          onClick={() => setFilterAlert(!filterAlert)}
          className={`px-3 py-2 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
            filterAlert
              ? 'bg-amber-50 border-amber-300 text-amber-900'
              : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
          }`}
        >
          {filterAlert ? 'إلغاء التصفية' : `تصفية المنخفضة (${lowStockCount})`}
        </button>
      </div>

      {/* Parts Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50/80 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-bold">اسم القطعة</th>
                <th className="py-3 px-4 font-bold">رمز SKU</th>
                <th className="py-3 px-4 font-bold">الرصيد المتاح</th>
                <th className="py-3 px-4 font-bold">الحد الأدنى</th>
                <th className="py-3 px-4 font-bold">سعر الوحدة</th>
                <th className="py-3 px-4 font-bold">المورد المعتمد</th>
                <th className="py-3 px-4 font-bold text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    لا توجد أصناف قطع غيار مطابقة
                  </td>
                </tr>
              ) : (
                filtered.map((part) => {
                  const isZero = part.quantity <= 0;
                  const isLow = part.quantity <= part.minimumQuantity;

                  return (
                    <tr key={part.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-[#183B56]">{part.name}</td>
                      <td className="py-3.5 px-4 font-mono text-xs font-bold text-slate-600">
                        {part.sku}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            isZero
                              ? 'bg-rose-100 text-rose-800'
                              : isLow
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {part.quantity} قطعة
                          {isLow && <TrendingDown className="w-3 h-3" />}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-500">{part.minimumQuantity}</td>
                      <td className="py-3.5 px-4 text-xs font-bold text-slate-800">
                        {part.unitCost} ر.س
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-600">{part.supplier || '—'}</td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          disabled={part.quantity <= 0 || openTickets.length === 0}
                          onClick={() => {
                            setConsumingPart(part);
                            setSelectedTicketId(openTickets[0]?.id || '');
                            setConsumeQty(1);
                            setConsumeNotes('');
                            setConsumeError('');
                          }}
                          className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg flex items-center gap-1 mx-auto disabled:opacity-40 cursor-pointer"
                        >
                          <PackageMinus className="w-3.5 h-3.5 text-amber-600" />
                          <span>صرف لصيانة</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Part Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl relative">
            <button
              onClick={() => setIsAddOpen(false)}
              className="absolute left-4 top-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold text-[#183B56] mb-1">إضافة صنف قطعة غيار جديد</h3>
            <p className="text-xs text-slate-500 mb-4">
              تسجيل قطعة غيار بالمستودع وتعيين رمز SKU وحد الأمان
            </p>

            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-bold">
                {formError}
              </div>
            )}

            <form onSubmit={handleAddSubmit} className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">اسم القطعة *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: شاحن لابتوب Dell 65W"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">رمز SKU *</label>
                  <input
                    type="text"
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="CHG-DELL-65W"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none font-mono text-xs uppercase"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الرصيد الابتدائي *</label>
                  <input
                    type="number"
                    min="0"
                    value={quantity}
                    onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">حد الطلب الأدنى *</label>
                  <input
                    type="number"
                    min="0"
                    value={minQty}
                    onChange={(e) => setMinQty(parseInt(e.target.value) || 0)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">تكلفة الوحدة (ر.س) *</label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={unitCost}
                    onChange={(e) => setUnitCost(parseFloat(e.target.value) || 0)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">المورد المعتمد</label>
                <input
                  type="text"
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  placeholder="شركة التوريد أو التاجر..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="px-5 py-2 text-xs font-bold bg-[#168C8C] hover:bg-[#137676] text-white rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {formLoading ? 'جاري الحفظ...' : 'حفظ القطعة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Consume Modal */}
      {consumingPart && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl relative">
            <button
              onClick={() => setConsumingPart(null)}
              className="absolute left-4 top-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold text-[#183B56] mb-1">صرف قطعة غيار لطلب صيانة</h3>
            <p className="text-xs text-slate-500 mb-4">
              القطعة: {consumingPart.name} (المتاح: {consumingPart.quantity} قطعة)
            </p>

            {consumeError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-bold">
                {consumeError}
              </div>
            )}

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">طلب الصيانة المستهدف *</label>
                <select
                  value={selectedTicketId}
                  onChange={(e) => setSelectedTicketId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs font-semibold"
                >
                  <option value="">اختر التذكرة...</option>
                  {openTickets.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title} — {t.assetLabel} ({t.status === 'open' ? 'مفتوحة' : 'قيد التنفيذ'})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الكمية المصروفة *</label>
                <input
                  type="number"
                  min="1"
                  max={consumingPart.quantity}
                  value={consumeQty}
                  onChange={(e) => setConsumeQty(parseInt(e.target.value) || 1)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات الصرف</label>
                <input
                  type="text"
                  value={consumeNotes}
                  onChange={(e) => setConsumeNotes(e.target.value)}
                  placeholder="ملاحظات الصرف..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  onClick={() => setConsumingPart(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleConsumeSubmit}
                  disabled={!selectedTicketId || consumeQty <= 0 || consumeQty > consumingPart.quantity}
                  className="px-5 py-2 text-xs font-bold bg-[#183B56] hover:bg-[#122c42] text-white rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  تأكيد الصرف
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
