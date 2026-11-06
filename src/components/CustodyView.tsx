import React, { useState, useMemo } from 'react';
import {
  FileCheck2,
  Search,
  Plus,
  Printer,
  X,
  Building,
  User,
  Clock,
  Trash2,
  Edit2,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Layers,
  ArrowRight,
  Shield,
  Download,
  Filter,
} from 'lucide-react';
import { CustodyRecord, CustodyItem, Asset, Office } from '../types';
import {
  saveOfficialCustodyCard,
  deleteCustodyRecord,
} from '../services/custodyService';
import { useAuth } from '../context/AuthContext';
import {
  syncDataToGoogleSheet,
  GoogleSpreadsheetInfo,
} from '../services/googleSheetsService';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface CustodyViewProps {
  custodyCards: CustodyRecord[];
  assets: Asset[];
  offices: Office[];
  initialAssetForCustody?: Asset | null;
  onClearInitialAsset?: () => void;
}

export const CustodyView: React.FC<CustodyViewProps> = ({
  custodyCards,
  assets,
  offices,
  initialAssetForCustody,
  onClearInitialAsset,
}) => {
  const { user, profile, isPrimaryController, googleAccessToken, requestGoogleAccessToken } = useAuth();
  const actorUid = user?.uid || '';
  const actorName = profile?.displayName || user?.email || 'المسؤول';
  const actorEmail = user?.email || '';
  const canManageCustody = profile?.accessControlEnabled !== true || profile.permissions?.['custody.manage'] === true;

  // View presentation mode
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  // Search and advanced filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDirectorate, setSelectedDirectorate] = useState<string>('all');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');

  // Card editor modal state
  const [isEditorOpen, setIsEditorOpen] = useState(Boolean(initialAssetForCustody) && canManageCustody);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);

  // Form Fields matching user's official form
  const [cardNumber, setCardNumber] = useState('');
  const [formNumber, setFormNumber] = useState('نموذج مستودع رقم (23)');
  const [provinceRegion, setProvinceRegion] = useState('المركز الرئيسي');
  const [responsibleName, setResponsibleName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [directorate, setDirectorate] = useState('');
  const [department, setDepartment] = useState('');
  const [officeName, setOfficeName] = useState(initialAssetForCustody?.officeName || offices[0]?.name || '');
  const [officeRoom, setOfficeRoom] = useState('');
  const [itDepartmentHead, setItDepartmentHead] = useState('رئيس دائرة الاتصالات والمعلوماتية');
  const [inventoryTechName, setInventoryTechName] = useState(actorName);
  const [generalNotes, setGeneralNotes] = useState('');

  // Table items inside the card
  const [cardItems, setCardItems] = useState<CustodyItem[]>(() => {
    if (initialAssetForCustody) {
      return [
        {
          id: 'item-1',
          seq: 1,
          itemName: `${initialAssetForCustody.brand} ${initialAssetForCustody.model}`,
          itemDescription: `المعالج: ${initialAssetForCustody.cpu || 'قياسي'} - الرام: ${initialAssetForCustody.ram || '8GB'}`,
          unit: 'جهاز',
          quantityNumber: 1,
          quantityText: 'واحد فقط',
          itemCode: initialAssetForCustody.serialNumber || '',
          cardCode: `CR-${Date.now().toString().slice(-4)}`,
          receiptDocNumber: '101/م',
          receiptDate: new Date().toISOString().split('T')[0],
          returnDocNumber: '',
          returnDate: '',
          balance: 1,
          notes: 'بحالة ممتازة وجاهز للعمل',
          assetId: initialAssetForCustody.id,
        },
      ];
    }
    return [
      {
        id: 'item-1',
        seq: 1,
        itemName: 'كمبيوتر مكتبي متكامل',
        itemDescription: 'شاشة + كيسة + ملحقات',
        unit: 'جهاز',
        quantityNumber: 1,
        quantityText: 'واحد فقط',
        itemCode: '',
        cardCode: '',
        receiptDocNumber: '',
        receiptDate: new Date().toISOString().split('T')[0],
        returnDocNumber: '',
        returnDate: '',
        balance: 1,
        notes: '',
      },
    ];
  });

  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');

  // Printable Official Card Modal
  const [printableCard, setPrintableCard] = useState<CustodyRecord | null>(null);

  // Syncing status
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  // Extract unique directorates & departments for filters
  const directorateOptions = useMemo(() => {
    const set = new Set<string>();
    custodyCards.forEach((c) => {
      if (c.directorate?.trim()) set.add(c.directorate.trim());
    });
    return Array.from(set);
  }, [custodyCards]);

  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    custodyCards.forEach((c) => {
      if (selectedDirectorate === 'all' || c.directorate === selectedDirectorate) {
        if (c.department?.trim()) set.add(c.department.trim());
      }
    });
    return Array.from(set);
  }, [custodyCards, selectedDirectorate]);

  // Flattened items for the official-styled table matching the photo
  const flattenedItems = useMemo(() => {
    const list: {
      card: CustodyRecord;
      item: CustodyItem;
      uniqueKey: string;
    }[] = [];

    custodyCards.forEach((card) => {
      // Directorate filter
      if (selectedDirectorate !== 'all' && card.directorate !== selectedDirectorate) {
        return;
      }
      // Department filter
      if (selectedDepartment !== 'all' && card.department !== selectedDepartment) {
        return;
      }

      const items = card.items && card.items.length > 0 ? card.items : [
        {
          id: `legacy-${card.id}`,
          seq: 1,
          itemName: card.assetLabel || 'أصل مسجل',
          itemDescription: card.notes || 'تجهيز حاسوبي',
          unit: 'جهاز',
          quantityNumber: 1,
          quantityText: 'واحد فقط',
          itemCode: card.assetId || '',
          cardCode: card.cardNumber || card.id,
          receiptDocNumber: '1/م',
          receiptDate: card.assignedAt ? new Date(card.assignedAt).toLocaleDateString('ar-EG') : '',
          balance: 1,
          notes: card.notes || '',
        },
      ];

      items.forEach((item, idx) => {
        // Query search
        const q = searchQuery.toLowerCase().trim();
        const matchesQuery =
          q === '' ||
          (card.responsibleName || card.employeeName || '').toLowerCase().includes(q) ||
          card.officeName.toLowerCase().includes(q) ||
          (card.officeRoom && card.officeRoom.toLowerCase().includes(q)) ||
          item.itemName.toLowerCase().includes(q) ||
          (item.itemCode && item.itemCode.toLowerCase().includes(q)) ||
          (item.cardCode && item.cardCode.toLowerCase().includes(q)) ||
          (card.directorate && card.directorate.toLowerCase().includes(q)) ||
          (card.department && card.department.toLowerCase().includes(q));

        if (matchesQuery) {
          list.push({
            card,
            item: { ...item, seq: item.seq || idx + 1 },
            uniqueKey: `${card.id}-${item.id || idx}`,
          });
        }
      });
    });

    return list;
  }, [custodyCards, selectedDirectorate, selectedDepartment, searchQuery]);

  // Reset editor form
  const handleOpenNewCard = () => {
    setEditingCardId(null);
    setCardNumber(`CR-${Date.now().toString().slice(-5)}`);
    setFormNumber('نموذج مستودع رقم (23)');
    setProvinceRegion('المركز الرئيسي');
    setResponsibleName('');
    setRoleTitle('');
    setDirectorate(offices[0]?.department || 'مديرية تقنية المعلومات');
    setDepartment(offices[0]?.building || 'دائرة الدعم الفني والشبكات');
    setOfficeName(offices[0]?.name || 'المكتب الرئيسي');
    setOfficeRoom('101');
    setItDepartmentHead('رئيس دائرة الاتصالات والمعلوماتية');
    setInventoryTechName(actorName);
    setGeneralNotes('');
    setCardItems([
      {
        id: 'item-1',
        seq: 1,
        itemName: 'كمبيوتر مكتبي HP',
        itemDescription: 'Core i5 - 16GB RAM - 512GB SSD',
        unit: 'جهاز',
        quantityNumber: 1,
        quantityText: 'واحد فقط',
        itemCode: 'HP-SN-8821',
        cardCode: 'CARD-01',
        receiptDocNumber: '12/م',
        receiptDate: new Date().toISOString().split('T')[0],
        returnDocNumber: '',
        returnDate: '',
        balance: 1,
        notes: 'بحالة تشغيلية ممتازة',
      },
    ]);
    setFormError('');
    setIsEditorOpen(true);
  };

  // Open existing card for editing
  const handleEditCard = (card: CustodyRecord) => {
    setEditingCardId(card.id);
    setCardNumber(card.cardNumber || card.id);
    setFormNumber(card.formNumber || 'نموذج مستودع رقم (23)');
    setProvinceRegion(card.provinceRegion || 'المركز الرئيسي');
    setResponsibleName(card.responsibleName || card.employeeName || '');
    setRoleTitle(card.roleTitle || '');
    setDirectorate(card.directorate || '');
    setDepartment(card.department || '');
    setOfficeName(card.officeName || '');
    setOfficeRoom(card.officeRoom || '');
    setItDepartmentHead(card.itDepartmentHead || 'رئيس دائرة الاتصالات والمعلوماتية');
    setInventoryTechName(card.inventoryTechName || actorName);
    setGeneralNotes(card.notes || '');

    if (card.items && card.items.length > 0) {
      setCardItems(card.items);
    } else {
      setCardItems([
        {
          id: 'item-1',
          seq: 1,
          itemName: card.assetLabel || 'أصل تقني',
          itemDescription: card.notes || '',
          unit: 'جهاز',
          quantityNumber: 1,
          quantityText: 'واحد فقط',
          itemCode: card.assetId || '',
          cardCode: card.cardNumber || card.id,
          receiptDocNumber: '1/م',
          receiptDate: card.assignedAt ? new Date(card.assignedAt).toISOString().split('T')[0] : '',
          returnDocNumber: '',
          returnDate: '',
          balance: 1,
          notes: '',
        },
      ]);
    }
    setFormError('');
    setIsEditorOpen(true);
  };

  // Add a new row to the current card's items table
  const handleAddItemRow = () => {
    const nextSeq = cardItems.length + 1;
    setCardItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}-${nextSeq}`,
        seq: nextSeq,
        itemName: '',
        itemDescription: '',
        unit: 'جهاز',
        quantityNumber: 1,
        quantityText: 'واحد فقط',
        itemCode: '',
        cardCode: '',
        receiptDocNumber: '',
        receiptDate: new Date().toISOString().split('T')[0],
        returnDocNumber: '',
        returnDate: '',
        balance: 1,
        notes: '',
      },
    ]);
  };

  // Remove row
  const handleRemoveItemRow = (index: number) => {
    if (cardItems.length <= 1) return;
    setCardItems((prev) =>
      prev.filter((_, i) => i !== index).map((item, i) => ({ ...item, seq: i + 1 }))
    );
  };

  // Update specific field in item
  const handleUpdateItemField = (index: number, field: keyof CustodyItem, value: any) => {
    setCardItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  // Save Card to Firestore & Optionally Sync to Connected Google Sheet
  const handleSaveCard = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!canManageCustody) {
      setFormError('لا تملك صلاحية إدارة بطاقات العهد ضمن نطاقك الحالي.');
      return;
    }

    if (!responsibleName.trim()) {
      setFormError('يرجى إدخال الاسم الثلاثي للمسؤول عن العهدة.');
      return;
    }

    if (!officeName.trim()) {
      setFormError('يرجى إدخال اسم أو رقم المكتب.');
      return;
    }

    if (cardItems.some((i) => !i.itemName.trim())) {
      setFormError('يرجى كتابة اسم المادة لجميع البنود في الجدول.');
      return;
    }

    setFormLoading(true);
    setFormError('');

    try {
      await saveOfficialCustodyCard(
        {
          id: editingCardId || undefined,
          cardNumber,
          formNumber,
          provinceRegion,
          responsibleName: responsibleName.trim(),
          roleTitle: roleTitle.trim(),
          directorate: directorate.trim(),
          department: department.trim(),
          officeName: officeName.trim(),
          officeId: offices.find((office) => office.name === officeName)?.id || initialAssetForCustody?.officeId || '',
          warehouseId: offices.find((office) => office.name === officeName)?.warehouseId || initialAssetForCustody?.warehouseId || '',
          officeRoom: officeRoom.trim(),
          items: cardItems,
          itDepartmentHead: itDepartmentHead.trim(),
          inventoryTechName: inventoryTechName.trim(),
          responsibleSignatureName: responsibleName.trim(),
          notes: generalNotes.trim(),
        },
        actorUid,
        actorName,
        actorEmail
      );

      // Auto-sync with Google Sheet if linked
      try {
        const snap = await getDoc(doc(db, 'system_settings', 'google_sheets'));
        if (snap.exists() && snap.data()?.spreadsheetId) {
          const sheetInfo = snap.data() as GoogleSpreadsheetInfo;
          let token = googleAccessToken;
          if (!token) {
            token = await requestGoogleAccessToken();
          }
          if (token) {
            await syncDataToGoogleSheet(token, sheetInfo.spreadsheetId, assets, custodyCards);
            setSyncMessage('تم حفظ البطاقة وتحديث Google Sheets تلقائياً!');
          }
        }
      } catch (e) {
        console.warn('Silent sheet sync error:', e);
      }

      setIsEditorOpen(false);
      if (onClearInitialAsset) onClearInitialAsset();
      setFormSuccess('تم حفظ بطاقة العهدة الرسمية بنجاح.');
      setTimeout(() => setFormSuccess(''), 4000);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'تعذر حفظ بطاقة العهدة');
    } finally {
      setFormLoading(false);
    }
  };

  // Delete card handler
  const handleDeleteCard = async (cardId: string, name: string) => {
    if (!isPrimaryController) {
      alert('فقط المتحكم الأول بالحساب له صلاحية حذف البطاقات.');
      return;
    }
    if (window.confirm(`هل أنت متأكد من حذف بطاقة العهدة الخاصة بـ (${name})؟`)) {
      try {
        await deleteCustodyRecord(cardId);
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : 'تعذر حذف البطاقة');
      }
    }
  };

  // Quick Direct Sync to Google Sheets
  const handleQuickSheetSync = async () => {
    setSyncLoading(true);
    setSyncMessage('');
    try {
      const snap = await getDoc(doc(db, 'system_settings', 'google_sheets'));
      if (!snap.exists() || !snap.data()?.spreadsheetId) {
        alert('لم يتم ربط جدول Google Sheet بعد. يرجى الدخول إلى تبويب Google Sheets أولاً.');
        return;
      }
      const sheetInfo = snap.data() as GoogleSpreadsheetInfo;
      let token = googleAccessToken;
      if (!token) {
        token = await requestGoogleAccessToken();
      }
      if (!token) throw new Error('يرجى تسجيل الدخول بحساب Google');

      await syncDataToGoogleSheet(token, sheetInfo.spreadsheetId, assets, custodyCards);
      setSyncMessage('تمت مزامنة كافة بطاقات العهدة مع Google Sheets بنجاح!');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'تعذر المزامنة مع Google Sheets');
    } finally {
      setSyncLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Primary Controller Access Banner */}
      <div
        className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          isPrimaryController
            ? 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
            : 'bg-amber-50/80 border-amber-200 text-amber-900'
        }`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              isPrimaryController
                ? 'bg-emerald-200 text-emerald-800'
                : 'bg-amber-200 text-amber-800'
            }`}
          >
            {isPrimaryController ? <Shield className="w-5 h-5" /> : <Lock className="w-5 h-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-bold text-sm">
                {isPrimaryController
                  ? 'المتحكم المعتمد بالمنظومة والحساب المرتبط'
                  : 'وضع الاطلاع والبحث (Read-Only)'}
              </h4>
              <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-white/80 border">
                {user?.email || 'غير مسجل'}
              </span>
            </div>
            <p className="text-xs opacity-85 mt-0.5">
              {isPrimaryController
                ? 'أنت الشخص الوحيد المخول بإدخال وتعديل بطاقات العهدة، ويتم ربط ومزامنة البيانات تلقائياً مع Google Drive و Google Sheets.'
                : 'يمكنك استعراض وبحث وطباعة بطاقات العهدة. عمليات الإدخال والتعديل محصورة بالمتحكم الأول.'}
            </p>
          </div>
        </div>

        {isPrimaryController && (
          <button
            onClick={handleQuickSheetSync}
            disabled={syncLoading}
            className="flex items-center gap-2 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50 shrink-0"
          >
            <FileSpreadsheet className={`w-4 h-4 ${syncLoading ? 'animate-spin' : ''}`} />
            <span>{syncLoading ? 'جاري المزامنة...' : 'مزامنة مع Google Sheet'}</span>
          </button>
        )}
      </div>

      {syncMessage && (
        <div className="p-3 bg-emerald-100 border border-emerald-300 rounded-xl text-xs font-bold text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{syncMessage}</span>
        </div>
      )}

      {formSuccess && (
        <div className="p-3 bg-emerald-100 border border-emerald-300 rounded-xl text-xs font-bold text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{formSuccess}</span>
        </div>
      )}

      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black text-[#183B56]">
              بطاقة العهدة الشخصية - تجهيزات حاسوبية وملحقاتها
            </h2>
            <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-200 text-slate-700">
              نموذج مستودع رقم (23)
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            إدارة وتوثيق بطاقات العهدة وجداول التجهيزات مع مطابقة تامة للنموذج الورقي الرسمي
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Switch View Mode */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'table' ? 'bg-white text-[#183B56] shadow-xs' : 'text-slate-600'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>جدول المواد (مطابق للورقة)</span>
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'cards' ? 'bg-white text-[#183B56] shadow-xs' : 'text-slate-600'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>بطاقات العهدة ({custodyCards.length})</span>
            </button>
          </div>

          {/* Add New Card Button (Primary Controller Only) */}
          {canManageCustody ? (
            <button
              onClick={handleOpenNewCard}
              className="flex items-center gap-2 px-4 py-2.5 bg-[#183B56] hover:bg-[#122c42] text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إدخال بطاقة عهدة جديدة</span>
            </button>
          ) : (
            <button
              disabled
              title="لا تملك صلاحية إدارة بطاقات العهد ضمن نطاقك الحالي"
              className="flex items-center gap-2 px-4 py-2.5 bg-slate-300 text-slate-500 text-xs font-bold rounded-xl cursor-not-allowed opacity-75"
            >
              <Lock className="w-4 h-4" />
              <span>إدخال بطاقة (غير مصرح)</span>
            </button>
          )}
        </div>
      </div>

      {/* Advanced Filter Bar: Directorate / Department / Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs space-y-3 no-print">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
          {/* Search Box */}
          <div className="sm:col-span-5 relative">
            <Search className="w-4 h-4 absolute right-3.5 top-3 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث برقم المكتب، اسم المسؤول، اسم المادة، رمزها..."
              className="w-full pl-4 pr-10 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
            />
          </div>

          {/* Directorate Filter */}
          <div className="sm:col-span-3">
            <select
              value={selectedDirectorate}
              onChange={(e) => {
                setSelectedDirectorate(e.target.value);
                setSelectedDepartment('all');
              }}
              className="w-full py-2.5 px-3 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none font-semibold text-slate-700"
            >
              <option value="all">كافة المديريات (الكل)</option>
              {directorateOptions.map((dir) => (
                <option key={dir} value={dir}>
                  {dir}
                </option>
              ))}
            </select>
          </div>

          {/* Department Filter */}
          <div className="sm:col-span-3">
            <select
              value={selectedDepartment}
              onChange={(e) => setSelectedDepartment(e.target.value)}
              className="w-full py-2.5 px-3 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none font-semibold text-slate-700"
            >
              <option value="all">كافة الدوائر والأقسام (الكل)</option>
              {departmentOptions.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>

          {/* Reset Filters */}
          <div className="sm:col-span-1 flex justify-end">
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedDirectorate('all');
                setSelectedDepartment('all');
              }}
              title="إعادة تعيين الفلاتر"
              className="p-2.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl cursor-pointer"
            >
              <Filter className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Selected Directorate / Department Info Badge */}
        {(selectedDirectorate !== 'all' || selectedDepartment !== 'all') && (
          <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-100 text-xs">
            <span className="font-bold text-slate-500">معلومات الفلترة المحددة:</span>
            {selectedDirectorate !== 'all' && (
              <span className="px-2.5 py-1 rounded-lg bg-teal-50 text-[#168C8C] font-bold border border-teal-200">
                المديرية: {selectedDirectorate}
              </span>
            )}
            {selectedDepartment !== 'all' && (
              <span className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 font-bold border border-indigo-200">
                الدائرة: {selectedDepartment}
              </span>
            )}
            <span className="text-slate-500 font-bold mr-auto">
              المعروض: {flattenedItems.length} بند مادة مسجل
            </span>
          </div>
        )}
      </div>

      {/* VIEW MODE 1: Official Table Matching Photo */}
      {viewMode === 'table' && (
        <div className="bg-white rounded-2xl border border-slate-300 shadow-sm overflow-hidden no-print">
          <div className="p-4 bg-slate-50/90 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-black text-sm text-[#183B56]">
                جدول عهد المواد والتجهيزات (مخطط ومطابق لنموذج المستودع)
              </h3>
              <p className="text-xs text-slate-500">
                يظهر كل بند مادة مع تفاصيل المسؤول، المكتب، المذكرات، والرصيد
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500">
                إجمالي البنود: {flattenedItems.length}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 border-b border-slate-300 font-bold">
                  <th rowSpan={2} className="p-2 border-l border-slate-300 text-center w-10">
                    م
                  </th>
                  <th colSpan={7} className="p-2 border-l border-slate-300 text-center bg-teal-50/60">
                    المـــــــــــــادة
                  </th>
                  <th colSpan={2} className="p-2 border-l border-slate-300 text-center bg-blue-50/60">
                    استلام العهدة
                  </th>
                  <th colSpan={2} className="p-2 border-l border-slate-300 text-center bg-amber-50/60">
                    إعادة العهدة
                  </th>
                  <th rowSpan={2} className="p-2 border-l border-slate-300 text-center w-14">
                    الرصيد
                  </th>
                  <th rowSpan={2} className="p-2 border-l border-slate-300 text-center">
                    المسؤول والمكتب
                  </th>
                  <th rowSpan={2} className="p-2 border-l border-slate-300 text-center">
                    ملاحظات
                  </th>
                  <th rowSpan={2} className="p-2 text-center w-24">
                    إجراءات
                  </th>
                </tr>
                <tr className="bg-slate-50 text-[11px] text-slate-600 border-b border-slate-300 font-bold">
                  <th className="p-2 border-l border-slate-300">اسمها</th>
                  <th className="p-2 border-l border-slate-300">أوصافها</th>
                  <th className="p-2 border-l border-slate-300 text-center w-14">وحدتها</th>
                  <th className="p-2 border-l border-slate-300 text-center w-12">رقماً</th>
                  <th className="p-2 border-l border-slate-300 text-center w-18">كتابة</th>
                  <th className="p-2 border-l border-slate-300 text-center">رمزها</th>
                  <th className="p-2 border-l border-slate-300 text-center">بطاقتها</th>
                  <th className="p-2 border-l border-slate-300 text-center">المذكرة</th>
                  <th className="p-2 border-l border-slate-300 text-center">تاريخها</th>
                  <th className="p-2 border-l border-slate-300 text-center">المذكرة</th>
                  <th className="p-2 border-l border-slate-300 text-center">تاريخها</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {flattenedItems.length === 0 ? (
                  <tr>
                    <td colSpan={17} className="py-12 text-center text-slate-400">
                      لا توجد مواد أو بطاقات مطابقة لخيارات البحث
                    </td>
                  </tr>
                ) : (
                  flattenedItems.map(({ card, item, uniqueKey }, index) => (
                    <tr key={uniqueKey} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-2 border-l border-slate-200 text-center font-bold text-slate-500">
                        {item.seq || index + 1}
                      </td>
                      <td className="p-2 border-l border-slate-200 font-bold text-[#183B56] whitespace-nowrap">
                        {item.itemName}
                      </td>
                      <td className="p-2 border-l border-slate-200 text-slate-600 max-w-xs truncate">
                        {item.itemDescription || '—'}
                      </td>
                      <td className="p-2 border-l border-slate-200 text-center text-slate-700">
                        {item.unit || 'جهاز'}
                      </td>
                      <td className="p-2 border-l border-slate-200 text-center font-bold text-[#183B56]">
                        {item.quantityNumber ?? 1}
                      </td>
                      <td className="p-2 border-l border-slate-200 text-center text-[11px] text-slate-600">
                        {item.quantityText || 'واحد فقط'}
                      </td>
                      <td className="p-2 border-l border-slate-200 text-center font-mono text-[11px] text-slate-800">
                        {item.itemCode || '—'}
                      </td>
                      <td className="p-2 border-l border-slate-200 text-center font-mono text-[11px] text-teal-800">
                        {item.cardCode || card.cardNumber || '—'}
                      </td>
                      <td className="p-2 border-l border-slate-200 text-center text-slate-700">
                        {item.receiptDocNumber || '—'}
                      </td>
                      <td className="p-2 border-l border-slate-200 text-center text-[11px] text-slate-500 whitespace-nowrap">
                        {item.receiptDate || (card.assignedAt ? new Date(card.assignedAt).toLocaleDateString('ar-EG') : '—')}
                      </td>
                      <td className="p-2 border-l border-slate-200 text-center text-slate-500">
                        {item.returnDocNumber || '—'}
                      </td>
                      <td className="p-2 border-l border-slate-200 text-center text-[11px] text-slate-500 whitespace-nowrap">
                        {item.returnDate || '—'}
                      </td>
                      <td className="p-2 border-l border-slate-200 text-center font-black text-emerald-700">
                        {item.balance ?? 1}
                      </td>
                      <td className="p-2 border-l border-slate-200">
                        <div className="font-bold text-[#183B56]">
                          {card.responsibleName || card.employeeName}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {card.officeName} {card.officeRoom ? `(مكتب ${card.officeRoom})` : ''}
                        </div>
                      </td>
                      <td className="p-2 border-l border-slate-200 text-slate-500 max-w-xs truncate">
                        {item.notes || card.notes || '—'}
                      </td>
                      <td className="p-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setPrintableCard(card)}
                            title="طباعة وتصدير البطاقة الرسمية"
                            className="p-1.5 text-slate-600 hover:text-[#183B56] hover:bg-slate-100 rounded-lg cursor-pointer"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>
                          {canManageCustody && (
                            <button
                              onClick={() => handleEditCard(card)}
                              title="تعديل البطاقة"
                              className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg cursor-pointer"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isPrimaryController && (
                            <button
                              onClick={() => handleDeleteCard(card.id, card.responsibleName || card.employeeName)}
                              title="حذف البطاقة"
                              className="p-1.5 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW MODE 2: Cards Overview Grid */}
      {viewMode === 'cards' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 no-print">
          {custodyCards.map((card) => {
            const itemCount = card.items ? card.items.length : 1;
            return (
              <div
                key={card.id}
                className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs hover:border-[#183B56]/40 transition-all space-y-3 relative group"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                      {card.cardNumber || card.id}
                    </span>
                    <h3 className="font-bold text-base text-[#183B56] mt-1">
                      {card.responsibleName || card.employeeName}
                    </h3>
                    <p className="text-xs text-slate-500">{card.roleTitle || 'مسؤول عهدة'}</p>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPrintableCard(card)}
                      title="طباعة البطاقة الرسمية"
                      className="p-1.5 text-slate-400 hover:text-[#183B56] hover:bg-slate-100 rounded-lg cursor-pointer"
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                    {canManageCustody && (
                      <button
                        onClick={() => handleEditCard(card)}
                        title="تعديل"
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg cursor-pointer"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Location Box */}
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-xs space-y-1">
                  <div className="flex items-center justify-between text-slate-600">
                    <span className="font-semibold">المديرية:</span>
                    <span>{card.directorate || 'غير محدد'}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span className="font-semibold">الدائرة:</span>
                    <span>{card.department || 'غير محدد'}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span className="font-semibold">المكتب:</span>
                    <span className="font-bold text-[#183B56]">{card.officeName}</span>
                  </div>
                </div>

                {/* Items Summary */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-semibold">عدد التجهيزات المقيدة:</span>
                  <span className="font-black text-[#168C8C]">{itemCount} مادة</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CARD EDITOR MODAL (Full fields matching paper form) */}
      {isEditorOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto no-print">
          <div className="bg-white rounded-3xl max-w-4xl w-full p-6 sm:p-8 shadow-2xl relative my-8">
            <button
              onClick={() => {
                setIsEditorOpen(false);
                if (onClearInitialAsset) onClearInitialAsset();
              }}
              className="absolute left-6 top-6 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-6 h-6" />
            </button>

            {/* Modal Header */}
            <div className="border-b border-slate-100 pb-4 mb-6">
              <span className="text-xs font-bold text-[#168C8C]">
                {editingCardId ? 'تعديل بطاقة موجودة' : 'إدخال بطاقة جديدة'}
              </span>
              <h3 className="text-xl font-black text-[#183B56]">
                بطاقة العهدة الشخصية - تجهيزات حاسوبية وملحقاتها (نموذج مستودع)
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                تعبئة بيانات المسؤول عن العهدة ومركز عمله وبنود المواد المستلمة والمعادة
              </p>
            </div>

            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSaveCard} className="space-y-6 text-xs font-medium">
              {/* Section 1: Official Header & Responsible Info */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-4">
                <h4 className="font-black text-[#183B56] text-sm">
                  1. بيانات ترويسة البطاقة والمسؤول
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      الاسم الثلاثي للمسؤول *
                    </label>
                    <input
                      type="text"
                      value={responsibleName}
                      onChange={(e) => setResponsibleName(e.target.value)}
                      placeholder="مثال: م. أحمد محمد خليل"
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">صفته الوظيفية *</label>
                    <input
                      type="text"
                      value={roleTitle}
                      onChange={(e) => setRoleTitle(e.target.value)}
                      placeholder="مثال: مهندس شبكات / رئيس قسم"
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">رقم بطاقة العهدة</label>
                    <input
                      type="text"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      placeholder="CR-00234"
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">المديرية *</label>
                    <input
                      type="text"
                      value={directorate}
                      onChange={(e) => setDirectorate(e.target.value)}
                      placeholder="مثال: مديرية المعلوماتية"
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">الدائرة *</label>
                    <input
                      type="text"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      placeholder="مثال: دائرة الاتصالات"
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      المكتب / رقم المكتب *
                    </label>
                    <input
                      type="text"
                      value={officeName}
                      onChange={(e) => setOfficeName(e.target.value)}
                      placeholder="مثال: مكتب الإدارة العامة - غرفة 204"
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: Items Table (As in the photo) */}
              <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div>
                    <h4 className="font-black text-[#183B56] text-sm">
                      2. جدول المواد والتجهيزات المقيدة في البطاقة
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      يمكنك تسجيل سطر لكل مادة أو جهاز كما في النموذج الورقي
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddItemRow}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#168C8C] hover:bg-[#137676] text-white text-xs font-bold rounded-xl cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>إضافة مادة للجدول</span>
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs border border-slate-200">
                    <thead className="bg-slate-100 text-slate-700 font-bold">
                      <tr>
                        <th className="p-2 border border-slate-200 text-center w-8">م</th>
                        <th className="p-2 border border-slate-200 min-w-[140px]">اسم المادة *</th>
                        <th className="p-2 border border-slate-200 min-w-[140px]">أوصافها</th>
                        <th className="p-2 border border-slate-200 w-16">الوحدة</th>
                        <th className="p-2 border border-slate-200 w-14">رقماً</th>
                        <th className="p-2 border border-slate-200 w-20">كتابة</th>
                        <th className="p-2 border border-slate-200 w-24">رمزها (S/N)</th>
                        <th className="p-2 border border-slate-200 w-20">بطاقتها</th>
                        <th className="p-2 border border-slate-200 w-24">استلام (مذكرة)</th>
                        <th className="p-2 border border-slate-200 w-24">تاريخ الاستلام</th>
                        <th className="p-2 border border-slate-200 w-14 text-center">الرصيد</th>
                        <th className="p-2 border border-slate-200 w-10 text-center">حذف</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {cardItems.map((item, index) => (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="p-2 border border-slate-200 text-center font-bold text-slate-500">
                            {index + 1}
                          </td>
                          <td className="p-1 border border-slate-200">
                            <input
                              type="text"
                              value={item.itemName}
                              onChange={(e) =>
                                handleUpdateItemField(index, 'itemName', e.target.value)
                              }
                              placeholder="اسم الجهاز أو المادة"
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                              required
                            />
                          </td>
                          <td className="p-1 border border-slate-200">
                            <input
                              type="text"
                              value={item.itemDescription || ''}
                              onChange={(e) =>
                                handleUpdateItemField(index, 'itemDescription', e.target.value)
                              }
                              placeholder="المواصفات"
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                            />
                          </td>
                          <td className="p-1 border border-slate-200">
                            <input
                              type="text"
                              value={item.unit || 'جهاز'}
                              onChange={(e) =>
                                handleUpdateItemField(index, 'unit', e.target.value)
                              }
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-center"
                            />
                          </td>
                          <td className="p-1 border border-slate-200">
                            <input
                              type="number"
                              min={1}
                              value={item.quantityNumber}
                              onChange={(e) =>
                                handleUpdateItemField(
                                  index,
                                  'quantityNumber',
                                  parseInt(e.target.value) || 1
                                )
                              }
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-center font-bold"
                            />
                          </td>
                          <td className="p-1 border border-slate-200">
                            <input
                              type="text"
                              value={item.quantityText || ''}
                              onChange={(e) =>
                                handleUpdateItemField(index, 'quantityText', e.target.value)
                              }
                              placeholder="واحد فقط"
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-center"
                            />
                          </td>
                          <td className="p-1 border border-slate-200">
                            <input
                              type="text"
                              value={item.itemCode || ''}
                              onChange={(e) =>
                                handleUpdateItemField(index, 'itemCode', e.target.value)
                              }
                              placeholder="الرقم التسلسلي"
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono"
                            />
                          </td>
                          <td className="p-1 border border-slate-200">
                            <input
                              type="text"
                              value={item.cardCode || ''}
                              onChange={(e) =>
                                handleUpdateItemField(index, 'cardCode', e.target.value)
                              }
                              placeholder="كود"
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono"
                            />
                          </td>
                          <td className="p-1 border border-slate-200">
                            <input
                              type="text"
                              value={item.receiptDocNumber || ''}
                              onChange={(e) =>
                                handleUpdateItemField(index, 'receiptDocNumber', e.target.value)
                              }
                              placeholder="رقم المذكرة"
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                            />
                          </td>
                          <td className="p-1 border border-slate-200">
                            <input
                              type="date"
                              value={item.receiptDate || ''}
                              onChange={(e) =>
                                handleUpdateItemField(index, 'receiptDate', e.target.value)
                              }
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                            />
                          </td>
                          <td className="p-1 border border-slate-200">
                            <input
                              type="number"
                              value={item.balance}
                              onChange={(e) =>
                                handleUpdateItemField(
                                  index,
                                  'balance',
                                  parseInt(e.target.value) || 0
                                )
                              }
                              className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-center font-bold text-emerald-700"
                            />
                          </td>
                          <td className="p-1 border border-slate-200 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveItemRow(index)}
                              disabled={cardItems.length <= 1}
                              className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer disabled:opacity-30"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Section 3: Signatures & Bottom Notes */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-4">
                <h4 className="font-black text-[#183B56] text-sm">
                  3. التواقيع والاعتماد (أسفل البطاقة)
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      رئيس دائرة الاتصالات والمعلوماتية
                    </label>
                    <input
                      type="text"
                      value={itDepartmentHead}
                      onChange={(e) => setItDepartmentHead(e.target.value)}
                      placeholder="اسم رئيس الدائرة"
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      اسم وتوقيع الفني القائم بالجرد
                    </label>
                    <input
                      type="text"
                      value={inventoryTechName}
                      onChange={(e) => setInventoryTechName(e.target.value)}
                      placeholder="اسم الفني المسؤول"
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">ملاحظات عامة</label>
                  <textarea
                    value={generalNotes}
                    onChange={(e) => setGeneralNotes(e.target.value)}
                    placeholder="أي ملاحظات تتعلق بحالة العهدة وموقع تسليمها..."
                    className="w-full p-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none h-16 text-xs"
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditorOpen(false);
                    if (onClearInitialAsset) onClearInitialAsset();
                  }}
                  className="px-5 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="px-6 py-2.5 bg-[#183B56] hover:bg-[#122c42] text-white font-bold rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  <FileCheck2 className="w-4 h-4" />
                  <span>{formLoading ? 'جاري الحفظ والمزامنة...' : 'حفظ بطاقة العهدة الرسمية'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PRINTABLE OFFICIAL WAREHOUSE CUSTODY CARD (EXACT REPLICA OF THE ATTACHED PHOTO) */}
      {printableCard && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-5xl w-full p-4 sm:p-8 shadow-2xl relative my-6">
            {/* Action Bar */}
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200 no-print">
              <div>
                <h3 className="font-black text-base text-[#183B56]">
                  معاينة وتصدير بطاقة العهدة الرسمية
                </h3>
                <p className="text-xs text-slate-500">
                  تصميم مطابق بنسبة 100% لنموذج المستودع الورقي رقم (23)
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-2 px-4 py-2 bg-[#183B56] hover:bg-[#122c42] text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>طباعة البطاقة الرسمية (A4)</span>
                </button>
                <button
                  onClick={() => setPrintableCard(null)}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Official Paper Replica Box */}
            <div
              id="official-print-paper"
              className="p-6 sm:p-8 border-2 border-black rounded-lg text-black bg-white font-['Cairo',sans-serif] text-xs leading-relaxed"
            >
              {/* Top Official Banner */}
              <div className="flex items-start justify-between border-b-2 border-black pb-4">
                <div className="text-right">
                  <h4 className="font-bold text-sm">الجمهورية العربية السورية</h4>
                  <p className="text-xs">وزارة الاتصالات والتقانة</p>
                  <p className="text-xs">الشركة السورية للاتصالات</p>
                </div>

                <div className="text-center">
                  <h2 className="text-base sm:text-lg font-black tracking-wide border-2 border-black px-4 py-1 inline-block">
                    بطاقـــــة العهـــدة الشخصيــة - تجهيزات حاسوبية وملحقاتها
                  </h2>
                  <p className="text-[11px] font-bold mt-1">
                    {printableCard.formNumber || 'نموذج مستودع رقم (23)'}
                  </p>
                </div>

                <div className="text-left font-mono text-xs">
                  <p className="font-bold">
                    رقم البطاقة: {printableCard.cardNumber || printableCard.id}
                  </p>
                  <p className="text-[11px]">
                    المحافظة / الرمز: {printableCard.provinceRegion || 'المركز الرئيسي'}
                  </p>
                </div>
              </div>

              {/* Responsible Info Header Box (Exact photo structure) */}
              <div className="my-4 border border-black text-xs">
                <div className="grid grid-cols-12 border-b border-black">
                  <div className="col-span-2 p-2 font-bold bg-slate-100 border-l border-black">
                    مركز عمله:
                  </div>
                  <div className="col-span-10 grid grid-cols-3">
                    <div className="p-2 border-l border-black">
                      <span className="font-bold">المديرية: </span>
                      <span>{printableCard.directorate || 'مديرية تقنية المعلومات'}</span>
                    </div>
                    <div className="p-2 border-l border-black">
                      <span className="font-bold">الدائرة: </span>
                      <span>{printableCard.department || 'دائرة الاتصالات'}</span>
                    </div>
                    <div className="p-2">
                      <span className="font-bold">المكتب: </span>
                      <span>
                        {printableCard.officeName}{' '}
                        {printableCard.officeRoom ? `(غرفة ${printableCard.officeRoom})` : ''}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-12">
                  <div className="col-span-2 p-2 font-bold bg-slate-100 border-l border-black">
                    المسؤول عن العهدة:
                  </div>
                  <div className="col-span-6 p-2 border-l border-black">
                    <span className="font-bold">الاسم الثلاثي: </span>
                    <span className="font-black text-sm">
                      {printableCard.responsibleName || printableCard.employeeName}
                    </span>
                  </div>
                  <div className="col-span-4 p-2">
                    <span className="font-bold">صفته: </span>
                    <span>{printableCard.roleTitle || 'مسؤول عهدة'}</span>
                  </div>
                </div>
              </div>

              {/* Official Table Grid (Identical Columns to Photo) */}
              <div className="overflow-x-auto my-4 border border-black">
                <table className="w-full text-right text-[11px] border-collapse">
                  <thead>
                    <tr className="border-b border-black font-bold bg-slate-100">
                      <th rowSpan={2} className="p-1.5 border-l border-black text-center w-8">
                        مسلسل
                      </th>
                      <th colSpan={7} className="p-1.5 border-l border-black text-center">
                        المـــــــــــــــــــــــــــــــــادة
                      </th>
                      <th colSpan={2} className="p-1.5 border-l border-black text-center">
                        استلام العهدة
                      </th>
                      <th colSpan={2} className="p-1.5 border-l border-black text-center">
                        إعادة العهدة
                      </th>
                      <th rowSpan={2} className="p-1.5 border-l border-black text-center w-12">
                        الرصيد
                      </th>
                      <th rowSpan={2} className="p-1.5 text-center">
                        ملاحظات
                      </th>
                    </tr>
                    <tr className="border-b border-black font-bold text-[10px] bg-slate-50">
                      <th className="p-1 border-l border-black text-center">اسمها</th>
                      <th className="p-1 border-l border-black text-center">أوصافها</th>
                      <th className="p-1 border-l border-black text-center w-12">وحدتها</th>
                      <th className="p-1 border-l border-black text-center w-10">رقماً</th>
                      <th className="p-1 border-l border-black text-center w-16">كتابة</th>
                      <th className="p-1 border-l border-black text-center">رمزها</th>
                      <th className="p-1 border-l border-black text-center">بطاقتها</th>
                      <th className="p-1 border-l border-black text-center">المذكرة</th>
                      <th className="p-1 border-l border-black text-center">تاريخها</th>
                      <th className="p-1 border-l border-black text-center">المذكرة</th>
                      <th className="p-1 border-l border-black text-center">تاريخها</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Render up to 10 rows for clean official paper look */}
                    {Array.from({
                      length: Math.max(10, printableCard.items?.length || 1),
                    }).map((_, idx) => {
                      const it = printableCard.items?.[idx];
                      return (
                        <tr key={idx} className="border-b border-black/80 h-7 text-[10px]">
                          <td className="p-1 border-l border-black text-center font-bold">
                            {idx + 1}
                          </td>
                          <td className="p-1 border-l border-black font-bold">
                            {it?.itemName || (idx === 0 && !printableCard.items ? printableCard.assetLabel : '')}
                          </td>
                          <td className="p-1 border-l border-black">
                            {it?.itemDescription || ''}
                          </td>
                          <td className="p-1 border-l border-black text-center">
                            {it?.unit || (idx === 0 ? 'جهاز' : '')}
                          </td>
                          <td className="p-1 border-l border-black text-center font-bold">
                            {it?.quantityNumber ?? (idx === 0 ? 1 : '')}
                          </td>
                          <td className="p-1 border-l border-black text-center">
                            {it?.quantityText || (idx === 0 ? 'واحد فقط' : '')}
                          </td>
                          <td className="p-1 border-l border-black text-center font-mono">
                            {it?.itemCode || (idx === 0 ? printableCard.assetId : '')}
                          </td>
                          <td className="p-1 border-l border-black text-center font-mono">
                            {it?.cardCode || (idx === 0 ? printableCard.cardNumber : '')}
                          </td>
                          <td className="p-1 border-l border-black text-center">
                            {it?.receiptDocNumber || ''}
                          </td>
                          <td className="p-1 border-l border-black text-center">
                            {it?.receiptDate ||
                              (idx === 0 && printableCard.assignedAt
                                ? new Date(printableCard.assignedAt).toLocaleDateString('ar-EG')
                                : '')}
                          </td>
                          <td className="p-1 border-l border-black text-center">
                            {it?.returnDocNumber || ''}
                          </td>
                          <td className="p-1 border-l border-black text-center">
                            {it?.returnDate || ''}
                          </td>
                          <td className="p-1 border-l border-black text-center font-black">
                            {it?.balance ?? (idx === 0 ? 1 : '')}
                          </td>
                          <td className="p-1">
                            {it?.notes || (idx === 0 ? printableCard.notes : '')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Bottom 3 Signature Blocks (Exact photo alignment) */}
              <div className="grid grid-cols-3 gap-8 pt-8 mt-6 border-t-2 border-black text-center font-bold">
                <div>
                  <p className="text-xs">رئيس دائرة الاتصالات والمعلوماتية</p>
                  <p className="mt-8 text-[11px] text-slate-700">
                    {printableCard.itDepartmentHead || 'الاسم والتوقيع: ............................'}
                  </p>
                </div>

                <div>
                  <p className="text-xs">اسم وتوقيع الفني القائم بالجرد</p>
                  <p className="mt-8 text-[11px] text-slate-700">
                    {printableCard.inventoryTechName || 'الاسم والتوقيع: ............................'}
                  </p>
                </div>

                <div>
                  <p className="text-xs">الاسم وتوقيع المسؤول عن العهدة</p>
                  <p className="mt-8 text-[11px] text-slate-700">
                    {printableCard.responsibleSignatureName ||
                      printableCard.responsibleName ||
                      'الاسم والتوقيع: ............................'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
