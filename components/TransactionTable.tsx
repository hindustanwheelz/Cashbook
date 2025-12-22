
import React from 'react';
import { Transaction } from '../types';

interface Props {
  transactions: Transaction[];
  onDeleteRequest: (id: string) => void;
  onEditRequest: (transaction: Transaction) => void;
}

const TransactionTable: React.FC<Props> = ({ transactions, onDeleteRequest, onEditRequest }) => {
  if (transactions.length === 0) {
    return (
      <div className="text-center py-10 bg-white rounded-xl border border-dashed border-slate-300">
        <i className="fa-solid fa-receipt text-4xl text-slate-300 mb-3"></i>
        <p className="text-slate-500">No records for this date.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto bg-white rounded-xl shadow-sm border border-slate-200">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Source/Mode</th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Description</th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Amount</th>
            <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {[...transactions].reverse().map((t) => (
            <tr key={t.id} className="hover:bg-slate-50 transition-colors group">
              <td className="px-6 py-4 whitespace-nowrap">
                <div className="flex flex-col">
                  <span className={`text-[10px] font-bold uppercase ${t.type === 'INCOME' ? 'text-indigo-500' : 'text-slate-400'}`}>
                    {t.type === 'INCOME' ? (t.incomeSource === 'NA' ? 'Income' : t.incomeSource) : 'Expense'}
                  </span>
                  <span className="text-xs text-slate-500">
                    {t.paymentMode !== 'NA' ? t.paymentMode : (t.category || 'General')}
                  </span>
                </div>
              </td>
              <td className="px-6 py-4 text-sm font-medium text-slate-800">
                {t.description}
              </td>
              <td className={`px-6 py-4 text-sm font-bold text-right whitespace-nowrap ${t.type === 'INCOME' ? 'text-emerald-600' : 'text-rose-600'}`}>
                {t.type === 'INCOME' ? '+' : '-'} ₹{t.amount.toLocaleString('en-IN')}
              </td>
              <td className="px-6 py-4 text-center">
                <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => onEditRequest(t)}
                    className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
                    title="Edit Transaction"
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>
                  <button 
                    onClick={() => onDeleteRequest(t.id)}
                    className="p-2 text-slate-300 hover:text-rose-600 transition-colors"
                    title="Delete Transaction"
                  >
                    <i className="fa-solid fa-trash-can"></i>
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default TransactionTable;
