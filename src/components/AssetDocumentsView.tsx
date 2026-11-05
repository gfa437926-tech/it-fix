import React, { useState, useEffect } from 'react';
import {
  Paperclip,
  Upload,
  Search,
  Filter,
  FileText,
  Image,
  Download,
  Trash2,
  X,
  ExternalLink,
} from 'lucide-react';
import { AssetDocument, DocumentType, DOCUMENT_TYPE_LABELS, Asset } from '../types';
import {
  watchAssetDocuments,
  uploadAssetDocument,
  deleteAssetDocument,
} from '../services/documentService';
import { useAuth } from '../context/AuthContext';

interface AssetDocumentsViewProps {
  assets: Asset[];
}

export const AssetDocumentsView: React.FC<AssetDocumentsViewProps> = ({ assets }) => {
  const { profile, user } = useAuth();
  const actorName = profile?.displayName || user?.email || 'المسؤول';

  const [documents, setDocuments] = useState<AssetDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  // Upload modal
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState(assets[0]?.id || '');
  const [documentType, setDocumentType] = useState<DocumentType>('invoice');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  useEffect(() => {
    const unsub = watchAssetDocuments(undefined, (docs) => {
      setDocuments(docs);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !selectedAssetId) {
      setUploadError('يرجى تحديد الملف واختيار الأصل المرتبط');
      return;
    }

    setUploadLoading(true);
    setUploadError('');

    try {
      await uploadAssetDocument(
        selectedFile,
        selectedAssetId,
        documentType,
        actorName
      );
      setIsUploadOpen(false);
      setSelectedFile(null);
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'تعذر رفع المستند');
    } finally {
      setUploadLoading(false);
    }
  };

  const handleDelete = async (docId: string, name: string) => {
    if (window.confirm(`هل أنت متأكد من حذف المستند (${name})؟`)) {
      try {
        await deleteAssetDocument(docId);
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'تعذر حذف المستند');
      }
    }
  };

  const filtered = documents.filter((d) => {
    const matchesSearch =
      search.trim() === '' ||
      d.fileName.toLowerCase().includes(search.toLowerCase());

    const matchesType = typeFilter === 'all' || d.documentType === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#183B56]">مرفقات ومستندات الأصول</h2>
          <p className="text-sm text-slate-500">
            أرشيف الفواتير، شهادات الضمان، صور الأجهزة، ونماذج العهد الإلكترونية
          </p>
        </div>

        <button
          onClick={() => {
            setSelectedAssetId(assets[0]?.id || '');
            setSelectedFile(null);
            setUploadError('');
            setIsUploadOpen(true);
          }}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#168C8C] hover:bg-[#137676] text-white text-sm font-bold rounded-xl shadow-xs transition-all cursor-pointer"
        >
          <Upload className="w-4 h-4" />
          <span>رفع مستند جديد</span>
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
            placeholder="بحث باسم المستند..."
            className="w-full pl-4 pr-10 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="text-xs font-semibold py-2 px-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
          >
            <option value="all">كل أنواع المستندات ({documents.length})</option>
            {Object.entries(DOCUMENT_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Documents Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filtered.length === 0 ? (
          <div className="col-span-full py-16 text-center text-slate-400 bg-white rounded-2xl border border-slate-200/90">
            <Paperclip className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="font-bold">لا توجد مستندات مرفوعة مطابقة</p>
          </div>
        ) : (
          filtered.map((docItem) => {
            const isImg = docItem.contentType?.startsWith('image/');
            const linkedAsset = assets.find((a) => a.id === docItem.assetId);

            return (
              <div
                key={docItem.id}
                className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-col justify-between hover:border-[#168C8C] transition-all"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#168C8C]/10 text-[#168C8C]">
                      {DOCUMENT_TYPE_LABELS[docItem.documentType] || docItem.documentType}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {Math.round((docItem.sizeBytes || 0) / 1024)} KB
                    </span>
                  </div>

                  <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center my-3 mx-auto text-slate-500">
                    {isImg ? <Image className="w-6 h-6 text-[#168C8C]" /> : <FileText className="w-6 h-6 text-[#183B56]" />}
                  </div>

                  <h4 className="font-bold text-xs text-[#183B56] text-center truncate mb-1" title={docItem.fileName}>
                    {docItem.fileName}
                  </h4>

                  <p className="text-[11px] text-slate-500 text-center truncate">
                    {linkedAsset ? `${linkedAsset.brand} ${linkedAsset.model}` : 'أصل مرتبط'}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">
                    {new Date(docItem.createdAt).toLocaleDateString('ar-EG')}
                  </span>
                  <div className="flex items-center gap-1">
                    {docItem.downloadUrl && (
                      <a
                        href={docItem.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 text-slate-400 hover:text-[#168C8C] hover:bg-teal-50 rounded-lg cursor-pointer"
                        title="معاينة أو تنزيل"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                    <button
                      onClick={() => handleDelete(docItem.id, docItem.fileName)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                      title="حذف المستند"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Upload Modal */}
      {isUploadOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl relative">
            <button
              onClick={() => setIsUploadOpen(false)}
              className="absolute left-4 top-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold text-[#183B56] mb-1">رفع مستند ومرفق أصل</h3>
            <p className="text-xs text-slate-500 mb-4">
              إرفاق فاتورة، شهادة ضمان، أو صورة فنية مرتبطة بجهاز
            </p>

            {uploadError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-bold">
                {uploadError}
              </div>
            )}

            <form onSubmit={handleUploadSubmit} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الأصل المرتبط *</label>
                <select
                  value={selectedAssetId}
                  onChange={(e) => setSelectedAssetId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs font-semibold"
                  required
                >
                  <option value="">اختر الأصل...</option>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.brand} {a.model} — SN: {a.serialNumber}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">نوع المستند *</label>
                <select
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value as DocumentType)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs font-semibold"
                >
                  {Object.entries(DOCUMENT_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">حدد الملف *</label>
                <input
                  type="file"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:bg-[#168C8C] file:text-white file:text-xs file:font-bold"
                  required
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsUploadOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={uploadLoading || !selectedFile}
                  className="px-5 py-2 text-xs font-bold bg-[#168C8C] hover:bg-[#137676] text-white rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {uploadLoading ? 'جاري الرفع...' : 'رفع وحفظ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
