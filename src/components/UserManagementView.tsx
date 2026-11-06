import React, { useState, useEffect } from 'react';
import {
  Users2,
  ShieldCheck,
  Shield,
  UserCheck,
  UserX,
  Plus,
  Search,
  X,
  Mail,
  User as UserIcon,
} from 'lucide-react';
import { UserProfile } from '../types';
import {
  watchUsers,
  updateUserRole,
  toggleUserActive,
  createManualUser,
} from '../services/userService';
import { useAuth } from '../context/AuthContext';

export const UserManagementView: React.FC = () => {
  const { user: currentAuthUser, isPrimaryController } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'it_manager'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [isAddOpen, setIsAddOpen] = useState(false);

  // Form
  const [uid, setUid] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'it_manager'>('it_manager');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  useEffect(() => {
    const unsub = watchUsers((userList) => {
      setUsers(userList);
    });
    return () => unsub();
  }, []);

  const handleRoleChange = async (targetUid: string, newRole: 'admin' | 'it_manager') => {
    if (!isPrimaryController) {
      alert('تغيير صلاحيات المستخدمين متاح للمتحكم الأساسي فقط');
      return;
    }
    try {
      await updateUserRole(targetUid, newRole);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'تعذر تحديث الصلاحية');
    }
  };

  const handleToggleActive = async (targetUser: UserProfile) => {
    if (!isPrimaryController) {
      alert('تغيير حالة الحسابات متاح للمتحكم الأساسي فقط');
      return;
    }
    if (targetUser.uid === currentAuthUser?.uid) {
      alert('لا يمكنك تعطيل حسابك الشخصي النشط');
      return;
    }
    try {
      await toggleUserActive(targetUser.uid, !targetUser.isActive);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'تعذر تغيير حالة الحساب');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPrimaryController) {
      setFormError('إنشاء المستخدمين متاح للمتحكم الأساسي فقط');
      return;
    }
    if (!displayName.trim() || !email.trim() || !uid.trim()) {
      setFormError('الاسم والبريد الإلكتروني ومعرف Firebase Authentication (UID) مطلوبة');
      return;
    }

    setFormLoading(true);
    setFormError('');

    try {
      await createManualUser({
        uid: uid.trim(),
        displayName: displayName.trim(),
        email: email.trim().toLowerCase(),
        role,
        isActive: true,
      });

      setIsAddOpen(false);
      setUid('');
      setDisplayName('');
      setEmail('');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'تعذر تسجيل المستخدم');
    } finally {
      setFormLoading(false);
    }
  };

  const filtered = users.filter((u) => {
    return (
      search.trim() === '' ||
      u.displayName.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
    ) &&
      (roleFilter === 'all' || u.role === roleFilter) &&
      (statusFilter === 'all' || (statusFilter === 'active' ? u.isActive : !u.isActive));
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#183B56]">المستخدمون والصلاحيات (RBAC)</h2>
          <p className="text-sm text-slate-500">
            إدارة حسابات مسؤولي النظام وفريق تقنية المعلومات، والتحكم في صلاحيات الوصول
          </p>
        </div>

        {isPrimaryController && <button
          onClick={() => {
            setFormError('');
            setIsAddOpen(true);
          }}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#183B56] hover:bg-[#122c42] text-white text-sm font-bold rounded-xl shadow-xs transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة مستخدم جديد</span>
        </button>}
      </div>

      {/* Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute right-3.5 top-3 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالاسم أو البريد الإلكتروني..."
            className="w-full pl-4 pr-10 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
          />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)} aria-label="تصفية حسب الدور" className="text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
          <option value="all">كل الأدوار</option>
          <option value="admin">مدير نظام</option>
          <option value="it_manager">مسؤول تقنية</option>
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="تصفية حسب حالة الحساب" className="text-xs px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
          <option value="all">كل الحالات</option>
          <option value="active">مفعل</option>
          <option value="inactive">معطل</option>
        </select>
      </div>
      <p className="text-xs text-slate-500">عرض {filtered.length} من أصل {users.length} مستخدم</p>

      {/* Users Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="bg-slate-50/80 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-bold">المستخدم</th>
                <th className="py-3 px-4 font-bold">البريد الإلكتروني</th>
                <th className="py-3 px-4 font-bold">الدور والصلاحية</th>
                <th className="py-3 px-4 font-bold">حالة الحساب</th>
                <th className="py-3 px-4 font-bold">تاريخ التسجيل</th>
                <th className="py-3 px-4 font-bold text-center">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    لا يوجد مستخدمون مطابقون
                  </td>
                </tr>
              ) : (
                filtered.map((userItem) => {
                  const isCurrent = userItem.uid === currentAuthUser?.uid;

                  return (
                    <tr key={userItem.uid} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3.5 px-4 font-bold text-[#183B56]">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-[#183B56] text-white flex items-center justify-center font-bold text-xs">
                            {userItem.displayName?.[0]?.toUpperCase() || <UserIcon className="w-4 h-4" />}
                          </div>
                          <div>
                            <span>{userItem.displayName}</span>
                            {isCurrent && (
                              <span className="mr-2 text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 font-normal">
                                (حسابك الحالي)
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-600">
                        {userItem.email}
                      </td>
                      <td className="py-3.5 px-4">
                        <select
                          disabled={!isPrimaryController || isCurrent}
                          value={userItem.role}
                          onChange={(e) =>
                            handleRoleChange(userItem.uid, e.target.value as 'admin' | 'it_manager')
                          }
                          className="text-xs font-bold py-1.5 px-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none disabled:opacity-75 cursor-pointer"
                        >
                          {isPrimaryController && <option value="admin">مدير نظام (Admin)</option>}
                          <option value="it_manager">مسؤول تقنية (IT Manager)</option>
                        </select>
                      </td>
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                            userItem.isActive
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-rose-50 text-rose-800 border border-rose-200'
                          }`}
                        >
                          {userItem.isActive ? <UserCheck className="w-3 h-3" /> : <UserX className="w-3 h-3" />}
                          <span>{userItem.isActive ? 'مفعل' : 'معطل'}</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-500">
                        {new Date(userItem.createdAt).toLocaleDateString('ar-EG')}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          disabled={!isPrimaryController || isCurrent}
                          onClick={() => handleToggleActive(userItem)}
                          className={`px-3 py-1.5 text-xs font-bold rounded-lg cursor-pointer transition-all disabled:opacity-30 ${
                            userItem.isActive
                              ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          }`}
                        >
                          {userItem.isActive ? 'تعطيل الحساب' : 'تفعيل الحساب'}
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

      {/* Add User Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl relative">
            <button
              onClick={() => setIsAddOpen(false)}
              className="absolute left-4 top-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold text-[#183B56] mb-1">إضافة ملف مستخدم</h3>
            <p className="text-xs text-slate-500 mb-4">
              إنشاء ملف صلاحيات Firestore لمستخدم موجود مسبقاً في Firebase Authentication
            </p>

            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-bold">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الاسم الكامل *</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="محمد أحمد..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">البريد الإلكتروني *</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">الصلاحية والدور *</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'admin' | 'it_manager')}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs font-semibold"
                >
                  {isPrimaryController && <option value="admin">مدير نظام (كامل الصلاحيات)</option>}
                  <option value="it_manager">مسؤول تقنية (إدارة الأصول والعهد والصيانة)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  معرف الحساب (UID من Firebase Authentication) *
                </label>
                <input
                  type="text"
                  value={uid}
                  onChange={(e) => setUid(e.target.value)}
                  placeholder="الصق UID للحساب المنشأ في Firebase Auth"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none font-mono text-xs"
                />
              </div>

              <p className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-[11px] leading-5 text-amber-800">هذا النموذج لا ينشئ حساب تسجيل الدخول أو كلمة المرور. أنشئ الحساب أولاً في Firebase Authentication ثم أدخل UID هنا.</p>

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
                  className="px-5 py-2 text-xs font-bold bg-[#183B56] hover:bg-[#122c42] text-white rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {formLoading ? 'جاري الحفظ...' : 'حفظ المستخدم'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
