
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Transaction, TransactionType, IncomeSource, PaymentMode } from './types';
import { 
  loadTransactionsLocal, 
  saveTransactionsLocal, 
  syncToGoogleSheet, 
  fetchFromGoogleSheet, 
  loadSettings, 
  saveSettings,
} from './services/sheetService';
import { getFinancialInsights } from './services/geminiService';
import TransactionTable from './components/TransactionTable';
import StatCard from './components/StatCard';

const SYNC_INTERVAL_MS = 30000;
const MUTATION_PAUSE_MS = 20000; // Pause background pull for 20s after any change
const MASTER_PASSCODE = "DLYJ";

const App: React.FC = () => {
  // Security States
  const [isLocked, setIsLocked] = useState(true);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeError, setPasscodeError] = useState(false);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  
  // Entry Form States
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [incomeSource, setIncomeSource] = useState<IncomeSource>('SALE');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('CASH');
  const [category, setCategory] = useState('');
  
  // Sync & UI States
  const [syncStatus, setSyncStatus] = useState<'IDLE' | 'SYNCING' | 'ERROR' | 'SUCCESS'>('IDLE');
  const [sheetUrl, setSheetUrl] = useState('');
  const [insights, setInsights] = useState<string>('');
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Edit & Delete Confirmation States
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isSyncInProgress = useRef(false);
  const isInitialLoadFinished = useRef(false);
  const lastMutationTime = useRef<number>(0);

  // Load Initial Data
  useEffect(() => {
    const localData = loadTransactionsLocal();
    setTransactions(localData);
    const settings = loadSettings();
    if (settings.googleSheetUrl) setSheetUrl(settings.googleSheetUrl);
    
    // Mark initial load as finished to allow syncing only after data is present
    setTimeout(() => {
      isInitialLoadFinished.current = true;
    }, 1500);
  }, []);

  const handlePasscodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (passcodeInput.toUpperCase() === MASTER_PASSCODE) {
      setIsLocked(false);
      setPasscodeError(false);
    } else {
      setPasscodeError(true);
      setPasscodeInput('');
      setTimeout(() => setPasscodeError(false), 500);
    }
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => t.date.startsWith(selectedDate));
  }, [transactions, selectedDate]);

  const monthlyTransactions = useMemo(() => {
    const currentMonthPrefix = selectedDate.substring(0, 7); // "YYYY-MM"
    return transactions.filter(t => t.date.startsWith(currentMonthPrefix));
  }, [transactions, selectedDate]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return transactions
      .filter(t => 
        t.description.toLowerCase().includes(query) || 
        t.category.toLowerCase().includes(query)
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, searchQuery]);

  const cashIncomeDetails = useMemo(() => {
    return filteredTransactions
      .filter(t => t.type === 'INCOME' && t.paymentMode === 'CASH')
      .map(t => ({ id: t.id, label: `${t.incomeSource}: ${t.description}`, value: t.amount }));
  }, [filteredTransactions]);

  const cashExpenseDetails = useMemo(() => {
    return filteredTransactions
      .filter(t => t.type === 'EXPENSE') 
      .map(t => ({ id: t.id, label: t.description, value: t.amount }));
  }, [filteredTransactions]);

  const dailyStats = useMemo(() => {
    return filteredTransactions.reduce((acc, t) => {
      if (t.type === 'INCOME') {
        if (t.paymentMode === 'CASH') {
          acc.totalCashCollection += t.amount;
          if (t.incomeSource === 'SALE') acc.saleCash += t.amount;
          if (t.incomeSource === 'ALIGNMENT') acc.alignCash += t.amount;
        } else if (t.paymentMode === 'BANK') {
          if (t.incomeSource === 'SALE') acc.saleBank += t.amount;
          if (t.incomeSource === 'ALIGNMENT') acc.alignBank += t.amount;
        }
      } else {
        if (t.paymentMode === 'CASH') {
          acc.totalCashExpense += t.amount;
        }
      }
      return acc;
    }, { totalCashCollection: 0, totalCashExpense: 0, saleCash: 0, saleBank: 0, alignCash: 0, alignBank: 0 });
  }, [filteredTransactions]);

  const monthlyStats = useMemo(() => {
    return monthlyTransactions.reduce((acc, t) => {
      if (t.type === 'INCOME' && t.incomeSource === 'ALIGNMENT') {
        if (t.paymentMode === 'CASH') acc.monthlyAlignCash += t.amount;
        if (t.paymentMode === 'BANK') acc.monthlyAlignBank += t.amount;
      }
      return acc;
    }, { monthlyAlignCash: 0, monthlyAlignBank: 0 });
  }, [monthlyTransactions]);

  const pushData = useCallback(async (urlToUse: string, data: Transaction[]) => {
    if (!urlToUse || !isInitialLoadFinished.current) return;
    
    isSyncInProgress.current = true;
    setSyncStatus('SYNCING');
    const result = await syncToGoogleSheet(urlToUse, data);
    if (result.success) {
      setSyncStatus('SUCCESS');
    } else {
      setSyncStatus('ERROR');
    }
    isSyncInProgress.current = false;
  }, []);

  const mergeAndSetTransactions = useCallback((remoteData: Transaction[]) => {
    setTransactions(prev => {
      const localMap = new Map<string, Transaction>(prev.map(t => [t.id, t]));
      const remoteMap = new Map<string, Transaction>(remoteData.map(t => [t.id, t]));
      
      const allIds = new Set<string>([...localMap.keys(), ...remoteMap.keys()]);
      const merged: Transaction[] = [];
      
      allIds.forEach(id => {
        const remoteItem = remoteMap.get(id);
        const localItem = localMap.get(id);
        
        if (remoteItem) {
          merged.push(remoteItem);
        } else if (localItem) {
          merged.push(localItem);
        }
      });

      const sorted = merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      
      if (JSON.stringify(sorted) !== JSON.stringify(prev)) {
        saveTransactionsLocal(sorted);
        return sorted;
      }
      return prev;
    });
  }, []);

  const pullData = useCallback(async (urlToUse: string, force: boolean = false) => {
    const timeSinceMutation = Date.now() - lastMutationTime.current;
    if (!urlToUse || isSyncInProgress.current) return;
    if (!force && timeSinceMutation < MUTATION_PAUSE_MS) return;

    setSyncStatus('SYNCING');
    const result = await fetchFromGoogleSheet(urlToUse);
    if (result.success && result.data) {
      mergeAndSetTransactions(result.data);
      setSyncStatus('SUCCESS');
    } else if (!result.success) {
      setSyncStatus('ERROR');
    } else {
      setSyncStatus('IDLE');
    }
  }, [mergeAndSetTransactions]);

  const triggerMutation = useCallback((newTransactions: Transaction[]) => {
    lastMutationTime.current = Date.now();
    setTransactions(newTransactions);
    saveTransactionsLocal(newTransactions);
    if (sheetUrl) {
      pushData(sheetUrl, newTransactions);
    }
  }, [sheetUrl, pushData]);

  useEffect(() => {
    if (!sheetUrl || isLocked) return;
    pullData(sheetUrl);
    const interval = setInterval(() => pullData(sheetUrl), SYNC_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [sheetUrl, pullData, isLocked]);

  const handleAddTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!description || !amount) return;

    const newTransaction: Transaction = {
      id: crypto.randomUUID(),
      date: new Date(selectedDate + 'T12:00:00').toISOString(),
      description,
      amount: parseFloat(amount),
      type,
      category: category || (type === 'INCOME' ? 'Income' : 'General'),
      incomeSource: type === 'INCOME' ? incomeSource : 'NA',
      paymentMode: type === 'EXPENSE' ? 'CASH' : paymentMode,
    };

    const updated = [...transactions, newTransaction];
    triggerMutation(updated);

    setDescription('');
    setAmount('');
    setCategory('');
    
    setTimeout(() => {
        fetchInsights(updated);
    }, 0);
  };

  const handleUpdateTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTransaction) return;

    const updated = transactions.map(t => 
      t.id === editingTransaction.id ? editingTransaction : t
    );
    triggerMutation(updated);
    setEditingTransaction(null);
  };

  const handleDeleteConfirm = () => {
    if (deletingId) {
      const updated = transactions.filter(t => t.id !== deletingId);
      triggerMutation(updated);
      setDeletingId(null);
    }
  };

  const fetchInsights = useCallback(async (data: Transaction[]) => {
    if (data.length < 3) return;
    setIsLoadingInsights(true);
    const result = await getFinancialInsights(data);
    setInsights(result);
    setIsLoadingInsights(false);
  }, []);

  const handleSaveConfig = () => {
    saveSettings({ googleSheetUrl: sheetUrl });
    setShowConfig(false);
  };

  const handleJumpToDate = (dateString: string) => {
    const dateOnly = dateString.split('T')[0];
    setSelectedDate(dateOnly);
    setShowSearch(false);
    setSearchQuery('');
  };

  const inputClasses = "w-full px-4 py-3 rounded-xl border border-slate-100 bg-slate-50/50 text-slate-800 placeholder-slate-400 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:bg-white focus:border-indigo-300 transition-all font-medium shadow-sm";
  const labelClasses = "block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-1";

  if (isLocked) {
    return (
      <div className="fixed inset-0 bg-slate-50 flex items-center justify-center p-6 z-[100]">
        <div className="w-full max-w-sm text-center">
          <div className="mb-10">
            <div className="bg-indigo-600 text-white w-16 h-16 flex items-center justify-center rounded-2xl shadow-xl mx-auto mb-6 text-3xl font-black">₹</div>
            <h1 className="text-3xl font-black text-slate-900 mb-2 tracking-tight">RupeeCash</h1>
            <p className="text-slate-400 font-medium">Daily Cash Book Secured</p>
          </div>
          <form onSubmit={handlePasscodeSubmit} className={`transition-transform duration-300 ${passcodeError ? 'animate-shake' : ''}`}>
            <div className="relative mb-6">
              <input 
                type="password"
                maxLength={4}
                autoFocus
                value={passcodeInput}
                onChange={(e) => setPasscodeInput(e.target.value)}
                placeholder="Enter Passcode"
                className={`w-full text-center tracking-[1em] text-2xl font-black py-5 rounded-3xl border-2 transition-all outline-none ${
                  passcodeError 
                    ? 'border-rose-300 bg-rose-50 text-rose-600' 
                    : 'border-slate-200 bg-white text-slate-800 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10'
                }`}
              />
              {passcodeError && <p className="text-rose-500 text-xs font-bold mt-3 uppercase tracking-widest">Access Denied</p>}
            </div>
            <button 
              type="submit"
              className="w-full py-5 bg-slate-900 text-white rounded-3xl font-bold shadow-xl hover:bg-slate-800 transition-all active:scale-95 flex items-center justify-center gap-3"
            >
              <i className="fa-solid fa-lock-open text-indigo-400"></i>
              Unlock Vault
            </button>
          </form>
          <p className="mt-12 text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em]">Restricted Access Only</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 md:py-12">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <span className="bg-indigo-600 text-white w-10 h-10 flex items-center justify-center rounded-lg shadow-lg">₹</span>
              RupeeCash
            </h1>
            {sheetUrl && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border flex items-center gap-1.5 ${
                syncStatus === 'ERROR' ? 'bg-rose-100 text-rose-700 border-rose-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${syncStatus === 'SYNCING' ? 'bg-indigo-500 animate-pulse' : syncStatus === 'ERROR' ? 'bg-rose-500' : 'bg-emerald-500'}`}></span>
                {syncStatus === 'SYNCING' ? 'Syncing...' : syncStatus === 'ERROR' ? 'Sync Error' : 'Cloud Connected'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-4 bg-white p-2 rounded-2xl shadow-sm border border-slate-100 max-w-fit">
            <input 
              type="date" 
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-4 py-2 bg-slate-50 rounded-xl border-none font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowSearch(true)}
            className="p-3 text-slate-600 bg-white hover:bg-slate-50 rounded-2xl border border-slate-200 shadow-sm transition-all flex items-center gap-2 px-5 font-bold text-sm"
          >
            <i className="fa-solid fa-magnifying-glass"></i>
            Search History
          </button>
          <button 
            onClick={() => setShowConfig(true)}
            className="p-3 text-slate-600 bg-white hover:bg-slate-50 rounded-2xl border border-slate-200 shadow-sm transition-all"
          >
            <i className="fa-solid fa-gear text-xl"></i>
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6 items-start">
        <StatCard label="Cash Collection (Day)" value={dailyStats.totalCashCollection} icon="fa-coins" color="indigo" details={cashIncomeDetails} />
        <StatCard label="Cash Spends (Day)" value={dailyStats.totalCashExpense} icon="fa-receipt" color="rose" details={cashExpenseDetails} />
        <div className="flex flex-col gap-4">
          <StatCard label="Net Cash Balance" value={dailyStats.totalCashCollection - dailyStats.totalCashExpense} icon="fa-wallet" color="indigo" />
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Sale Record (Bank vs Cash)</p>
              <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-slate-500">Cash: <span className="text-emerald-600 font-bold">₹{dailyStats.saleCash.toLocaleString('en-IN')}</span></span>
                  <span className="text-xs font-semibold text-slate-500">Bank: <span className="text-slate-400 font-bold">₹{dailyStats.saleBank.toLocaleString('en-IN')}</span></span>
              </div>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-center">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Alignment Record (Bank vs Cash)</p>
              <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-slate-500">Cash: <span className="text-emerald-600 font-bold">₹{dailyStats.alignCash.toLocaleString('en-IN')}</span></span>
                  <span className="text-xs font-semibold text-slate-500">Bank: <span className="text-slate-400 font-bold">₹{dailyStats.alignBank.toLocaleString('en-IN')}</span></span>
              </div>
          </div>
        </div>
      </div>

      <div className="mb-10 px-1">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Monthly Alignment Summary</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-indigo-600 p-5 rounded-2xl shadow-lg shadow-indigo-200 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform"><i className="fa-solid fa-calendar-check text-6xl text-white"></i></div>
                  <p className="text-[10px] font-bold text-indigo-100 uppercase tracking-widest mb-1">Monthly Alignment (Cash)</p>
                  <p className="text-2xl font-black text-white">₹{monthlyStats.monthlyAlignCash.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform"><i className="fa-solid fa-building-columns text-6xl text-slate-900"></i></div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Monthly Alignment (Bank)</p>
                  <p className="text-2xl font-black text-slate-900">₹{monthlyStats.monthlyAlignBank.toLocaleString('en-IN')}</p>
              </div>
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-8">
          <div className="bg-white p-7 rounded-3xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-bold text-slate-900 mb-8 flex items-center gap-2"><i className="fa-solid fa-circle-plus text-indigo-600"></i> Record Transaction</h2>
            <form onSubmit={handleAddTransaction} className="space-y-6">
              <div className="flex p-1 bg-slate-100 rounded-xl mb-2">
                <button type="button" onClick={() => setType('INCOME')} className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${type === 'INCOME' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}>Income</button>
                <button type="button" onClick={() => setType('EXPENSE')} className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${type === 'EXPENSE' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500'}`}>Expense</button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClasses}>Source</label>
                  <select value={incomeSource} disabled={type === 'EXPENSE'} onChange={(e) => setIncomeSource(e.target.value as IncomeSource)} className={`${inputClasses} ${type === 'EXPENSE' ? 'opacity-40 cursor-not-allowed' : ''}`}>
                    <option value="SALE">Sale</option>
                    <option value="ALIGNMENT">Alignment</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div>
                  <label className={labelClasses}>Mode</label>
                  <select value={type === 'EXPENSE' ? 'CASH' : paymentMode} disabled={type === 'EXPENSE'} onChange={(e) => setPaymentMode(e.target.value as PaymentMode)} className={`${inputClasses} ${type === 'EXPENSE' ? 'opacity-40 cursor-not-allowed bg-slate-100' : ''}`}>
                    <option value="CASH">Cash</option>
                    <option value="BANK">Bank</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClasses}>Description</label>
                <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details..." className={inputClasses} required />
              </div>
              <div>
                <label className={labelClasses}>Amount (₹)</label>
                <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₹</span>
                    <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={`${inputClasses} pl-8 font-bold text-lg`} required />
                </div>
              </div>
              <button type="submit" className={`w-full py-4 ${type === 'INCOME' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-900 hover:bg-slate-800'} text-white rounded-2xl font-bold shadow-lg transition-all active:scale-[0.97] mt-2`}>
                Save {type === 'INCOME' ? 'Income' : 'Expense'}
              </button>
            </form>
          </div>
          <div className="bg-slate-900 text-white p-7 rounded-3xl shadow-xl overflow-hidden relative group">
            <div className="absolute -right-8 -top-8 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl group-hover:bg-indigo-500/20 transition-all"></div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><i className="fa-solid fa-sparkles text-indigo-400"></i> Smart Insights</h2>
            {isLoadingInsights ? <p className="text-slate-400 text-sm animate-pulse">Analyzing ledger...</p> : <div className="text-sm text-slate-300 whitespace-pre-line leading-relaxed italic">{insights || "Maintaining history helps identify seasonal business trends."}</div>}
          </div>
        </div>
        <div className="lg:col-span-8">
          <div className="flex items-center justify-between mb-6 px-1">
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><i className="fa-solid fa-calendar-day text-slate-400"></i> Daily Ledger</h2>
            <div className="flex items-center gap-2"><span className="bg-slate-100 text-slate-500 text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-widest">{filteredTransactions.length} records</span></div>
          </div>
          <TransactionTable transactions={filteredTransactions} onDeleteRequest={(id) => setDeletingId(id)} onEditRequest={(t) => setEditingTransaction({...t})} />
        </div>
      </div>

      {editingTransaction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setEditingTransaction(null)}></div>
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl relative z-10 p-8 overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-2xl text-slate-900">Edit Transaction</h3>
                <button onClick={() => setEditingTransaction(null)} className="text-slate-400 hover:text-slate-600 transition-colors"><i className="fa-solid fa-xmark text-xl"></i></button>
            </div>
            <form onSubmit={handleUpdateTransaction} className="space-y-6">
              <div className="flex p-1 bg-slate-100 rounded-xl">
                <button type="button" onClick={() => setEditingTransaction({...editingTransaction, type: 'INCOME'})} className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${editingTransaction.type === 'INCOME' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500'}`}>Income</button>
                <button type="button" onClick={() => setEditingTransaction({...editingTransaction, type: 'EXPENSE', paymentMode: 'CASH', incomeSource: 'NA'})} className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${editingTransaction.type === 'EXPENSE' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500'}`}>Expense</button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClasses}>Source</label>
                  <select value={editingTransaction.incomeSource} disabled={editingTransaction.type === 'EXPENSE'} onChange={(e) => setEditingTransaction({...editingTransaction, incomeSource: e.target.value as IncomeSource})} className={`${inputClasses} ${editingTransaction.type === 'EXPENSE' ? 'opacity-40 bg-slate-100' : ''}`}>
                    <option value="SALE">Sale</option>
                    <option value="ALIGNMENT">Alignment</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div>
                  <label className={labelClasses}>Mode</label>
                  <select value={editingTransaction.paymentMode} disabled={editingTransaction.type === 'EXPENSE'} onChange={(e) => setEditingTransaction({...editingTransaction, paymentMode: e.target.value as PaymentMode})} className={`${inputClasses} ${editingTransaction.type === 'EXPENSE' ? 'opacity-40 bg-slate-100' : ''}`}>
                    <option value="CASH">Cash</option>
                    <option value="BANK">Bank</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={labelClasses}>Description</label>
                <input type="text" value={editingTransaction.description} onChange={(e) => setEditingTransaction({...editingTransaction, description: e.target.value})} className={inputClasses} required />
              </div>
              <div>
                <label className={labelClasses}>Amount (₹)</label>
                <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₹</span>
                    <input type="number" value={editingTransaction.amount} onChange={(e) => setEditingTransaction({...editingTransaction, amount: parseFloat(e.target.value)})} className={`${inputClasses} pl-8 font-bold text-lg`} required />
                </div>
              </div>
              <div className="flex gap-4 pt-2">
                <button type="button" onClick={() => setEditingTransaction(null)} className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-all active:scale-95">Cancel</button>
                <button type="submit" className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg active:scale-95">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deletingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setDeletingId(null)}></div>
          <div className="bg-white w-full max-md rounded-3xl shadow-2xl relative z-10 p-8 text-center">
            <div className="w-16 h-16 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-6"><i className="fa-solid fa-trash-can text-2xl"></i></div>
            <h3 className="font-bold text-2xl text-slate-900 mb-2">Delete Record?</h3>
            <p className="text-slate-500 mb-8">Are you sure? This will remove the entry from your device and the cloud.</p>
            <div className="flex gap-4">
              <button onClick={() => setDeletingId(null)} className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-all active:scale-95">Cancel</button>
              <button onClick={handleDeleteConfirm} className="flex-1 py-4 bg-rose-600 text-white rounded-2xl font-bold hover:bg-rose-700 transition-all shadow-lg active:scale-95">Yes, Delete</button>
            </div>
          </div>
        </div>
      )}

      {showSearch && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-10">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setShowSearch(false)}></div>
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl relative z-10 flex flex-col max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-slate-100">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-xl text-slate-900 flex items-center gap-2"><i className="fa-solid fa-magnifying-glass text-indigo-500"></i>Ledger History</h3>
                <button onClick={() => setShowSearch(false)} className="text-slate-400 hover:text-slate-600 transition-colors"><i className="fa-solid fa-xmark text-xl"></i></button>
              </div>
              <input autoFocus type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search history by description..." className={inputClasses} />
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50">
              {searchQuery.trim() === '' ? <div className="h-full flex flex-col items-center justify-center text-slate-400 py-20"><p className="font-medium">Type description to find historical data</p></div> : searchResults.length === 0 ? <div className="h-full flex flex-col items-center justify-center text-slate-400 py-20"><p className="font-medium">No results found.</p></div> : <div className="space-y-3">{searchResults.map(result => (<button key={result.id} onClick={() => handleJumpToDate(result.date)} className="w-full text-left bg-white p-4 rounded-2xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all group"><div className="flex justify-between items-start mb-1"><span className="text-[10px] font-black text-indigo-500 uppercase px-2 py-0.5 bg-indigo-50 rounded-full group-hover:bg-indigo-600 group-hover:text-white transition-colors">{new Date(result.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span><span className={`text-sm font-black ${result.type === 'INCOME' ? 'text-emerald-600' : 'text-rose-600'}`}>₹{result.amount.toLocaleString('en-IN')}</span></div><p className="text-slate-900 font-bold">{result.description}</p></button>))}</div>}
            </div>
          </div>
        </div>
      )}

      {showConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setShowConfig(false)}></div>
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl relative z-10 p-8 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-2xl text-slate-900">Cloud Settings</h3>
                <button onClick={() => setShowConfig(false)} className="text-slate-400 hover:text-slate-600"><i className="fa-solid fa-xmark text-xl"></i></button>
            </div>
            <div className="mb-8 p-4 bg-amber-50 rounded-2xl border border-amber-100">
                <h4 className="font-bold text-amber-800 text-sm mb-2 flex items-center gap-2"><i className="fa-solid fa-triangle-exclamation"></i>Data Recovery Instructions</h4>
                <p className="text-xs text-amber-700 leading-relaxed">If data is missing from Dec 2025: 1. Restore a Jan 7th version in Google Sheets. 2. Use <b>Force Cloud Pull & Merge</b> below. 3. Use <b>Push Local to Cloud</b> to lock it in.</p>
            </div>
            <div className="space-y-6">
                <div>
                    <label className={labelClasses}>App Script URL</label>
                    <input type="url" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://script.google.com/..." className={inputClasses} />
                </div>
                <button onClick={handleSaveConfig} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg active:scale-95">Save URL</button>
                <div className="pt-4 border-t border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Maintenance Tools</p>
                    <div className="space-y-3">
                        <button disabled={!sheetUrl || syncStatus === 'SYNCING'} onClick={() => pullData(sheetUrl, true)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all flex items-center justify-center gap-3 disabled:opacity-50"><i className="fa-solid fa-cloud-arrow-down"></i>Force Cloud Pull & Merge</button>
                        <button disabled={!sheetUrl || syncStatus === 'SYNCING'} onClick={() => pushData(sheetUrl, transactions)} className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-3 disabled:opacity-50"><i className="fa-solid fa-cloud-arrow-up"></i>Push Local to Cloud (Lock-In)</button>
                    </div>
                    <p className="text-[9px] text-slate-400 mt-3 text-center">Use 'Push' only AFTER you see Dec + Jan data combined on your screen.</p>
                </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
