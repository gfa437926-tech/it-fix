import React from 'react';
import {
  LayoutDashboard,
  Building2,
  Laptop2,
  FileCheck2,
  History,
  Wrench,
  FileText,
  Boxes,
  Sheet,
  Paperclip,
  UploadCloud,
  BarChart3,
  Users2,
  Share2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export type NavTab =
  | 'dashboard'
  | 'assets'
  | 'custody'
  | 'google-sheets'
  | 'import'
  | 'maintenance'
  | 'service-history'
  | 'spare-parts'
  | 'offices'
  | 'movements'
  | 'documents'
  | 'reports'
  | 'users';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  pendingCustodyCount?: number;
  openMaintenanceCount?: number;
  lowStockCount?: number;
  hasGoogleSheetConnected?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  pendingCustodyCount = 0,
  openMaintenanceCount = 0,
  lowStockCount = 0,
  hasGoogleSheetConnected = false,
}) => {
  const { isAdmin, isPrimaryController, profile } = useAuth();
  const hasScopedPermission = (...permissions: string[]) =>
    profile?.accessControlEnabled !== true ||
    permissions.some((permission) =>
      (profile?.permissions as Record<string, boolean> | undefined)?.[permission] === true
    );

  const navItems: {
    id: NavTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
    badgeColor?: string;
    badgeText?: string;
    adminOnly?: boolean;
    controllerOnly?: boolean;
    permissions?: string[];
    highlight?: boolean;
  }[] = [
    { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard },
    { id: 'assets', label: 'الأجهزة والبطاقات', icon: Laptop2, permissions: ['assets.read', 'assets.create', 'assets.update', 'assets.delete'] },
    {
      id: 'custody',
      label: 'بطاقات العهدة',
      icon: FileCheck2,
      badge: pendingCustodyCount,
      badgeColor: 'bg-amber-500 text-white',
      permissions: ['custody.read', 'custody.manage'],
    },
    {
      id: 'google-sheets',
      label: 'ربط ومزامنة Google Sheets',
      icon: Sheet,
      badgeText: hasGoogleSheetConnected ? 'مُعدّ' : undefined,
      badgeColor: 'bg-emerald-500 text-white',
      highlight: true,
      controllerOnly: true,
    },
    {
      id: 'import',
      label: 'رفع وتعديل ملفات الشيت',
      icon: UploadCloud,
      permissions: ['assets.create', 'assets.update'],
    },
    {
      id: 'maintenance',
      label: 'الصيانة والأعطال',
      icon: Wrench,
      badge: openMaintenanceCount,
      badgeColor: 'bg-rose-500 text-white',
      permissions: ['maintenance.read', 'maintenance.manage'],
    },
    { id: 'service-history', label: 'السجل الفني للأجهزة', icon: FileText, permissions: ['maintenance.read', 'maintenance.manage', 'assets.read'] },
    {
      id: 'spare-parts',
      label: 'مخزون قطع الغيار',
      icon: Boxes,
      badge: lowStockCount,
      badgeColor: 'bg-amber-500 text-white',
      permissions: ['spareparts.read', 'spareparts.manage'],
    },
    { id: 'offices', label: 'المكاتب والمواقع', icon: Building2, permissions: ['offices.read', 'offices.manage', 'assets.read'] },
    { id: 'movements', label: 'حركة وسجل الأجهزة', icon: History, permissions: ['assets.read', 'assets.update', 'custody.read', 'custody.manage', 'maintenance.read', 'maintenance.manage'] },
    { id: 'documents', label: 'المرفقات والوثائق', icon: Paperclip, permissions: ['documents.read', 'documents.manage'] },
    { id: 'reports', label: 'التقارير والتصدير', icon: BarChart3, permissions: ['reports.read'] },
    {
      id: 'users',
      label: 'المستخدمون والصلاحيات',
      icon: Users2,
      adminOnly: true,
    },
  ];

  return (
    <aside className="w-full md:w-64 bg-[#183B56] text-white flex flex-col shrink-0 no-print min-h-0 md:min-h-[calc(100vh-4rem)] max-h-36 md:max-h-none">
      {/* Category header */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <p className="text-xs font-semibold text-teal-300 uppercase tracking-wider">
          قائمة النظام الرئيسية
        </p>
        {isPrimaryController && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400 text-amber-950">
            المتحكم الأول
          </span>
        )}
      </div>

      {/* Nav items */}
      <nav className="p-2 md:p-3 flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-x-hidden md:overflow-y-auto flex-1">
        {navItems.map((item) => {
          if (item.adminOnly && !isAdmin) return null;
          if (item.controllerOnly && !isPrimaryController) return null;
          if (item.permissions && !hasScopedPermission(...item.permissions)) return null;
          const Icon = item.icon;
          const active = currentTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`w-auto md:w-full min-w-max md:min-w-0 flex items-center justify-between px-3 md:px-3.5 py-2.5 rounded-xl text-xs md:text-sm font-medium transition-all cursor-pointer ${
                active
                  ? 'bg-white/15 text-white font-bold shadow-xs'
                  : item.highlight
                  ? 'text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200'
                  : 'text-slate-300 hover:bg-white/5 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={`w-4 h-4 ${
                    active
                      ? 'text-teal-400'
                      : item.highlight
                      ? 'text-emerald-400'
                      : 'text-slate-400'
                  }`}
                />
                <span>{item.label}</span>
              </div>

              {item.badge !== undefined && item.badge > 0 && (
                <span
                  className={`px-2 py-0.5 text-xs font-bold rounded-full ${
                    item.badgeColor || 'bg-teal-500 text-white'
                  }`}
                >
                  {item.badge}
                </span>
              )}

              {item.badgeText && (
                <span
                  className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                    item.badgeColor || 'bg-emerald-500 text-white'
                  }`}
                >
                  {item.badgeText}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Cloud & Database indicator footer */}
      <div className="hidden md:flex p-3.5 m-3 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-300 items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
        <div className="truncate">
          <p className="font-semibold text-white">قاعدة البيانات: Firestore</p>
          <p className="text-[11px] text-slate-400 truncate">
            {hasGoogleSheetConnected ? 'Google Sheets: إعداد محفوظ' : 'Google Sheets: غير مهيأ'}
          </p>
        </div>
      </div>
    </aside>
  );
};
