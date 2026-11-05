import React, { useState } from 'react';
import {
  Building2,
  Plus,
  Search,
  MapPin,
  Phone,
  User,
  Edit,
  Power,
  X,
  HardDrive,
} from 'lucide-react';
import { Office, Asset } from '../types';
import { saveOffice, toggleOfficeStatus } from '../services/officeService';
import { useAuth } from '../context/AuthContext';

interface OfficesViewProps {
  offices: Office[];
  assets: Asset[];
}

export const OfficesView: React.FC<OfficesViewProps> = ({ offices, assets }) => {
  const { isAdmin } = useAuth();

  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingOffice, setEditingOffice] = useState<Office | null>(null);

  // Form
  const [name, setName] = useState('');
  const [building, setBuilding] = useState('');
  const [directorate, setDirectorate] = useState('');
  const [department, setDepartment] = useState('');
  const [room, setRoom] = useState('');
  const [manager, setManager] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  const openAdd = () => {
    setEditingOffice(null);
    setName('');
    setBuilding('');
    setDirectorate('');
    setDepartment('');
    setRoom('');
    setManager('');
    setPhone('');
    setNotes('');
    setFormError('');
    setIsModalOpen(true);
  };

  const openEdit = (office: Office) => {
    setEditingOffice(office);
    setName(office.name);
    setBuilding(office.building || '');
    setDirectorate(office.directorate || '');
    setDepartment(office.department || '');
    setRoom(office.room || '');
    setManager(office.manager || '');
    setPhone(office.phone || '');
    setNotes(office.notes || '');
    setFormError('');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('اسم المكتب أو الموقع مطلوب');
      return;
    }

    setFormLoading(true);
    setFormError('');

    try {
      await saveOffice({
        id: editingOffice?.id,
        name: name.trim(),
        building: building.trim(),
        directorate: directorate.trim(),
        department: department.trim(),
        room: room.trim(),
        manager: manager.trim(),
        phone: phone.trim(),
        notes: notes.trim(),
        isActive: editingOffice ? editingOffice.isActive : true,
      });

      setIsModalOpen(false);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'تعذر حفظ المكتب');
    } finally {
      setFormLoading(false);
    }
  };

  const handleToggleActive = async (office: Office) => {
    try {
      await toggleOfficeStatus(office.id, !office.isActive);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'تعذر تعديل حالة المكتب');
    }
  };

  const filtered = offices.filter((o) => {
    return (
      search.trim() === '' ||
      o.name.toLowerCase().includes(search.toLowerCase()) ||
      (o.building && o.building.toLowerCase().includes(search.toLowerCase())) ||
      (o.department && o.department.toLowerCase().includes(search.toLowerCase())) ||
      (o.manager && o.manager.toLowerCase().includes(search.toLowerCase()))
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-[#183B56]">المكاتب والمواقع</h2>
          <p className="text-sm text-slate-500">
            دليل المباني، الإدارات، الأقسام، والمكاتب المعتمدة لتوزيع وحركة الأجهزة
          </p>
        </div>

        {isAdmin && (
          <button
            onClick={openAdd}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#168C8C] hover:bg-[#137676] text-white text-sm font-bold rounded-xl shadow-xs transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة مكتب جديد</span>
          </button>
        )}
      </div>

      {/* Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute right-3.5 top-3 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث باسم المكتب، المبنى، القسم، أو المسؤول..."
            className="w-full pl-4 pr-10 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
          />
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.length === 0 ? (
          <div className="col-span-full py-16 text-center text-slate-400 bg-white rounded-2xl border border-slate-200/90">
            <Building2 className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="font-bold">لا توجد مكاتب مسجلة مطابقة</p>
          </div>
        ) : (
          filtered.map((office) => {
            const assetCount = assets.filter((a) => a.officeId === office.id || a.officeName === office.name).length;

            return (
              <div
                key={office.id}
                className={`bg-white p-5 rounded-2xl border shadow-xs flex flex-col justify-between transition-all ${
                  office.isActive ? 'border-slate-200/90 hover:border-[#168C8C]' : 'border-slate-200 opacity-60 bg-slate-50/50'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        office.isActive
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {office.isActive ? 'مكتب نشط' : 'معطل مؤقتاً'}
                    </span>
                    <span className="text-xs font-bold text-[#168C8C] flex items-center gap-1">
                      <HardDrive className="w-3.5 h-3.5" />
                      <span>{assetCount} جهاز مسجل</span>
                    </span>
                  </div>

                  <h4 className="font-bold text-base text-[#183B56] mb-1">{office.name}</h4>

                  <div className="space-y-1 text-xs text-slate-500 mt-2">
                    {office.building && (
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>
                          {office.building} {office.room ? `• غرفة ${office.room}` : ''}
                        </span>
                      </div>
                    )}
                    {office.department && (
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>
                          {office.department} {office.directorate ? `(${office.directorate})` : ''}
                        </span>
                      </div>
                    )}
                    {office.manager && (
                      <div className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>المسؤول: {office.manager}</span>
                      </div>
                    )}
                    {office.phone && (
                      <div className="flex items-center gap-1.5 font-mono">
                        <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>{office.phone}</span>
                      </div>
                    )}
                  </div>
                </div>

                {isAdmin && (
                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-end gap-1.5">
                    <button
                      onClick={() => handleToggleActive(office)}
                      title={office.isActive ? 'تعطيل المكتب' : 'تفعيل المكتب'}
                      className={`p-1.5 rounded-lg cursor-pointer ${
                        office.isActive
                          ? 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                          : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
                      }`}
                    >
                      <Power className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => openEdit(office)}
                      title="تعديل المكتب"
                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg cursor-pointer"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl relative">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute left-4 top-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold text-[#183B56] mb-1">
              {editingOffice ? 'تعديل بيانات المكتب' : 'إضافة موقع أو مكتب جديد'}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              تسجيل بيانات الموقع لربطه بالأجهزة والعهد
            </p>

            {formError && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-bold">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4 text-sm">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">اسم المكتب / الموقع *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: مكتب تقنية المعلومات، إدارة الشؤون المالية"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">المبنى</label>
                  <input
                    type="text"
                    value={building}
                    onChange={(e) => setBuilding(e.target.value)}
                    placeholder="المبنى الرئيسي، المقر الفرعي"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">رقم الغرفة</label>
                  <input
                    type="text"
                    value={room}
                    onChange={(e) => setRoom(e.target.value)}
                    placeholder="104"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">المديرية / القطاع</label>
                  <input
                    type="text"
                    value={directorate}
                    onChange={(e) => setDirectorate(e.target.value)}
                    placeholder="قطاع الخدمات المساندة"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">القسم</label>
                  <input
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="قسم الدعم الفني"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">مسؤول المكتب</label>
                  <input
                    type="text"
                    value={manager}
                    onChange={(e) => setManager(e.target.value)}
                    placeholder="اسم المشرف أو المدير..."
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">الهاتف الداخلي</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="2451"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none font-mono text-xs"
                  />
                </div>
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="px-5 py-2 text-xs font-bold bg-[#168C8C] hover:bg-[#137676] text-white rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {formLoading ? 'جاري الحفظ...' : 'حفظ المكتب'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
