import React from 'react';

interface DetailItem {
  id: string;
  label: string;
  value: number;
}

interface Props {
  label: string;
  value: number;
  icon: string;
  color: 'emerald' | 'rose' | 'indigo';
  details?: DetailItem[];
}

const StatCard: React.FC<Props> = ({ label, value, icon, color, details }) => {
  const colorMap = {
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    rose: 'bg-rose-50 text-rose-600 border-rose-100',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-100',
  };

  const textMap = {
    emerald: 'text-emerald-700',
    rose: 'text-rose-700',
    indigo: 'text-indigo-700',
  };

  return (
    <div className={`p-5 rounded-2xl border bg-white shadow-sm flex flex-col transition-all hover:shadow-md`}>
      <div className="flex items-center gap-4 mb-3">
        <div className={`w-10 h-10 flex items-center justify-center rounded-xl shrink-0 ${colorMap[color]}`}>
          <i className={`fa-solid ${icon} text-lg`}></i>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider truncate">{label}</p>
          <p className={`text-xl font-black ${textMap[color]}`}>
            ₹{value.toLocaleString('en-IN')}
          </p>
        </div>
      </div>

      {details && details.length > 0 && (
        <div className="mt-2 pt-3 border-t border-slate-50">
          <div className="max-h-24 overflow-y-auto pr-1 custom-scrollbar">
            <ul className="space-y-1.5">
              {details.map((item) => (
                <li key={item.id} className="flex justify-between items-center text-[10px] font-medium text-slate-500 hover:text-slate-800 transition-colors">
                  <span className="truncate pr-2">{item.label}</span>
                  <span className="shrink-0 font-bold tabular-nums">₹{item.value.toLocaleString('en-IN')}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default StatCard;