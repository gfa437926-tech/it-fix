import React, { useState } from 'react';
import {
  Search,
  Filter,
  Plus,
  QrCode,
  ArrowLeftRight,
  Trash2,
  Edit,
  Eye,
  CheckCircle,
  FileCheck2,
  Wrench,
  X,
  Printer,
  Sparkles,
  Scan,
} from 'lucide-react';
import QRCode from 'qrcode';
import {
  Asset,
  Office,
  AssetCategory,
  AssetStatus,
  ASSET_CATEGORY_LABELS,
  ASSET_STATUS_LABELS,
} from '../types';
import { createAsset, updateAsset, transferAsset, retireAsset, recordInventoryCheck } from '../services/assetService';
import { useAuth } from '../context/AuthContext';

interface AssetsViewProps {
  assets: Asset[];
  offices: Office[];
  onOpenAddCustodyWithAsset?: (asset: Asset) => void;
  onOpenMaintenanceWithAsset?: (asset: Asset) => void;
}

export const AssetsView: React.FC<AssetsViewProps> = ({
  assets,
  offices,
  onOpenAddCustodyWithAsset,
  onOpenMaintenanceWithAsset,
}) => {
  const { profile } = useAuth();
  const canCreateAssets = profile?.accessControlEnabled !== true || profile.permissions?.['assets.create'] === true;
  const canUpdateAssets = profile?.accessControlEnabled !== true || profile.permissions?.['assets.update'] === true;
  const canManageCustody = profile?.accessControlEnabled !== true || profile.permissions?.['custody.manage'] === true;
  const canManageMaintenance = profile?.accessControlEnabled !== true || profile.permissions?.['maintenance.manage'] === true;
  const canRecordInventoryCheck = profile?.accessControlEnabled !== true || profile.permissions?.['inventory.manage'] === true;
  const actorName = profile?.displayName || 'المسؤول';

  // Filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [officeFilter, setOfficeFilter] = useState<string>('all');

  // Modals state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);

  const [transferingAsset, setTransferingAsset] = useState<Asset | null>(null);
  const [targetOfficeId, setTargetOfficeId] = useState('');
  const [transferNotes, setTransferNotes] = useState('');

  const [retiringAsset, setRetiringAsset] = useState<Asset | null>(null);
  const [retirementReason, setRetirementReason] = useState('');

  const [selectedAssetQr, setSelectedAssetQr] = useState<Asset | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  const [selectedAssetDetail, setSelectedAssetDetail] = useState<Asset | null>(null);

  // Scanner modal state
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannedInput, setScannedInput] = useState('');
  const [scannedAssetResult, setScannedAssetResult] = useState<Asset | null>(null);
  const [auditSuccessMsg, setAuditSuccessMsg] = useState('');
  const [auditSaving, setAuditSaving] = useState(false);

  const handleScanQuery = (queryVal: string) => {
    setScannedInput(queryVal);
    const trimmed = queryVal.trim().toLowerCase();
    if (!trimmed) {
      setScannedAssetResult(null);
      return;
    }
    const found = assets.find(
      (a) =>
        a.serialNumber.toLowerCase() === trimmed ||
        a.id.toLowerCase() === trimmed ||
        `${a.brand} ${a.model}`.toLowerCase().includes(trimmed)
    );
    setScannedAssetResult(found || null);
  };

  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');

  // Form inputs
  const [category, setCategory] = useState<AssetCategory>('desktop');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [cpu, setCpu] = useState('');
  const [ram, setRam] = useState('');
  const [storageVal, setStorageVal] = useState('');
  const [officeId, setOfficeId] = useState('');

  const openAddForm = () => {
    setEditingAsset(null);
    setCategory('desktop');
    setBrand('');
    setModel('');
    setSerialNumber('');
    setCpu('');
    setRam('');
    setStorageVal('');
    setOfficeId(offices[0]?.id || '');
    setFormError('');
    setIsFormOpen(true);
  };

  const openEditForm = (asset: Asset) => {
    setEditingAsset(asset);
    setCategory(asset.category);
    setBrand(asset.brand);
    setModel(asset.model);
    setSerialNumber(asset.serialNumber);
    setCpu(asset.cpu || '');
    setRam(asset.ram || '');
    setStorageVal(asset.storage || '');
    setOfficeId(asset.officeId || '');
    setFormError('');
    setIsFormOpen(true);
  };

  const handleSaveAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brand.trim() || !model.trim() || !serialNumber.trim()) {
      setFormError('يرجى ملء الحقول الإلزامية: الشركة، الموديل، والرقم التسلسلي');
      return;
    }

    setFormLoading(true);
    setFormError('');

    const selectedOffice = offices.find((o) => o.id === officeId);

    try {
      if (editingAsset) {
        await updateAsset({
          ...editingAsset,
          category,
          brand: brand.trim(),
          model: model.trim(),
          serialNumber: serialNumber.trim().toUpperCase(),
          cpu: cpu.trim() || undefined,
          ram: ram.trim() || undefined,
          storage: storageVal.trim() || undefined,
          officeId: selectedOffice?.id || editingAsset.officeId,
          warehouseId: selectedOffice ? (selectedOffice.warehouseId || '') : editingAsset.warehouseId,
          officeName: selectedOffice?.name || editingAsset.officeName,
        });
      } else {
        await createAsset(
          {
            category,
            brand: brand.trim(),
            model: model.trim(),
            serialNumber: serialNumber.trim().toUpperCase(),
            status: 'available',
            cpu: cpu.trim() || undefined,
            ram: ram.trim() || undefined,
            storage: storageVal.trim() || undefined,
            officeId: selectedOffice?.id,
            warehouseId: selectedOffice?.warehouseId,
            officeName: selectedOffice?.name || 'المستودع الرئيسي',
            receivedAt: new Date().toISOString(),
          },
          actorName
        );
      }
      setIsFormOpen(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ الجهاز');
    } finally {
      setFormLoading(false);
    }
  };

  const handleTransfer = async () => {
    if (!transferingAsset || !targetOfficeId) return;
    const dest = offices.find((o) => o.id === targetOfficeId);
    if (!dest) return;

    try {
      await transferAsset(transferingAsset, dest, transferNotes, actorName);
      setTransferingAsset(null);
      setTargetOfficeId('');
      setTransferNotes('');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'تعذر نقل الجهاز');
    }
  };

  const handleRetire = async () => {
    if (!retiringAsset) return;
    try {
      await retireAsset(retiringAsset, retirementReason, actorName);
      setRetiringAsset(null);
      setRetirementReason('');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'تعذر استبعاد الجهاز');
    }
  };

  const showQrCode = async (asset: Asset) => {
    setSelectedAssetQr(asset);
    const qrPayload = JSON.stringify({
      id: asset.id,
      sn: asset.serialNumber,
      label: `${asset.brand} ${asset.model}`,
      category: asset.category,
    });
    try {
      const url = await QRCode.toDataURL(qrPayload, { width: 260, margin: 2 });
      setQrDataUrl(url);
    } catch (err) {
      console.error(err);
    }
  };

  // Filtered Assets
  const filteredAssets = assets.filter((asset) => {
    const matchesSearch =
      search.trim() === '' ||
      asset.brand.toLowerCase().includes(search.toLowerCase()) ||
      asset.model.toLowerCase().includes(search.toLowerCase()) ||
      asset.serialNumber.toLowerCase().includes(search.toLowerCase()) ||
      (asset.officeName && asset.officeName.toLowerCase().includes(search.toLowerCase()));

    const matchesCategory = categoryFilter === 'all' || asset.category === categoryFilter;
    const matchesStatus = statusFilter === 'all' || asset.status === statusFilter;
    const matchesOffice = officeFilter === 'all' || asset.officeId === officeFilter;

    return matchesSearch && matchesCategory && matchesStatus && matchesOffice;
  });

  const isComputer = category === 'desktop' || category === 'laptop';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#183B56]">الأجهزة والجرد الشامل</h2>
          <p className="text-sm text-slate-500">
            إدارة وتتبع كافة الأجهزة والمعدات، المواصفات الفنية، والأرقام التسلسلية
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setIsScannerOpen(true);
              setScannedInput('');
              setScannedAssetResult(null);
              setAuditSuccessMsg('');
            }}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold rounded-xl shadow-xs transition-all cursor-pointer"
          >
            <Scan className="w-4 h-4" />
            <span>مسح باركود / QR (جرد سريع)</span>
          </button>

          {canCreateAssets && <button
            onClick={openAddForm}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#168C8C] hover:bg-[#137676] text-white text-sm font-bold rounded-xl shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة أصل جديد</span>
          </button>}
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 absolute right-3.5 top-3 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالرقم التسلسلي، الشركة، الموديل، أو الموقع..."
            className="w-full pl-4 pr-10 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-[#168C8C] focus:bg-white"
          />
        </div>

        {/* Category */}
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
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
        </div>

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
      </div>

      {/* Asset Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50/80 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-bold">الأصل والموديل</th>
                <th className="py-3 px-4 font-bold">التصنيف</th>
                <th className="py-3 px-4 font-bold">الرقم التسلسلي (SN)</th>
                <th className="py-3 px-4 font-bold">الموقع / المكتب</th>
                <th className="py-3 px-4 font-bold">الحالة</th>
                <th className="py-3 px-4 font-bold text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAssets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    لا توجد أجهزة مطابقة لشروط البحث
                  </td>
                </tr>
              ) : (
                filteredAssets.map((asset) => {
                  const statusInfo = ASSET_STATUS_LABELS[asset.status] || {
                    label: asset.status,
                    color: 'text-slate-700',
                    bg: 'bg-slate-50',
                  };
                  return (
                    <tr key={asset.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-[#183B56]">
                          {asset.brand} {asset.model}
                        </div>
                        {(asset.cpu || asset.ram || asset.storage) && (
                          <div className="text-xs text-slate-400 mt-0.5">
                            {[asset.cpu, asset.ram, asset.storage].filter(Boolean).join(' • ')}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-xs font-medium text-slate-600">
                        {ASSET_CATEGORY_LABELS[asset.category] || asset.category}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs font-bold text-slate-700">
                        {asset.serialNumber}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-600">
                        {asset.officeName || 'المستودع الرئيسي'}
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${statusInfo.bg} ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Details */}
                          <button
                            onClick={() => setSelectedAssetDetail(asset)}
                            title="تفاصيل الجهاز"
                            className="p-1.5 text-slate-400 hover:text-[#183B56] hover:bg-slate-100 rounded-lg cursor-pointer"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* QR Code */}
                          <button
                            onClick={() => showQrCode(asset)}
                            title="رمز QR للملصق"
                            className="p-1.5 text-slate-400 hover:text-[#168C8C] hover:bg-teal-50 rounded-lg cursor-pointer"
                          >
                            <QrCode className="w-4 h-4" />
                          </button>

                          {/* Edit */}
                          {canUpdateAssets && (
                            <button
                              onClick={() => openEditForm(asset)}
                              title="تعديل الجهاز"
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg cursor-pointer"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                          )}

                          {/* Transfer (if available) */}
                          {canUpdateAssets && (asset.status === 'available' || asset.status === 'returned') && (
                            <button
                              onClick={() => {
                                setTransferingAsset(asset);
                                setTargetOfficeId('');
                                setTransferNotes('');
                              }}
                              title="نقل لمكتب آخر"
                              className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg cursor-pointer"
                            >
                              <ArrowLeftRight className="w-4 h-4" />
                            </button>
                          )}

                          {/* Assign Custody (if available) */}
                          {canManageCustody && (asset.status === 'available' || asset.status === 'returned') &&
                            onOpenAddCustodyWithAsset && (
                              <button
                                onClick={() => onOpenAddCustodyWithAsset(asset)}
                                title="تسليم عهدة لموظف"
                                className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg cursor-pointer"
                              >
                                <FileCheck2 className="w-4 h-4" />
                              </button>
                            )}

                          {/* Maintenance (if not already maintenance or retired) */}
                          {asset.status !== 'maintenance' &&
                            asset.status !== 'retired' &&
                            onOpenMaintenanceWithAsset && (
                              <button
                                onClick={() => onOpenMaintenanceWithAsset(asset)}
                                title="إرسال للصيانة"
                                className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg cursor-pointer"
                              >
                                <Wrench className="w-4 h-4" />
                              </button>
                            )}

                          {/* Retire Asset */}
                          {canUpdateAssets &&
                            asset.status !== 'assigned' &&
                            asset.status !== 'maintenance' &&
                            asset.status !== 'retired' && (
                              <button
                                onClick={() => {
                                  setRetiringAsset(asset);
                                  setRetirementReason('');
                                }}
                                title="استبعاد الأصل"
                                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-xl relative max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setIsFormOpen(false)}
              className="absolute left-4 top-4 text-slate-400 hover:text-slate-600 p-1 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-xl font-bold text-[#183B56] mb-1">
              {editingAsset ? 'تعديل بيانات الأصل' : 'إضافة أصل تقني جديد'}
            </h3>
            <p className="text-xs text-slate-500 mb-5">
              أدخل تفاصيل ومواصفات الجهاز للتحقق من الرقم التسلسلي وحفظه في السجل
            </p>

            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-bold">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveAsset} className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                {/* Category */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    تصنيف الجهاز *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as AssetCategory)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs font-semibold"
                  >
                    {Object.entries(ASSET_CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Office */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">المكتب / الموقع</label>
                  <select
                    value={officeId}
                    onChange={(e) => setOfficeId(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs font-semibold"
                  >
                    {offices.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Brand */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الشركة المصنعة *</label>
                  <input
                    type="text"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="مثال: Dell, HP, Lenovo"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                    required
                  />
                </div>

                {/* Model */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الموديل والطراز *</label>
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="مثال: OptiPlex 7090"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                    required
                  />
                </div>
              </div>

              {/* Serial Number */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  الرقم التسلسلي الفريد (Serial Number) *
                </label>
                <input
                  type="text"
                  value={serialNumber}
                  onChange={(e) => setSerialNumber(e.target.value)}
                  placeholder="مثال: CN-0H755K-74431-29G-002L"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none font-mono text-xs uppercase"
                  required
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  يتم التحقق من تفرّد الرقم التسلسلي ذرياً لمنع تكرار الأجهزة.
                </span>
              </div>

              {/* Conditional Computer Specifications */}
              {isComputer && (
                <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl space-y-3">
                  <span className="text-xs font-bold text-[#183B56] block">
                    مواصفات الحاسوب الفنية (اختيارية):
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-0.5">المعالج (CPU)</label>
                      <input
                        type="text"
                        value={cpu}
                        onChange={(e) => setCpu(e.target.value)}
                        placeholder="i7-11700"
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-0.5">الذاكرة (RAM)</label>
                      <input
                        type="text"
                        value={ram}
                        onChange={(e) => setRam(e.target.value)}
                        placeholder="16GB DDR4"
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500 block mb-0.5">التخزين (Storage)</label>
                      <input
                        type="text"
                        value={storageVal}
                        onChange={(e) => setStorageVal(e.target.value)}
                        placeholder="512GB NVMe"
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="px-5 py-2 text-xs font-bold bg-[#168C8C] hover:bg-[#137676] text-white rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {formLoading ? 'جاري الحفظ...' : editingAsset ? 'حفظ التعديلات' : 'إضافة الجهاز'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      {transferingAsset && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl relative">
            <button
              onClick={() => setTransferingAsset(null)}
              className="absolute left-4 top-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-bold text-[#183B56] mb-1">نقل الجهاز إلى مكتب آخر</h3>
            <p className="text-xs text-slate-500 mb-4">
              الجهاز: {transferingAsset.brand} {transferingAsset.model} (SN: {transferingAsset.serialNumber})
            </p>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">المكتب الحالي</label>
                <div className="p-2.5 bg-slate-100 rounded-xl text-xs font-bold text-slate-600">
                  {transferingAsset.officeName || 'المستودع الرئيسي'}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">المكتب الوجهة *</label>
                <select
                  value={targetOfficeId}
                  onChange={(e) => setTargetOfficeId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs font-semibold"
                >
                  <option value="">اختر المكتب الجديد...</option>
                  {offices
                    .filter((o) => o.id !== transferingAsset.officeId && o.isActive)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} {o.building ? `(${o.building})` : ''}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ملاحظات النقل</label>
                <textarea
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  placeholder="سبب النقل أو توجيه الإدارة..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs h-20"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  onClick={() => setTransferingAsset(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleTransfer}
                  disabled={!targetOfficeId}
                  className="px-5 py-2 text-xs font-bold bg-purple-700 hover:bg-purple-800 text-white rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  تأكيد النقل
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Retire Asset Modal */}
      {retiringAsset && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl relative">
            <button
              onClick={() => setRetiringAsset(null)}
              className="absolute left-4 top-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-bold text-rose-900 mb-1">استبعاد وتكهين الأصل</h3>
            <p className="text-xs text-slate-500 mb-4">
              سيتم تغيير حالة الجهاز إلى "مستبعد" وتسجيل سبب الاستبعاد في سجل التدقيق
            </p>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">سبب الاستبعاد *</label>
                <textarea
                  value={retirementReason}
                  onChange={(e) => setRetirementReason(e.target.value)}
                  placeholder="مثال: تقادم فني، تلف غير قابل للإصلاح، قرار لجنة الجرد..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs h-24"
                  required
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  onClick={() => setRetiringAsset(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  onClick={handleRetire}
                  disabled={!retirementReason.trim()}
                  className="px-5 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  تأكيد الاستبعاد
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Label Modal */}
      {selectedAssetQr && qrDataUrl && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl relative text-center">
            <button
              onClick={() => setSelectedAssetQr(null)}
              className="absolute left-4 top-4 text-slate-400 hover:text-slate-600 p-1 no-print"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-bold text-[#183B56] mb-1">ملصق QR للأصل</h3>
            <p className="text-xs text-slate-500 mb-4">جاهز للطباعة واللصق على هيكل الجهاز</p>

            <div className="p-4 bg-white border-2 border-dashed border-slate-300 rounded-2xl inline-block mx-auto">
              <img src={qrDataUrl} alt="QR Code" className="w-48 h-48 mx-auto" />
              <div className="mt-3 text-right text-xs">
                <p className="font-bold text-slate-900">
                  {selectedAssetQr.brand} {selectedAssetQr.model}
                </p>
                <p className="font-mono text-[11px] text-slate-600 mt-0.5">
                  SN: {selectedAssetQr.serialNumber}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {selectedAssetQr.officeName || 'المستودع الرئيسي'}
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-center gap-2 no-print">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 px-4 py-2 bg-[#183B56] hover:bg-[#122c42] text-white text-xs font-bold rounded-xl cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة الملصق</span>
              </button>
              <button
                onClick={() => setSelectedAssetQr(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Asset Detail Modal */}
      {selectedAssetDetail && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl relative">
            <button
              onClick={() => setSelectedAssetDetail(null)}
              className="absolute left-4 top-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold text-[#183B56] mb-1">
              {selectedAssetDetail.brand} {selectedAssetDetail.model}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              بطاقة بيانات الأصل والمواصفات المسجلة
            </p>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3 rounded-xl">
                <div>
                  <span className="text-slate-400 block mb-0.5">الرقم التسلسلي</span>
                  <span className="font-mono font-bold text-slate-800">
                    {selectedAssetDetail.serialNumber}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">التصنيف</span>
                  <span className="font-bold text-slate-800">
                    {ASSET_CATEGORY_LABELS[selectedAssetDetail.category]}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">الحالة الحالية</span>
                  <span className="font-bold text-slate-800">
                    {ASSET_STATUS_LABELS[selectedAssetDetail.status]?.label}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">الموقع الحالي</span>
                  <span className="font-bold text-slate-800">
                    {selectedAssetDetail.officeName || 'المستودع الرئيسي'}
                  </span>
                </div>
              </div>

              {(selectedAssetDetail.cpu || selectedAssetDetail.ram || selectedAssetDetail.storage) && (
                <div className="p-3 bg-teal-50/60 rounded-xl space-y-1 text-slate-700">
                  <span className="font-bold text-[#168C8C] block mb-1">المواصفات التقنية:</span>
                  {selectedAssetDetail.cpu && <div>• المعالج: {selectedAssetDetail.cpu}</div>}
                  {selectedAssetDetail.ram && <div>• الذاكرة العشوائية: {selectedAssetDetail.ram}</div>}
                  {selectedAssetDetail.storage && <div>• وسيط التخزين: {selectedAssetDetail.storage}</div>}
                </div>
              )}

              {selectedAssetDetail.retirementReason && (
                <div className="p-3 bg-rose-50 text-rose-800 rounded-xl">
                  <span className="font-bold block mb-0.5">سبب الاستبعاد:</span>
                  <p>{selectedAssetDetail.retirementReason}</p>
                </div>
              )}
            </div>

            <div className="mt-5 pt-3 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setSelectedAssetDetail(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR / Barcode Quick Audit Scanner Modal */}
      {isScannerOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative">
            <button
              onClick={() => setIsScannerOpen(false)}
              className="absolute left-4 top-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-teal-100 text-[#168C8C] flex items-center justify-center">
                <Scan className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-[#183B56]">
                  جرد سريع عبر الباركود أو QR Code
                </h3>
                <p className="text-xs text-slate-500">
                  قم بمسح الباركود بجهاز قارئ خارجي أو أدخل الرقم التسلسلي (S/N) مباشرة
                </p>
              </div>
            </div>

            {auditSuccessMsg && (
              <div className="mb-4 p-3 bg-emerald-100 border border-emerald-300 rounded-xl text-xs font-bold text-emerald-800 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                <span>{auditSuccessMsg}</span>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  إدخال أو مسح الرقم التسلسلي (S/N) / معرف الأصل *
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute right-3.5 top-3 text-slate-400" />
                  <input
                    type="text"
                    value={scannedInput}
                    onChange={(e) => handleScanQuery(e.target.value)}
                    placeholder="امسح الباركود أو اكتب الرقم التسلسلي..."
                    autoFocus
                    className="w-full pl-4 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs font-mono font-bold"
                  />
                </div>
              </div>

              {scannedInput.trim() !== '' && (
                <div className="p-4 rounded-2xl border bg-slate-50">
                  {scannedAssetResult ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                          تم العثور على الأصل بنجاح ✓
                        </span>
                        <span className="font-mono text-xs text-slate-500">
                          SN: {scannedAssetResult.serialNumber}
                        </span>
                      </div>

                      <div>
                        <h4 className="font-black text-base text-[#183B56]">
                          {scannedAssetResult.brand} {scannedAssetResult.model}
                        </h4>
                        <p className="text-xs text-slate-600 mt-0.5">
                          التصنيف: {ASSET_CATEGORY_LABELS[scannedAssetResult.category]} • الموقع:{' '}
                          {scannedAssetResult.officeName || 'المستودع الرئيسي'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                        {canRecordInventoryCheck && <button
                          onClick={async () => {
                            if (!profile?.uid || auditSaving) return;
                            setAuditSaving(true);
                            setAuditSuccessMsg('');
                            try {
                              await recordInventoryCheck(scannedAssetResult, {
                                uid: profile.uid,
                                name: actorName,
                                email: profile.email,
                              });
                              setAuditSuccessMsg(
                                `تم حفظ عملية جرد (${scannedAssetResult.brand} ${scannedAssetResult.model}) في سجل الجرد بتاريخ ${new Date().toLocaleString('ar')}`
                              );
                            } catch (error) {
                              alert(error instanceof Error ? error.message : 'تعذر حفظ عملية الجرد');
                            } finally {
                              setAuditSaving(false);
                            }
                          }}
                          disabled={auditSaving || !profile?.uid}
                          className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl cursor-pointer disabled:opacity-50"
                        >
                          {auditSaving ? 'جاري حفظ الجرد...' : 'تأكيد الجرد والتحقق'}
                        </button>}
                        <button
                          onClick={() => {
                            setIsScannerOpen(false);
                            setSelectedAssetDetail(scannedAssetResult);
                          }}
                          className="px-4 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold rounded-xl cursor-pointer"
                        >
                          عرض التفاصيل
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6 text-rose-600">
                      <p className="font-bold text-sm">لم يتم العثور على أصل بهذا الرقم التسلسلي أو المعرف</p>
                      <p className="text-xs text-slate-500 mt-1">تأكد من صحة الباركود أو قم بإضافة الأصل الجديد</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-6 pt-3 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => setIsScannerOpen(false)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-xl cursor-pointer"
              >
                إنهاء الجرد
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
