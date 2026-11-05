import React, { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  ShieldCheck,
  LogOut,
  User as UserIcon,
  Bell,
  HardDrive,
  Database,
  MonitorDown,
  Info,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface NavbarProps {
  onOpenNotifications?: () => void;
  pendingCustodyCount?: number;
  lowStockCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  pendingCustodyCount = 0,
  lowStockCount = 0,
}) => {
  const { user, profile, signOut } = useAuth();
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const isNativeApp = Capacitor.isNativePlatform();

  useEffect(() => {
    // Check if running in standalone mode (already installed desktop app)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
    }

    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setIsInstalled(true);
      }
      setDeferredPrompt(null);
    } else {
      setShowInstallGuide(true);
    }
  };

  const totalAlerts = pendingCustodyCount + lowStockCount;

  return (
    <header className="min-h-16 bg-white border-b border-slate-200 px-3 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 sticky top-0 z-30 no-print shadow-xs">
      {/* Brand title */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-[#168C8C]/10 flex items-center justify-center text-[#168C8C] shadow-xs">
          <HardDrive className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-sm sm:text-lg text-[#183B56] tracking-tight">
              METRA IT ASSETS
            </h1>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#168C8C]/10 text-[#168C8C]">
              Cloud Firestore
            </span>
          </div>
          <p className="text-[10px] sm:text-xs text-slate-500 font-medium">
            منظومة جرد وإدارة أصول تقنية المعلومات والعهد
          </p>
        </div>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-1 sm:gap-3">
        {/* Desktop Install App Button */}
        {!isNativeApp && !isInstalled && (
          <button
            onClick={handleInstallClick}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-teal-50 hover:bg-teal-100 text-[#168C8C] border border-teal-200 text-xs font-bold transition-all cursor-pointer shadow-2xs"
            title="تثبيت التطبيق على الجهاز"
          >
            <MonitorDown className="w-4 h-4" />
            <span className="hidden sm:inline">تثبيت التطبيق</span>
          </button>
        )}

        {/* Alerts Badge */}
        {totalAlerts > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium">
            <Bell className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
            <span>{totalAlerts} تنبيهات معلقة</span>
          </div>
        )}

        {/* User Card */}
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/80 px-2 sm:px-3 py-1.5 rounded-xl max-w-[48vw] sm:max-w-none">
          <div className="w-8 h-8 rounded-lg bg-[#183B56] text-white flex items-center justify-center font-bold text-sm">
            {profile?.displayName?.[0]?.toUpperCase() || <UserIcon className="w-4 h-4" />}
          </div>
          <div className="text-right">
            <p className="text-[11px] sm:text-xs font-bold text-[#183B56] leading-none truncate max-w-28 sm:max-w-none">
              {profile?.displayName || user?.email?.split('@')[0]}
            </p>
            <div className="flex items-center gap-1 mt-0.5">
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${profile?.isActive ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              <span className="text-[11px] text-slate-500 font-medium">
                {profile?.role === 'admin' ? 'مدير نظام (Admin)' : 'مسؤول تقنية (IT Manager)'}
              </span>
            </div>
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={() => {
            if (window.confirm('هل تريد تسجيل الخروج من منظومة الأصول؟')) {
              signOut();
            }
          }}
          title="تسجيل الخروج"
          className="p-2 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-colors cursor-pointer"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>

      {/* Desktop App Installation Guide Modal */}
      {showInstallGuide && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl relative">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-teal-100 text-[#168C8C] flex items-center justify-center">
                <MonitorDown className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-black text-base text-[#183B56]">
                  تثبيت البرنامج كتطبيق سطح مكتب
                </h3>
                <p className="text-xs text-slate-500">يعمل كبرنامج مستقل على شاشتك بدون متصفح</p>
              </div>
            </div>

            <div className="space-y-3 text-xs text-slate-600 mb-6 bg-slate-50 p-4 rounded-2xl border border-slate-200">
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-[#183B56] text-white flex items-center justify-center shrink-0 font-bold text-[10px]">
                  1
                </span>
                <p>
                  من شريط عنوان المتصفح (Chrome أو Edge)، اضغط على أيقونة التثبيت{' '}
                  <span className="font-bold text-[#183B56]">"Install App"</span> في الزاوية العلوية.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-[#183B56] text-white flex items-center justify-center shrink-0 font-bold text-[10px]">
                  2
                </span>
                <p>
                  أو من قائمة المتصفح (الثلاث نقاط) اختر:{' '}
                  <span className="font-bold text-[#183B56]">"حفظ ومشاركة" &gt; "تثبيت الصفحة كتطبيق"</span>.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 font-bold text-[10px]">
                  3
                </span>
                <p>
                  سيظهر لك أيقونة رسمية على سطح المكتب وقائمة ابدأ، ويعمل كنافذة برنامج مستقل وسريع.
                </p>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setShowInstallGuide(false)}
                className="px-5 py-2.5 bg-[#183B56] text-white font-bold rounded-xl text-xs hover:bg-[#122c42] cursor-pointer"
              >
                حسناً، فهمت
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
