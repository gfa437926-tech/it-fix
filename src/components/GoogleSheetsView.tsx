import React, { useState, useEffect } from 'react';
import {
  Sheet,
  ExternalLink,
  RefreshCw,
  PlusCircle,
  Link,
  CheckCircle2,
  AlertTriangle,
  Lock,
  ArrowUpRight,
  Shield,
  FileSpreadsheet,
} from 'lucide-react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { Asset, CustodyRecord } from '../types';
import {
  createSpreadsheet,
  syncDataToGoogleSheet,
  fetchSheetValues,
  GoogleSpreadsheetInfo,
} from '../services/googleSheetsService';
import { createAsset, updateAsset } from '../services/assetService';

interface GoogleSheetsViewProps {
  assets: Asset[];
  custodyCards: CustodyRecord[];
  onRefreshData?: () => void;
}

export const GoogleSheetsView: React.FC<GoogleSheetsViewProps> = ({
  assets,
  custodyCards,
  onRefreshData,
}) => {
  const {
    user,
    profile,
    isPrimaryController,
    primaryControllerEmail,
    googleAccessToken,
    requestGoogleAccessToken,
  } = useAuth();

  const [connectedSheet, setConnectedSheet] = useState<GoogleSpreadsheetInfo | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncedBy, setSyncedBy] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Manual link input
  const [customSheetUrl, setCustomSheetUrl] = useState('');
  const [isLinkingManual, setIsLinkingManual] = useState(false);

  // Load existing connected sheet from Firestore settings
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const snap = await getDoc(doc(db, 'system_settings', 'google_sheets'));
        if (snap.exists()) {
          const data = snap.data();
          setConnectedSheet({
            spreadsheetId: data.spreadsheetId,
            spreadsheetUrl: data.spreadsheetUrl,
            title: data.title || 'جدول أصول وعهد تقنية المعلومات',
          });
          setLastSyncedAt(data.lastSyncedAt || null);
          setSyncedBy(data.syncedBy || null);
        }
      } catch (e) {
        console.error('Failed to load sheet settings:', e);
      }
    };
    fetchSettings();
  }, []);

  // Ensure access token is available, or request it
  const ensureToken = async (): Promise<string> => {
    if (googleAccessToken) return googleAccessToken;
    const token = await requestGoogleAccessToken();
    if (!token) throw new Error('يرجى تسجيل الدخول بحساب Google ومنح إذن الوصول إلى جداول البيانات');
    return token;
  };

  // Create new spreadsheet
  const handleCreateNewSheet = async () => {
    if (!isPrimaryController) {
      setErrorMessage('إنشاء جدول Google Sheets متاح للمتحكم الأول فقط.');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const token = await ensureToken();
      const sheetInfo = await createSpreadsheet(token);

      // Save to Firestore settings
      const now = new Date().toISOString();
      await setDoc(doc(db, 'system_settings', 'google_sheets'), {
        ...sheetInfo,
        lastSyncedAt: now,
        syncedBy: profile?.displayName || user?.email,
      });

      // Immediately sync current data
      await syncDataToGoogleSheet(token, sheetInfo.spreadsheetId, assets, custodyCards);

      setConnectedSheet(sheetInfo);
      setLastSyncedAt(now);
      setSyncedBy(profile?.displayName || user?.email || 'المتحكم');
      setSuccessMessage('تم إنشاء جدول البيانات في Google Sheets بنجاح وإرسال كافة البطاقات إليه!');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'تعذر إنشاء جدول البيانات');
    } finally {
      setLoading(false);
    }
  };

  // Link existing spreadsheet by URL or ID
  const handleLinkExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPrimaryController) {
      setErrorMessage('ربط جدول Google Sheets متاح للمتحكم الأول فقط.');
      return;
    }
    if (!customSheetUrl.trim()) return;

    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      // Extract spreadsheet ID from URL or bare ID
      let id = customSheetUrl.trim();
      const match = customSheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (match && match[1]) {
        id = match[1];
      }

      const url = `https://docs.google.com/spreadsheets/d/${id}/edit`;
      const sheetInfo: GoogleSpreadsheetInfo = {
        spreadsheetId: id,
        spreadsheetUrl: url,
        title: 'جدول البيانات المرتبط',
      };

      const now = new Date().toISOString();
      await setDoc(doc(db, 'system_settings', 'google_sheets'), {
        ...sheetInfo,
        lastSyncedAt: now,
        syncedBy: profile?.displayName || user?.email,
      });

      setConnectedSheet(sheetInfo);
      setLastSyncedAt(now);
      setSyncedBy(profile?.displayName || user?.email || 'المتحكم');
      setIsLinkingManual(false);
      setCustomSheetUrl('');
      setSuccessMessage('تم ربط جدول البيانات بنجاح!');
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'تعذر ربط جدول البيانات');
    } finally {
      setLoading(false);
    }
  };

  // Sync / Send data to connected spreadsheet
  const handleSyncToSheet = async () => {
    if (!isPrimaryController) {
      setErrorMessage('مزامنة Google Sheets متاحة للمتحكم الأول فقط.');
      return;
    }
    if (!connectedSheet) return;
    setLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const token = await ensureToken();
      await syncDataToGoogleSheet(token, connectedSheet.spreadsheetId, assets, custodyCards);

      const now = new Date().toISOString();
      await setDoc(
        doc(db, 'system_settings', 'google_sheets'),
        {
          lastSyncedAt: now,
          syncedBy: profile?.displayName || user?.email,
        },
        { merge: true }
      );

      setLastSyncedAt(now);
      setSyncedBy(profile?.displayName || user?.email || 'المتحكم');
      setSuccessMessage(
        `تم إرسال ومزامنة (${assets.length}) بطاقة أصل و (${custodyCards.length}) بطاقة عهدة إلى Google Sheets بنجاح!`
      );
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'تعذر مزامنة البيانات مع Google Sheets');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black text-[#183B56]">
              ربط ومزامنة جداول بيانات جوجل (Google Sheets)
            </h2>
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
              سحابي مباشر
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            ربط المنظومة بحساب Google الخاص بالمتحكم الأول لإرسال واستقبال بطاقات الأجهزة والعهد
          </p>
        </div>

        {connectedSheet && (
          <a
            href={connectedSheet.spreadsheetUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs transition-all"
          >
            <ExternalLink className="w-4 h-4" />
            <span>فتح جدول البيانات في Google Sheets</span>
          </a>
        )}
      </div>

      {/* Primary Controller Status Card */}
      <div
        className={`p-5 rounded-2xl border ${
          isPrimaryController
            ? 'bg-amber-50/80 border-amber-200'
            : 'bg-slate-50 border-slate-200'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isPrimaryController
                ? 'bg-amber-200 text-amber-900'
                : 'bg-slate-200 text-slate-600'
            }`}
          >
            <Shield className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-[#183B56]">
                {isPrimaryController
                  ? 'أنت المتحكم الأول بالنظام (Primary Controller)'
                  : 'المتحكم بالنظام'}
              </h3>
              <span className="text-[11px] px-2 py-0.5 rounded bg-white text-slate-700 font-bold border border-slate-200">
                {primaryControllerEmail || user?.email}
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              {isPrimaryController
                ? 'أول شخص دخل إلى المنظومة وله كامل الصلاحية لربط جداول Google Sheets وإرسال وتحديث البيانات.'
                : `المتحكم الأول المسجل هو (${primaryControllerEmail}) وهو المصرح له بإدارة الربط ومزامنة جداول البيانات.`}
            </p>
          </div>
        </div>
      </div>

      {/* Notifications / Alerts */}
      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-bold text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{successMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs font-bold text-rose-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Connected Sheet Status or Connect Box */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs space-y-6">
        {connectedSheet ? (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <FileSpreadsheet className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-[#183B56]">{connectedSheet.title}</h3>
                  <p className="font-mono text-xs text-slate-400 mt-0.5">
                    ID: {connectedSheet.spreadsheetId}
                  </p>
                </div>
              </div>

              {/* Sync Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSyncToSheet}
                  disabled={loading || !isPrimaryController}
                  title={!isPrimaryController ? 'متاح للمتحكم الأول فقط' : undefined}
                  className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  <span>{loading ? 'جاري الإرسال...' : 'إرسال وتحديث البيانات إلى Sheet الآن'}</span>
                </button>
              </div>
            </div>

            {/* Sync Meta Details */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-5 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl">
                <span className="text-slate-400 block mb-1">آخر مزامنة ناجحة</span>
                <span className="font-bold text-slate-800">
                  {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString('ar-EG') : 'لم تتم بعد'}
                </span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl">
                <span className="text-slate-400 block mb-1">منفذ المزامنة</span>
                <span className="font-bold text-slate-800">{syncedBy || 'المتحكم الأول'}</span>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl">
                <span className="text-slate-400 block mb-1">إجمالي السجلات الجاهزة للإرسال</span>
                <span className="font-bold text-emerald-700">
                  {assets.length} أصل • {custodyCards.length} عهدة
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4">
              <Sheet className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-[#183B56] mb-1">لم يتم ربط جدول بيانات حتى الآن</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto mb-6">
              يمكن للمتحكم الأول إنشاء جدول Google Sheet جديد بضغطة زر وتنسيقه تلقائياً بالأوراق
              والأعمدة المطلوبة، أو ربط جدول بيانات موجود مسبقاً.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={handleCreateNewSheet}
                disabled={loading || !isPrimaryController}
                title={!isPrimaryController ? 'متاح للمتحكم الأول فقط' : undefined}
                className="flex items-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50"
              >
                <PlusCircle className="w-4 h-4" />
                <span>{loading ? 'جاري الإنشاء والربط...' : 'إنشاء جدول بيانات جديد في Google Drive'}</span>
              </button>

              <button
                onClick={() => setIsLinkingManual(true)}
                disabled={!isPrimaryController}
                title={!isPrimaryController ? 'متاح للمتحكم الأول فقط' : undefined}
                className="flex items-center gap-2 px-4 py-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
              >
                <Link className="w-4 h-4 text-slate-500" />
                <span>ربط جدول بيانات موجود</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Manual Link Modal */}
      {isLinkingManual && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl relative">
            <h3 className="text-lg font-bold text-[#183B56] mb-1">ربط جدول Google Sheet موجود</h3>
            <p className="text-xs text-slate-500 mb-4">
              الصق رابط الجدول الكامل أو معرفه (Spreadsheet ID)
            </p>

            <form onSubmit={handleLinkExisting} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  رابط الجدول (URL) أو المعرف (ID) *
                </label>
                <input
                  type="text"
                  value={customSheetUrl}
                  onChange={(e) => setCustomSheetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs font-mono"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsLinkingManual(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 text-xs font-bold bg-[#183B56] hover:bg-[#122c42] text-white rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  تأكيد الربط
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
