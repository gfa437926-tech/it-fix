import React, { useState } from 'react';
import {
  UploadCloud,
  FileSpreadsheet,
  Download,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Edit3,
  RefreshCw,
  Plus,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Asset, AssetCategory, ASSET_CATEGORY_LABELS, ASSET_STATUS_LABELS } from '../types';
import { parseCSV } from '../services/importService';
import { createAsset, updateAsset } from '../services/assetService';
import { useAuth } from '../context/AuthContext';

interface EditableImportRow {
  rowIndex: number;
  isExisting: boolean;
  existingAssetId?: string;
  category: AssetCategory;
  brand: string;
  model: string;
  serialNumber: string;
  officeName: string;
  status: string;
  cpu: string;
  ram: string;
  storage: string;
  changes: string[];
  error?: string;
}

interface AssetImportViewProps {
  assets: Asset[];
  onImportComplete?: () => void;
}

export const AssetImportView: React.FC<AssetImportViewProps> = ({
  assets,
  onImportComplete,
}) => {
  const { profile, user } = useAuth();
  const actorName = profile?.displayName || user?.email || 'المسؤول';

  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<EditableImportRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resultSummary, setResultSummary] = useState<{
    newAdded: number;
    updated: number;
    failed: number;
    errors: string[];
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Download Sample Sheet (Excel + CSV supported)
  const handleDownloadTemplate = () => {
    const sampleData = [
      {
        'التصنيف': 'desktop',
        'الشركة': 'Dell',
        'الموديل': 'OptiPlex 7090',
        'الرقم التسلسلي': 'DELL-SN-1001',
        'المكتب': 'المستودع الرئيسي',
        'الحالة': 'available',
        'المعالج': 'i7-11700',
        'الذاكرة': '16GB',
        'التخزين': '512GB SSD',
      },
      {
        'التصنيف': 'laptop',
        'الشركة': 'HP',
        'الموديل': 'EliteBook 840 G8',
        'الرقم التسلسلي': 'HP-SN-1002',
        'المكتب': 'إدارة تقنية المعلومات',
        'الحالة': 'available',
        'المعالج': 'i5-1135G7',
        'الذاكرة': '8GB',
        'التخزين': '256GB SSD',
      },
      {
        'التصنيف': 'monitor',
        'الشركة': 'Dell',
        'الموديل': 'P2419H',
        'الرقم التسلسلي': 'DELL-MN-1003',
        'المكتب': 'الموارد البشرية',
        'الحالة': 'available',
        'المعالج': '',
        'الذاكرة': '',
        'التخزين': '',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(sampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الأجهزة');
    XLSX.writeFile(wb, 'نموذج_استيراد_وتحديث_الأصول.xlsx');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setResultSummary(null);
    setErrorMsg('');

    const reader = new FileReader();

    if (file.name.endsWith('.csv')) {
      reader.onload = (event) => {
        try {
          const text = event.target?.result as string;
          const rawRows = parseCSV(text);
          parseAndClassifyRows(rawRows);
        } catch (err) {
          setErrorMsg('تعذر قراءة ملف CSV. تأكد من صحة التنسيق.');
        }
      };
      reader.readAsText(file);
    } else {
      // Excel (.xlsx or .xls)
      reader.onload = (event) => {
        try {
          const data = new Uint8Array(event.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(firstSheet);
          parseAndClassifyRows(rawRows);
        } catch (err) {
          setErrorMsg('تعذر قراءة ملف Excel.');
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const parseAndClassifyRows = (rawRows: Record<string, string>[]) => {
    // Map existing assets by uppercase serial
    const existingBySerial = new Map<string, Asset>();
    assets.forEach((a) => {
      if (a.serialNumber) {
        existingBySerial.set(a.serialNumber.trim().toUpperCase(), a);
      }
    });

    const firstRowBySerial = new Map<string, number>();
    const parsed: EditableImportRow[] = rawRows.map((raw, idx) => {
      const rowIndex = idx + 2;

      const categoryRaw = (
        raw.category ||
        raw['التصنيف'] ||
        raw['نوع الجهاز'] ||
        'desktop'
      )
        .toLowerCase()
        .trim();

      const validCategories: AssetCategory[] = [
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

      const category = (validCategories.includes(categoryRaw as AssetCategory)
        ? categoryRaw
        : 'other') as AssetCategory;

      const brand = (raw.brand || raw['الشركة'] || raw['الشركة المصنعة'] || '').trim();
      const model = (raw.model || raw['الموديل'] || raw['الطراز'] || '').trim();
      const serialNumber = (
        raw.serialNumber ||
        raw['الرقم التسلسلي'] ||
        raw['السيريال'] ||
        ''
      )
        .trim()
        .toUpperCase();

      const officeName = (
        raw.officeName ||
        raw['المكتب'] ||
        raw['الموقع'] ||
        'المستودع الرئيسي'
      ).trim();

      const status = (raw.status || raw['الحالة'] || 'available').trim();
      const cpu = (raw.cpu || raw['المعالج'] || '').trim();
      const ram = (raw.ram || raw['الذاكرة'] || '').trim();
      const storage = (raw.storage || raw['التخزين'] || '').trim();

      let error = '';
      if (!brand || !model) {
        error = 'اسم الشركة والموديل مطلوبان';
      } else if (!serialNumber) {
        error = 'الرقم التسلسلي مطلوب';
      } else if (firstRowBySerial.has(serialNumber)) {
        error = `الرقم التسلسلي مكرر داخل الملف (ظهر أولاً في السطر ${firstRowBySerial.get(serialNumber)})`;
      } else {
        firstRowBySerial.set(serialNumber, rowIndex);
      }

      // Check if existing asset matches this serial
      const existing = serialNumber ? existingBySerial.get(serialNumber) : undefined;
      const isExisting = Boolean(existing);
      const changes: string[] = [];

      if (existing) {
        if (existing.officeName !== officeName && officeName) {
          changes.push(`المكتب: ${existing.officeName || 'المستودع'} ➔ ${officeName}`);
        }
        if (existing.brand !== brand && brand) {
          changes.push(`الشركة: ${existing.brand} ➔ ${brand}`);
        }
        if (existing.model !== model && model) {
          changes.push(`الموديل: ${existing.model} ➔ ${model}`);
        }
        if (existing.cpu !== cpu && cpu) {
          changes.push(`المعالج: ${existing.cpu || 'فارغ'} ➔ ${cpu}`);
        }
        if (existing.ram !== ram && ram) {
          changes.push(`الذاكرة: ${existing.ram || 'فارغ'} ➔ ${ram}`);
        }
        if (existing.storage !== storage && storage) {
          changes.push(`التخزين: ${existing.storage || 'فارغ'} ➔ ${storage}`);
        }
      }

      return {
        rowIndex,
        isExisting,
        existingAssetId: existing?.id,
        category,
        brand,
        model,
        serialNumber,
        officeName,
        status,
        cpu,
        ram,
        storage,
        changes,
        error,
      };
    });

    setRows(parsed);
  };

  // Modify cell value in-memory
  const handleCellChange = (
    index: number,
    field: keyof EditableImportRow,
    value: string
  ) => {
    setRows((prev) => {
      const updated = prev.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row
      );
      const firstRowBySerial = new Map<string, number>();
      return updated.map((row) => {
        const serial = row.serialNumber.trim().toUpperCase();
        let error = '';
        if (!row.brand.trim() || !row.model.trim()) {
          error = 'اسم الشركة والموديل مطلوبان';
        } else if (!serial) {
          error = 'الرقم التسلسلي مطلوب';
        } else if (firstRowBySerial.has(serial)) {
          error = `الرقم التسلسلي مكرر داخل الملف (ظهر أولاً في السطر ${firstRowBySerial.get(serial)})`;
        } else {
          firstRowBySerial.set(serial, row.rowIndex);
        }
        return { ...row, serialNumber: serial, error };
      });
    });
  };

  // Execute Upsert: Add new cards + Update existing cards
  const handleApplyChanges = async (mode: 'all' | 'new_only' | 'updates_only') => {
    if (rows.length === 0) return;
    setIsProcessing(true);
    setErrorMsg('');

    let newAdded = 0;
    let updated = 0;
    let failed = 0;
    const errors: string[] = [];
    const appliedSerials = new Set<string>();

    for (const row of rows) {
      if (row.error) {
        failed++;
        continue;
      }

      // Filter by execution mode
      if (mode === 'new_only' && row.isExisting) continue;
      if (mode === 'updates_only' && !row.isExisting) continue;

      // Revalidate editable preview values immediately before writing.
      const normalizedSerial = row.serialNumber.trim().toUpperCase();
      if (!row.brand.trim() || !row.model.trim() || !normalizedSerial) {
        failed++;
        errors.push(`السطر ${row.rowIndex}: الشركة والموديل والرقم التسلسلي حقول إلزامية`);
        continue;
      }
      if (appliedSerials.has(normalizedSerial)) {
        failed++;
        errors.push(`السطر ${row.rowIndex}: الرقم التسلسلي (${normalizedSerial}) مكرر ضمن الصفوف المحددة للتطبيق`);
        continue;
      }
      appliedSerials.add(normalizedSerial);

      try {
        if (row.isExisting && row.existingAssetId) {
          // Update existing asset card
          const original = assets.find((a) => a.id === row.existingAssetId);
          if (original) {
            await updateAsset({
              ...original,
              brand: row.brand,
              model: row.model,
              category: row.category,
              serialNumber: row.serialNumber,
              officeName: row.officeName,
              cpu: row.cpu || undefined,
              ram: row.ram || undefined,
              storage: row.storage || undefined,
            });
            updated++;
          }
        } else {
          // Create new asset card
          await createAsset(
            {
              category: row.category,
              brand: row.brand,
              model: row.model,
              serialNumber: row.serialNumber,
              officeName: row.officeName || 'المستودع الرئيسي',
              status: 'available',
              cpu: row.cpu || undefined,
              ram: row.ram || undefined,
              storage: row.storage || undefined,
              receivedAt: new Date().toISOString(),
            },
            actorName
          );
          newAdded++;
        }
      } catch (err: unknown) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`السطر ${row.rowIndex} (${row.serialNumber}): ${msg}`);
      }
    }

    setResultSummary({
      newAdded,
      updated,
      failed,
      errors,
    });
    setIsProcessing(false);
    if (onImportComplete) onImportComplete();
  };

  const newCardsCount = rows.filter((r) => !r.isExisting && !r.error).length;
  const updateCardsCount = rows.filter((r) => r.isExisting && !r.error).length;
  const errorsCount = rows.filter((r) => r.error).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#183B56]">
            رفع وتعديل ملفات الشيت المحلية (Excel & CSV)
          </h2>
          <p className="text-sm text-slate-500">
            رفع ملفات الشيت من جهاز الكمبيوتر لإضافة بطاقات جديدة أو تعديل وتحديث البطاقات المسجلة
          </p>
        </div>

        <button
          onClick={handleDownloadTemplate}
          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
        >
          <Download className="w-4 h-4 text-[#168C8C]" />
          <span>تحميل نموذج الشيت الجاهز (Excel)</span>
        </button>
      </div>

      {/* Upload Dropzone */}
      <div className="bg-white p-8 rounded-2xl border-2 border-dashed border-slate-300 text-center hover:border-[#168C8C] transition-all">
        <UploadCloud className="w-12 h-12 text-[#168C8C] mx-auto mb-3" />
        <h3 className="font-bold text-base text-[#183B56]">
          حدد ملف الشيت من جهاز الكمبيوتر (.xlsx أو .csv)
        </h3>
        <p className="text-xs text-slate-500 mt-1 max-w-lg mx-auto">
          يقوم النظام تلقائياً باكتشاف البطاقات: إذا كان الرقم التسلسلي موجوداً يُعرض كتعديل، وإذا كان
          جديداً يُعرض كإضافة بطاقة جديدة، مع إمكانية تعديل أي بيان قبل التأكيد.
        </p>

        <label className="mt-4 inline-block px-5 py-2.5 bg-[#183B56] hover:bg-[#122c42] text-white text-xs font-bold rounded-xl cursor-pointer shadow-xs transition-all">
          <span>اختيار ملف من جهاز الكمبيوتر</span>
          <input
            type="file"
            accept=".xlsx, .xls, .csv"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>

        {fileName && (
          <p className="mt-3 text-xs font-bold text-emerald-700">الملف الحالي: {fileName}</p>
        )}
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Result summary banner */}
      {resultSummary && (
        <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-2xl">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-7 h-7 text-emerald-600" />
              <div>
                <h4 className="font-bold text-base text-slate-900">
                  {resultSummary.failed > 0
                    ? 'اكتملت العملية مع وجود سجلات لم تُحفظ'
                    : 'تم تنفيذ العملية وتحديث قاعدة البيانات بنجاح'}
                </h4>
                <p className="text-xs text-slate-600">
                  {resultSummary.failed > 0
                    ? 'راجع تفاصيل الأخطاء أدناه قبل إعادة استيراد السجلات المتبقية'
                    : 'تم حفظ التغييرات والبطاقات في منظومة الأصول السحابية'}
                </p>
              </div>
            </div>

            <button
              onClick={() => {
                setRows([]);
                setResultSummary(null);
                setFileName('');
              }}
              className="text-xs font-bold text-slate-600 hover:underline flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>رفع ملف شيت آخر</span>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center text-xs">
            <div className="bg-white/80 p-3 rounded-xl border border-slate-200">
              <span className="text-emerald-800 font-medium">بطاقات جديدة أُضيفت</span>
              <p className="text-2xl font-black text-emerald-700 mt-1">{resultSummary.newAdded}</p>
            </div>
            <div className="bg-white/80 p-3 rounded-xl border border-slate-200">
              <span className="text-blue-800 font-medium">بطاقات تم تحديث بياناتها</span>
              <p className="text-2xl font-black text-blue-700 mt-1">{resultSummary.updated}</p>
            </div>
            <div className="bg-white/80 p-3 rounded-xl border border-slate-200">
              <span className="text-slate-600 font-medium">سجلات فشلت أو بها خطأ</span>
              <p className="text-2xl font-black text-slate-800 mt-1">{resultSummary.failed}</p>
            </div>
          </div>

          {resultSummary.errors.length > 0 && (
            <div className="mt-3 p-3 bg-white rounded-xl text-xs text-rose-700 space-y-1">
              <span className="font-bold block mb-1">الأخطاء:</span>
              {resultSummary.errors.map((e, i) => (
                <div key={i}>• {e}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Editable Preview Table */}
      {rows.length > 0 && !resultSummary && (
        <div className="space-y-4">
          {/* Action Toolbar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
            <div className="flex items-center gap-3 text-xs font-bold">
              <span className="text-slate-700">تحليل محتويات الشيت:</span>
              <span className="px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg">
                {newCardsCount} بطاقة جديدة للإضافة
              </span>
              <span className="px-2.5 py-1 bg-blue-50 text-blue-800 border border-blue-200 rounded-lg">
                {updateCardsCount} بطاقة موجودة سيتم تعديلها
              </span>
              {errorsCount > 0 && (
                <span className="px-2.5 py-1 bg-rose-50 text-rose-800 border border-rose-200 rounded-lg">
                  {errorsCount} أخطاء
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleApplyChanges('all')}
                disabled={isProcessing}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50"
              >
                {isProcessing ? 'جاري الحفظ والتعديل...' : 'تطبيق الكل (إضافة + تعديل)'}
              </button>

              {newCardsCount > 0 && (
                <button
                  onClick={() => handleApplyChanges('new_only')}
                  disabled={isProcessing}
                  className="px-3 py-2 bg-[#183B56] hover:bg-[#122c42] text-white text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-50"
                >
                  إضافة الجديد فقط ({newCardsCount})
                </button>
              )}

              {updateCardsCount > 0 && (
                <button
                  onClick={() => handleApplyChanges('updates_only')}
                  disabled={isProcessing}
                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-50"
                >
                  تعديل التغييرات فقط ({updateCardsCount})
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
            <div className="p-3 bg-slate-50 border-b text-xs text-slate-500 font-medium flex items-center justify-between">
              <span>يمكنك النقر وتعديل أي حقل مباشرة في الجدول أدناه قبل الضغط على تطبيق:</span>
              <span className="text-[11px] font-bold text-slate-400">
                إجمالي الصفوف: {rows.length}
              </span>
            </div>

            <div className="overflow-x-auto max-h-[500px]">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-100 text-slate-600 border-b border-slate-200 sticky top-0 z-10">
                  <tr>
                    <th className="py-2.5 px-3">النوع</th>
                    <th className="py-2.5 px-3">الرقم التسلسلي (SN)</th>
                    <th className="py-2.5 px-3">الشركة</th>
                    <th className="py-2.5 px-3">الموديل</th>
                    <th className="py-2.5 px-3">التصنيف</th>
                    <th className="py-2.5 px-3">المكتب / الموقع</th>
                    <th className="py-2.5 px-3">المواصفات (CPU / RAM / Disk)</th>
                    <th className="py-2.5 px-3">التغييرات المكتشفة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row, idx) => (
                    <tr
                      key={row.rowIndex}
                      className={
                        row.error
                          ? 'bg-rose-50/50'
                          : row.isExisting
                          ? 'bg-blue-50/30'
                          : 'bg-emerald-50/20'
                      }
                    >
                      {/* Action status tag */}
                      <td className="py-2.5 px-3">
                        {row.error ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                            خطأ بالبيانات
                          </span>
                        ) : row.isExisting ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 flex items-center gap-1 w-max">
                            <Edit3 className="w-3 h-3" />
                            <span>تعديل بطاقة</span>
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1 w-max">
                            <Plus className="w-3 h-3" />
                            <span>بطاقة جديدة</span>
                          </span>
                        )}
                      </td>

                      {/* Serial Number */}
                      <td className="py-2.5 px-3 font-mono font-bold">
                        <input
                          type="text"
                          value={row.serialNumber}
                          onChange={(e) => handleCellChange(idx, 'serialNumber', e.target.value)}
                          className="bg-transparent border border-transparent hover:border-slate-300 focus:border-[#168C8C] focus:bg-white rounded px-1.5 py-0.5 w-full font-mono text-xs uppercase"
                        />
                      </td>

                      {/* Brand */}
                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          value={row.brand}
                          onChange={(e) => handleCellChange(idx, 'brand', e.target.value)}
                          className="bg-transparent border border-transparent hover:border-slate-300 focus:border-[#168C8C] focus:bg-white rounded px-1.5 py-0.5 w-24 text-xs font-bold"
                        />
                      </td>

                      {/* Model */}
                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          value={row.model}
                          onChange={(e) => handleCellChange(idx, 'model', e.target.value)}
                          className="bg-transparent border border-transparent hover:border-slate-300 focus:border-[#168C8C] focus:bg-white rounded px-1.5 py-0.5 w-32 text-xs"
                        />
                      </td>

                      {/* Category */}
                      <td className="py-2.5 px-3">
                        <select
                          value={row.category}
                          onChange={(e) => handleCellChange(idx, 'category', e.target.value)}
                          className="bg-transparent border border-transparent hover:border-slate-300 focus:border-[#168C8C] focus:bg-white rounded px-1.5 py-0.5 text-xs font-semibold"
                        >
                          {Object.entries(ASSET_CATEGORY_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </td>

                      {/* Office */}
                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          value={row.officeName}
                          onChange={(e) => handleCellChange(idx, 'officeName', e.target.value)}
                          className="bg-transparent border border-transparent hover:border-slate-300 focus:border-[#168C8C] focus:bg-white rounded px-1.5 py-0.5 w-32 text-xs"
                        />
                      </td>

                      {/* Specs */}
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            placeholder="CPU"
                            value={row.cpu}
                            onChange={(e) => handleCellChange(idx, 'cpu', e.target.value)}
                            className="bg-transparent border border-transparent hover:border-slate-300 focus:bg-white rounded px-1 py-0.5 w-16 text-[11px]"
                          />
                          <input
                            type="text"
                            placeholder="RAM"
                            value={row.ram}
                            onChange={(e) => handleCellChange(idx, 'ram', e.target.value)}
                            className="bg-transparent border border-transparent hover:border-slate-300 focus:bg-white rounded px-1 py-0.5 w-14 text-[11px]"
                          />
                          <input
                            type="text"
                            placeholder="Disk"
                            value={row.storage}
                            onChange={(e) => handleCellChange(idx, 'storage', e.target.value)}
                            className="bg-transparent border border-transparent hover:border-slate-300 focus:bg-white rounded px-1 py-0.5 w-16 text-[11px]"
                          />
                        </div>
                      </td>

                      {/* Detected diff / changes */}
                      <td className="py-2.5 px-3">
                        {row.changes.length > 0 ? (
                          <div className="space-y-0.5 text-[10px] text-blue-700 font-medium">
                            {row.changes.map((c, i) => (
                              <div key={i}>• {c}</div>
                            ))}
                          </div>
                        ) : row.isExisting ? (
                          <span className="text-[10px] text-slate-400">لا توجد تغييرات</span>
                        ) : (
                          <span className="text-[10px] text-emerald-600 font-semibold">سجل جديد</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
