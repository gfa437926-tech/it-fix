import React, { useState, useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  db,
  testFirestoreConnection,
} from './firebase';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { Sidebar, NavTab } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { AssetsView } from './components/AssetsView';
import { CustodyView } from './components/CustodyView';
import { GoogleSheetsView } from './components/GoogleSheetsView';
import { MaintenanceView } from './components/MaintenanceView';
import { ServiceHistoryView } from './components/ServiceHistoryView';
import { SparePartsView } from './components/SparePartsView';
import { AssetMovementsView } from './components/AssetMovementsView';
import { AssetDocumentsView } from './components/AssetDocumentsView';
import { AssetImportView } from './components/AssetImportView';
import { ReportsView } from './components/ReportsView';
import { OfficesView } from './components/OfficesView';
import { UserManagementView } from './components/UserManagementView';
import { AuthView } from './components/AuthView';
import {
  Asset,
  Office,
  CustodyRecord,
  MaintenanceRecord,
  SparePart,
  AssetMovement,
  Warehouse,
} from './types';
import { watchAssets } from './services/assetService';
import { watchOffices, saveOffice } from './services/officeService';
import { watchWarehouses } from './services/warehouseService';
import { watchCustodyCards, saveOfficialCustodyCard } from './services/custodyService';
import { watchMaintenanceRecords } from './services/maintenanceService';
import { watchSpareParts, addSparePart } from './services/sparePartsService';
import { watchAssetMovements } from './services/movementService';
import { ShieldAlert, LogOut, HardDrive, Loader2 } from 'lucide-react';

function MainApp() {
  const { user, profile, loading: authLoading, signOut } = useAuth();

  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');

  // Native Android back navigation: return to the dashboard before exiting.
  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

    let active = true;
    let removeListener: (() => Promise<void>) | undefined;

    void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (currentTab !== 'dashboard') {
        setCurrentTab('dashboard');
      } else if (canGoBack) {
        window.history.back();
      } else {
        void CapacitorApp.exitApp();
      }
    }).then((listener) => {
      if (active) removeListener = () => listener.remove();
      else void listener.remove();
    });

    return () => {
      active = false;
      if (removeListener) void removeListener();
    };
  }, [currentTab]);

  // Real-time collections
  const [assets, setAssets] = useState<Asset[]>([]);
  const [offices, setOffices] = useState<Office[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [custodyCards, setCustodyCards] = useState<CustodyRecord[]>([]);
  const [maintenanceRecords, setMaintenanceRecords] = useState<MaintenanceRecord[]>([]);
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [movements, setMovements] = useState<AssetMovement[]>([]);
  const [hasGoogleSheetConnected, setHasGoogleSheetConnected] = useState(false);

  // Cross-view trigger state
  const [assetForCustody, setAssetForCustody] = useState<Asset | null>(null);
  const [assetForMaintenance, setAssetForMaintenance] = useState<Asset | null>(null);

  // Initial connection test
  useEffect(() => {
    testFirestoreConnection();
  }, []);

  // Listen to Google Sheet connection settings
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      doc(db, 'system_settings', 'google_sheets'),
      (snap) => {
        setHasGoogleSheetConnected(snap.exists() && !!snap.data()?.spreadsheetId);
      },
      (err) => {
        console.warn('Google sheets settings subscription err:', err);
      }
    );
    return () => unsub();
  }, [user]);

  // Listeners
  useEffect(() => {
    if (!user) return;

    const unsubs: (() => void)[] = [];

    unsubs.push(watchAssets((data) => setAssets(data), undefined, profile));
    unsubs.push(
      watchOffices(async (data) => {
        setOffices(data);
    unsubs.push(watchWarehouses((data) => setWarehouses(data), undefined, profile));
        // Seed default offices if completely empty
        if (import.meta.env.DEV && data.length === 0) {
          try {
            await saveOffice({
              name: 'المستودع الرئيسي لتقنية المعلومات',
              building: 'المبنى الرئيسي',
              department: 'قسم الدعم الفني',
              room: 'مستودع الأصول 01',
              manager: 'مدير المستودع',
              isActive: true,
            });
            await saveOffice({
              name: 'إدارة تقنية المعلومات والاتصالات',
              building: 'المبنى الرئيسي',
              department: 'إدارة النظم',
              room: 'الدور الثاني',
              manager: 'مدير تقنية المعلومات',
              isActive: true,
            });
            await saveOffice({
              name: 'الإدارة العامة والمتابعة',
              building: 'المبنى الإداري',
              department: 'المتابعة والتنسيق',
              room: 'الدور الثالث',
              isActive: true,
            });
          } catch (e) {
            console.error('Seed office err:', e);
          }
        }
      }, undefined, profile)
    );
    unsubs.push(
      watchCustodyCards(async (data) => {
        setCustodyCards(data);
        if (import.meta.env.DEV && data.length === 0 && user?.uid) {
          try {
            await saveOfficialCustodyCard(
              {
                cardNumber: 'CR-10023',
                formNumber: 'نموذج مستودع رقم (23)',
                provinceRegion: 'المركز الرئيسي',
                responsibleName: 'م. أحمد خالد النجار',
                roleTitle: 'رئيس قسم الشبكات والمعلوماتية',
                directorate: 'مديرية تقنية المعلومات',
                department: 'دائرة الاتصالات والمعلوماتية',
                officeName: 'مكتب الدعم الفني',
                officeRoom: '204',
                assignedAt: new Date().toISOString(),
                status: 'active',
                approvalStatus: 'approved',
                itDepartmentHead: 'رئيس دائرة الاتصالات والمعلوماتية',
                inventoryTechName: 'فني الجرد المعتمد',
                responsibleSignatureName: 'م. أحمد خالد النجار',
                notes: 'تجهيزات حاسوبية عهدة مكتبية رسمية',
                items: [
                  {
                    id: 'it-1',
                    seq: 1,
                    itemName: 'كمبيوتر مكتبي HP EliteDesk 800',
                    itemDescription: 'Core i7 - 16GB RAM - 512GB SSD',
                    unit: 'جهاز',
                    quantityNumber: 1,
                    quantityText: 'واحد فقط',
                    itemCode: 'HP-SN-49201',
                    cardCode: 'CR-10023/1',
                    receiptDocNumber: '44/م',
                    receiptDate: '2024-05-10',
                    returnDocNumber: '',
                    returnDate: '',
                    balance: 1,
                    notes: 'بحالة تشغيلية ممتازة',
                  },
                  {
                    id: 'it-2',
                    seq: 2,
                    itemName: 'شاشة Dell 24 بوصة IPS',
                    itemDescription: 'Full HD 1080p مع كابل HDMI',
                    unit: 'شاشة',
                    quantityNumber: 1,
                    quantityText: 'واحد فقط',
                    itemCode: 'DELL-MN-3921',
                    cardCode: 'CR-10023/2',
                    receiptDocNumber: '44/م',
                    receiptDate: '2024-05-10',
                    returnDocNumber: '',
                    returnDate: '',
                    balance: 1,
                    notes: 'ملحق للشاشة كابل طاقة أصلي',
                  },
                  {
                    id: 'it-3',
                    seq: 3,
                    itemName: 'طابعة ليزرية HP LaserJet Pro',
                    itemDescription: 'طباعة أحادية اللون شبكية M404dn',
                    unit: 'طابعة',
                    quantityNumber: 1,
                    quantityText: 'واحد فقط',
                    itemCode: 'HP-PRN-8819',
                    cardCode: 'CR-10023/3',
                    receiptDocNumber: '52/م',
                    receiptDate: '2024-06-15',
                    returnDocNumber: '',
                    returnDate: '',
                    balance: 1,
                    notes: 'موصولة على الشبكة الداخلية',
                  },
                ],
              },
              user.uid,
              profile?.displayName || 'المسؤول',
              user.email || ''
            );
          } catch (e) {
            console.error('Seed custody err:', e);
          }
        }
      }, undefined, profile)
    );
    unsubs.push(watchMaintenanceRecords((data) => setMaintenanceRecords(data), undefined, profile));
    unsubs.push(
      watchSpareParts(async (data) => {
        setSpareParts(data);
        // Seed default spare parts if empty
        if (import.meta.env.DEV && data.length === 0) {
          try {
            await addSparePart({
              name: 'شاحن كمبيوتر محمول HP Type-C 65W',
              sku: 'CHG-HP-65W',
              quantity: 12,
              minimumQuantity: 4,
              unitCost: 150,
              supplier: 'مورد معتمد',
            });
            await addSparePart({
              name: 'قرص تخزين SSD NVMe 512GB Kingston',
              sku: 'SSD-512-NVME',
              quantity: 8,
              minimumQuantity: 3,
              unitCost: 220,
              supplier: 'شركة الحاسبات المتقدمة',
            });
            await addSparePart({
              name: 'ذاكرة عشوائية RAM 16GB DDR4 Crucial',
              sku: 'RAM-16GB-DDR4',
              quantity: 6,
              minimumQuantity: 2,
              unitCost: 180,
              supplier: 'شركة الحاسبات المتقدمة',
            });
          } catch (e) {
            console.error('Seed parts err:', e);
          }
        }
      }, undefined, profile)
    );
    unsubs.push(watchAssetMovements(100, (data) => setMovements(data), undefined, profile));

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [user, profile]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F4F7FA] flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <Loader2 className="w-10 h-10 text-[#168C8C] animate-spin mx-auto" />
          <p className="text-sm font-bold text-[#183B56]">جاري التحقق من الصلاحيات والاتصال بـ Firebase...</p>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return <AuthView />;
  }

  // Deactivated user
  if (profile && !profile.isActive) {
    return (
      <div className="min-h-screen bg-[#F4F7FA] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 text-center shadow-xl border border-rose-200">
          <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-rose-900 mb-2">تم تعطيل الحساب</h2>
          <p className="text-xs text-slate-600 mb-6 leading-relaxed">
            تم إيقاف صلاحية هذا الحساب في منظومة الأصول. يرجى التواصل مع المشرف العام أو مسؤول النظام لإعادة التفعيل.
          </p>
          <button
            onClick={() => signOut()}
            className="w-full py-2.5 bg-slate-800 text-white text-xs font-bold rounded-xl cursor-pointer hover:bg-slate-900"
          >
            تسجيل الخروج
          </button>
        </div>
      </div>
    );
  }

  // Badges
  const pendingCustody = custodyCards.filter((c) => c.status === 'active' && c.approvalStatus === 'pending').length;
  const openMaintenance = maintenanceRecords.filter((r) => r.status === 'open' || r.status === 'inProgress').length;
  const lowStock = spareParts.filter((p) => p.quantity <= p.minimumQuantity).length;

  return (
    <div className="min-h-screen bg-[#F4F7FA] flex flex-col font-['Cairo',sans-serif]">
      {/* Top Navbar */}
      <Navbar
        pendingCustodyCount={pendingCustody}
        lowStockCount={lowStock}
      />

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        {/* Sidebar */}
        <Sidebar
          currentTab={currentTab}
          onSelectTab={(tab) => {
            setCurrentTab(tab);
          }}
          pendingCustodyCount={pendingCustody}
          openMaintenanceCount={openMaintenance}
          lowStockCount={lowStock}
          hasGoogleSheetConnected={hasGoogleSheetConnected}
        />

        {/* Content Area */}
        <main className="flex-1 min-h-0 p-3 sm:p-4 md:p-8 overflow-y-auto max-h-[calc(100vh-10rem)] md:max-h-[calc(100vh-4rem)]">
          {currentTab === 'dashboard' && (
            <DashboardView
              assets={assets}
              offices={offices}
              movements={movements}
              custodyCards={custodyCards}
              spareParts={spareParts}
              maintenanceRecords={maintenanceRecords}
              warehouses={warehouses}
              onNavigate={(tab) => setCurrentTab(tab)}
              onOpenAddAsset={() => setCurrentTab('assets')}
              onOpenAddCustody={() => setCurrentTab('custody')}
              onOpenAddMaintenance={() => setCurrentTab('maintenance')}
            />
          )}

          {currentTab === 'offices' && (
            <OfficesView offices={offices} assets={assets} />
          )}

          {currentTab === 'assets' && (
            <AssetsView
              assets={assets}
              offices={offices}
              onOpenAddCustodyWithAsset={(asset) => {
                setAssetForCustody(asset);
                setCurrentTab('custody');
              }}
              onOpenMaintenanceWithAsset={(asset) => {
                setAssetForMaintenance(asset);
                setCurrentTab('maintenance');
              }}
            />
          )}

          {currentTab === 'custody' && (
            <CustodyView
              custodyCards={custodyCards}
              assets={assets}
              offices={offices}
              initialAssetForCustody={assetForCustody}
              onClearInitialAsset={() => setAssetForCustody(null)}
            />
          )}

          {currentTab === 'google-sheets' && (
            <GoogleSheetsView
              assets={assets}
              custodyCards={custodyCards}
            />
          )}

          {currentTab === 'movements' && (
            <AssetMovementsView movements={movements} />
          )}

          {currentTab === 'maintenance' && (
            <MaintenanceView
              maintenanceRecords={maintenanceRecords}
              assets={assets}
              spareParts={spareParts}
              initialAssetForMaintenance={assetForMaintenance}
              onClearInitialAsset={() => setAssetForMaintenance(null)}
            />
          )}

          {currentTab === 'service-history' && (
            <ServiceHistoryView
              maintenanceRecords={maintenanceRecords}
              assets={assets}
            />
          )}

          {currentTab === 'spare-parts' && (
            <SparePartsView
              spareParts={spareParts}
              maintenanceRecords={maintenanceRecords}
            />
          )}

          {currentTab === 'documents' && (
            <AssetDocumentsView assets={assets} />
          )}

          {currentTab === 'import' && (
            <AssetImportView assets={assets} />
          )}

          {currentTab === 'reports' && (
            <ReportsView
              assets={assets}
              offices={offices}
              custodyCards={custodyCards}
              maintenanceRecords={maintenanceRecords}
            />
          )}

          {currentTab === 'users' && <UserManagementView />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
    </AuthProvider>
  );
}
