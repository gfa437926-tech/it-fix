export type AssetCategory =
  | 'desktop'
  | 'laptop'
  | 'monitor'
  | 'printer'
  | 'scanner'
  | 'network'
  | 'storage'
  | 'ups'
  | 'accessory'
  | 'other';

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  desktop: 'كمبيوتر مكتبي',
  laptop: 'لابتوب',
  monitor: 'شاشة',
  printer: 'طابعة',
  scanner: 'ماسح ضوئي',
  network: 'معدات شبكة',
  storage: 'وحدة تخزين',
  ups: 'وحدة طاقة UPS',
  accessory: 'ملحق',
  other: 'أخرى',
};

export type AssetStatus =
  | 'available'
  | 'assigned'
  | 'maintenance'
  | 'damaged'
  | 'retired'
  | 'returned';

export const ASSET_STATUS_LABELS: Record<AssetStatus, { label: string; color: string; bg: string }> = {
  available: { label: 'متوفر', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  assigned: { label: 'موزع في عهدة', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  maintenance: { label: 'قيد الصيانة', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  damaged: { label: 'تالف', color: 'text-rose-700', bg: 'bg-rose-50 border-rose-200' },
  retired: { label: 'مستبعد', color: 'text-slate-600', bg: 'bg-slate-100 border-slate-300' },
  returned: { label: 'معاد للمستودع', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
};

export interface Asset {
  id: string;
  category: AssetCategory;
  brand: string;
  model: string;
  serialNumber: string;
  status: AssetStatus;
  cpu?: string;
  ram?: string;
  storage?: string;
  officeId?: string;
  officeName?: string;
  warehouseId?: string;
  warehouseName?: string;
  receivedAt?: string;
  retiredAt?: string;
  retirementReason?: string;
  transferredAt?: string;
}

export interface Office {
  id: string;
  name: string;
  building?: string;
  directorate?: string;
  department?: string;
  warehouseId?: string;
  room?: string;
  manager?: string;
  phone?: string;
  notes?: string;
  isActive: boolean;
}

export type CustodyStatus = 'active' | 'returned' | 'rejected';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface CustodyItem {
  id: string;
  seq: number; // مسلسل
  itemName: string; // اسمها
  itemDescription?: string; // أوصافها
  unit?: string; // وحدتها (عدد، قطعة، جهاز)
  quantityNumber: number; // رقماً
  quantityText?: string; // كتابة
  itemCode?: string; // رمزها (السيريال أو الكود)
  cardCode?: string; // بطاقتها
  receiptDocNumber?: string; // استلام العهدة - رقم المذكرة
  receiptDate?: string; // استلام العهدة - تاريخها
  returnDocNumber?: string; // إعادة العهدة - رقم المذكرة
  returnDate?: string; // إعادة العهدة - تاريخها
  balance: number; // الرصيد
  notes?: string; // ملاحظات
  assetId?: string; // ربط اختياري مع أصل في المستودع
}

export interface CustodyRecord {
  id: string;
  cardNumber?: string; // رقم بطاقة العهدة
  formNumber?: string; // نموذج مستودع رقم (23)
  provinceRegion?: string; // المحافظة / الرمز أو المنطقة

  // بيانات المسؤول عن العهدة ومركز عمله
  responsibleName?: string; // الاسم الثلاثي للمسؤول
  roleTitle?: string; // صفته
  directorate?: string; // المديرية
  department?: string; // الدائرة
  officeName: string; // المكتب أو اسم المكتب
  officeId?: string;
  warehouseId?: string;
  officeRoom?: string; // رقم المكتب / الغرفة

  // قائمة المواد التابعة للبطاقة (مطابقة لجدول الورقة الرسمية)
  items?: CustodyItem[];

  // حقول التوافق مع العهد الفردية
  assetId?: string;
  assetLabel?: string;
  employeeName: string; // متطابق مع responsibleName
  assignedAt: string;
  status: CustodyStatus;
  approvalStatus: ApprovalStatus;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  returnedAt?: string;
  transferredAt?: string;
  notes?: string;

  // توقيعات أسفل البطاقة
  itDepartmentHead?: string; // رئيس دائرة الاتصالات / المعلوماتية
  inventoryTechName?: string; // اسم وتوقيع الفني القائم بالجرد
  responsibleSignatureName?: string; // الاسم وتوقيع المسؤول عن العهدة

  // ربط المستخدم المنشئ للتحكم بالبيانات
  createdByUid?: string;
  createdByEmail?: string;
}

export type MaintenancePriority = 'low' | 'normal' | 'high' | 'urgent';
export const MAINTENANCE_PRIORITY_LABELS: Record<MaintenancePriority, { label: string; color: string }> = {
  low: { label: 'منخفضة', color: 'text-slate-600 bg-slate-100' },
  normal: { label: 'عادية', color: 'text-blue-700 bg-blue-100' },
  high: { label: 'عالية', color: 'text-amber-700 bg-amber-100' },
  urgent: { label: 'حرجة / عاجلة', color: 'text-rose-700 bg-rose-100' },
};

export type MaintenanceStatus = 'open' | 'inProgress' | 'completed' | 'cancelled';
export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, { label: string; color: string; bg: string }> = {
  open: { label: 'مفتوحة', color: 'text-amber-800', bg: 'bg-amber-50 border-amber-200' },
  inProgress: { label: 'قيد التنفيذ', color: 'text-blue-800', bg: 'bg-blue-50 border-blue-200' },
  completed: { label: 'مكتملة', color: 'text-emerald-800', bg: 'bg-emerald-50 border-emerald-200' },
  cancelled: { label: 'ملغاة', color: 'text-slate-600', bg: 'bg-slate-100 border-slate-300' },
};

export interface MaintenanceRecord {
  id: string;
  assetId: string;
  assetLabel: string;
  title: string;
  description: string;
  priority: MaintenancePriority;
  officeId?: string;
  warehouseId?: string;
  status: MaintenanceStatus;
  reportedAt: string;
  technician?: string;
  cost?: number;
  partsCost?: number;
  resolution?: string;
  previousAssetStatus?: string;
  completedAt?: string;
}

export interface SparePart {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  minimumQuantity: number;
  unitCost: number;
  supplier: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MaintenancePartUsage {
  id: string;
  partId: string;
  partName: string;
  maintenanceId: string;
  assetId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  notes?: string;
  usedAt: string;
}

export interface PurchaseRecord {
  id: string;
  assetId: string;
  assetLabel: string;
  supplier: string;
  invoiceNumber: string;
  purchaseDate: string;
  warrantyUntil?: string;
  totalCost: number;
  notes?: string;
  createdAt?: string;
}

export type MovementType =
  | 'created'
  | 'assigned'
  | 'returned'
  | 'transferred'
  | 'custody_transferred'
  | 'custody_approved'
  | 'custody_rejected'
  | 'retired'
  | 'maintenance_opened'
  | 'maintenance_completed'
  | 'purchase_registered';

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  created: 'إضافة أصل إلى المخزون',
  assigned: 'تسليم عهدة جديدة',
  returned: 'إرجاع جهاز للمستودع',
  transferred: 'نقل جهاز بين المكاتب',
  custody_transferred: 'نقل عهدة لموظف آخر',
  custody_approved: 'اعتماد بطاقة عهدة',
  custody_rejected: 'رفض طلب عهدة',
  retired: 'استبعاد وإتلاف أصل',
  maintenance_opened: 'إرسال جهاز للصيانة',
  maintenance_completed: 'إكمال صيانة واستلام جهاز',
  purchase_registered: 'تسجيل فاتورة شراء جديدة',
};

export interface AssetMovement {
  id: string;
  assetId: string;
  officeId?: string;
  warehouseId?: string;
  assetLabel: string;
  movementType: string;
  occurredAt: string;
  fromEmployee?: string;
  toEmployee?: string;
  fromOffice?: string;
  toOffice?: string;
  fromOfficeId?: string;
  toOfficeId?: string;
  fromOfficeName?: string;
  toOfficeName?: string;
  custodyId?: string;
  maintenanceId?: string;
  purchaseId?: string;
  notes?: string;
  cost?: number;
}

export type DocumentType = 'invoice' | 'warranty' | 'handover' | 'maintenance' | 'photo' | 'other';
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: 'فاتورة شراء',
  warranty: 'شهادة ضمان',
  handover: 'نموذج تسليم / عهدة',
  maintenance: 'تقرير صيانة',
  photo: 'صورة الأصل',
  other: 'مستند آخر',
};

export interface AssetDocument {
  id: string;
  assetId: string;
  purchaseRecordId?: string;
  fileName: string;
  documentType: DocumentType;
  storagePath: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
  downloadUrl?: string;
}

export interface ImportBatch {
  id: string;
  sourceName: string;
  createdBy: string;
  createdAt: string;
  completedAt: string;
  totalRows: number;
  attemptedRows: number;
  succeededRows: number;
  failedRows: number;
  skippedInvalidRows: number;
  status: 'completed' | 'partial' | 'failed';
  rowErrors: string[];
}

export type UserPermission =
  | 'assets.read' | 'assets.create' | 'assets.update' | 'assets.delete'
  | 'offices.read' | 'offices.manage'
  | 'warehouses.read' | 'warehouses.manage'
  | 'custody.read' | 'custody.manage'
  | 'maintenance.read' | 'maintenance.manage'
  | 'reports.read' | 'users.manage';

export interface Warehouse {
  id: string;
  name: string;
  code?: string;
  officeIds?: string[];
  isActive: boolean;
  notes?: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: 'admin' | 'it_manager';
  isActive: boolean;
  // When enabled, Firestore rules require explicit permissions and assigned scope.
  accessControlEnabled?: boolean;
  permissions?: Partial<Record<UserPermission, boolean>>;
  officeIds?: string[];
  warehouseIds?: string[];
  createdAt: string;
  updatedAt?: string;
}
