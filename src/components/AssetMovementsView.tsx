import React, { useState } from 'react';
import {
  History,
  Search,
  Filter,
  Clock,
  Printer,
  ArrowRight,
  User,
  Building,
} from 'lucide-react';
import { AssetMovement, MOVEMENT_TYPE_LABELS } from '../types';

interface AssetMovementsViewProps {
  movements: AssetMovement[];
}

export const AssetMovementsView: React.FC<AssetMovementsViewProps> = ({
  movements,
}) => {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  const filtered = movements.filter((m) => {
    const matchesSearch =
      search.trim() === '' ||
      m.assetLabel.toLowerCase().includes(search.toLowerCase()) ||
      (m.toEmployee && m.toEmployee.toLowerCase().includes(search.toLowerCase())) ||
      (m.fromEmployee && m.fromEmployee.toLowerCase().includes(search.toLowerCase())) ||
      (m.toOffice && m.toOffice.toLowerCase().includes(search.toLowerCase())) ||
      (m.fromOffice && m.fromOffice.toLowerCase().includes(search.toLowerCase())) ||
      (m.notes && m.notes.toLowerCase().includes(search.toLowerCase()));

    const matchesType = typeFilter === 'all' || m.movementType === typeFilter;

    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <h2 className="text-2xl font-black text-[#183B56]">سجل حركة الأصول والتدقيق</h2>
          <p className="text-sm text-slate-500">
            تتبع زمني متسلسل لكافة عمليات النقل، التسليم، الإرجاع، والصيانة
          </p>
        </div>

        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#183B56] hover:bg-[#122c42] text-white text-sm font-bold rounded-xl shadow-xs transition-all cursor-pointer"
        >
          <Printer className="w-4 h-4" />
          <span>طباعة سجل الحركات</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-xs flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="relative min-w-[240px] flex-1">
          <Search className="w-4 h-4 absolute right-3.5 top-3 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="بحث بالجهاز، الموظف، المكتب، أو الملاحظات..."
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
            <option value="all">كل أنواع الحركات ({movements.length})</option>
            {Object.entries(MOVEMENT_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Timeline List */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-xs">
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <History className="w-10 h-10 mx-auto mb-2 opacity-40" />
            <p className="font-bold">لا توجد حركات مسجلة مطابقة</p>
          </div>
        ) : (
          <div className="relative border-r-2 border-slate-200 mr-4 space-y-6">
            {filtered.map((m) => {
              const label = MOVEMENT_TYPE_LABELS[m.movementType] || m.movementType;
              const dateStr = new Date(m.occurredAt).toLocaleString('ar-EG', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div key={m.id} className="relative pr-6">
                  {/* Timeline Dot */}
                  <div className="absolute -right-[9px] top-1.5 w-4 h-4 rounded-full bg-[#168C8C] border-2 border-white shadow-xs" />

                  <div className="bg-slate-50 border border-slate-200/80 p-4 rounded-xl hover:bg-slate-100/60 transition-all space-y-1.5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#183B56]">{label}</span>
                        <span className="text-xs font-semibold text-[#168C8C]">• {m.assetLabel}</span>
                      </div>
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        <span>{dateStr}</span>
                      </span>
                    </div>

                    {(m.toEmployee || m.fromEmployee || m.toOffice || m.fromOffice) && (
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 pt-1">
                        {m.fromEmployee && (
                          <span className="flex items-center gap-1">
                            <span className="text-slate-400">من موظف:</span>
                            <span className="font-semibold">{m.fromEmployee}</span>
                          </span>
                        )}
                        {m.toEmployee && (
                          <span className="flex items-center gap-1">
                            <span className="text-slate-400">إلى موظف:</span>
                            <span className="font-semibold text-[#183B56]">{m.toEmployee}</span>
                          </span>
                        )}
                        {m.fromOffice && (
                          <span className="flex items-center gap-1">
                            <span className="text-slate-400">من مكتب:</span>
                            <span className="font-semibold">{m.fromOffice}</span>
                          </span>
                        )}
                        {m.toOffice && (
                          <span className="flex items-center gap-1">
                            <span className="text-slate-400">إلى مكتب:</span>
                            <span className="font-semibold text-[#183B56]">{m.toOffice}</span>
                          </span>
                        )}
                      </div>
                    )}

                    {m.notes && (
                      <p className="text-xs text-slate-500 bg-white/70 p-2 rounded-lg border border-slate-100 mt-1">
                        {m.notes}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
