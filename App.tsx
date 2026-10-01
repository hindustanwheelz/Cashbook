
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Transaction, TransactionType, IncomeSource, PaymentMode } from './types';
import { 
  loadTransactionsLocal, 
  saveTransactionsLocal, 
  syncToGoogleSheet, 
  fetchFromGoogleSheet, 
  loadSettings, 
  saveSettings,
  resetToEmbeddedSettings,
  EMBEDDED_GOOGLE_SHEET_URL,
} from './services/sheetService';
import { getFinancialInsights } from './services/geminiService';
import TransactionTable from './components/TransactionTable';
import StatCard from './components/StatCard';

const SYNC_INTERVAL_MS = 30000;
const MUTATION_PAUSE_MS = 20000;
const MASTER_PASSCODE = "DLYJ";

const App: React.FC = () => {
  const [isLocked, setIsLocked] = useState(true);
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeError, setPasscodeError] = useState(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [incomeSource, setIncomeSource] = useState<IncomeSource>('SALE');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('CASH');
  const [category, setCategory] = useState('');
  
  const [syncStatus, setSyncStatus] = useState<'IDLE' | 'SYNCING' | 'ERROR' | 'SUCCESS'>('IDLE');
  const [sheetUrl, setSheetUrl] = useState('');
  const [insights, setInsights] = useState<string>('');
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const isSyncInProgress = useRef(false);
  const isInitialLoadFinished = useRef(false);
  const lastMutationTime = useRef<number>(0);

  const showToast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(prev => prev?.text === text ? null : prev);
    }, 3500);
  };

  useEffect(() => {
    const localData = loadTransactionsLocal();
    setTransactions(localData);
    const settings = loadSettings();
    const effectiveUrl = settings.googleSheetUrl || EMBEDDED_GOOGLE_SHEET_URL;
    if (effectiveUrl) {
      setSheetUrl(effectiveUrl);
    }
    setTimeout(() => { isInitialLoadFinished.current = true; }, 1500);
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

  const filteredTransactions = useMemo(() => transactions.filter(t => t.date.startsWith(selectedDate)), [transactions, selectedDate]);
  const monthlyTransactions = useMemo(() => transactions.filter(t => t.date.startsWith(selectedDate.substring(0, 7))), [transactions, selectedDate]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return transactions
      .filter(t => t.description.toLowerCase().includes(query) || t.category.toLowerCase().includes(query))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [transactions, searchQuery]);

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
      } else if (t.paymentMode === 'CASH') {
        acc.totalCashExpense += t.amount;
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
    setSyncStatus(result.success ? 'SUCCESS' : 'ERROR');
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
        if (remoteItem) merged.push(remoteItem);
        else if (localItem) merged.push(localItem);
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
    if (!urlToUse || isSyncInProgress.current) return;
    if (!force && (Date.now() - lastMutationTime.current < MUTATION_PAUSE_MS)) return;
    setSyncStatus('SYNCING');
    const result = await fetchFromGoogleSheet(urlToUse);
    if (result.success && result.data) {
      mergeAndSetTransactions(result.data);
      setSyncStatus('SUCCESS');
    } else {
      setSyncStatus(result.success ? 'IDLE' : 'ERROR');
    }
  }, [mergeAndSetTransactions]);

  const triggerMutation = useCallback((newTransactions: Transaction[]) => {
    lastMutationTime.current = Date.now();
    setTransactions(newTransactions);
    saveTransactionsLocal(newTransactions);
    if (sheetUrl) pushData(sheetUrl, newTransactions);
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
    setDescription(''); setAmount(''); setCategory('');
    setTimeout(() => fetchInsights(updated), 0);
  };

  const handleBulkImport = () => {
    if (!bulkInput.trim()) return;
    try {
      const rows = bulkInput.trim().split('\n');
      const newEntries: Transaction[] = rows.map(row => {
        const cols = row.split('\t'); // Assuming tab-separated from Sheet
        if (cols.length < 4) throw new Error("Invalid format");
        return {
          id: cols[0] || crypto.randomUUID(),
          date: cols[1],
          description: cols[2],
          amount: parseFloat(cols[3]),
          type: (cols[4] as TransactionType) || 'EXPENSE',
          category: cols[5] || 'General',
          incomeSource: (cols[6] as IncomeSource) || 'NA',
          paymentMode: (cols[7] as PaymentMode) || 'CASH'
        };
      });
      const updated = [...transactions];
      newEntries.forEach(entry => {
        if (!updated.find(t => t.id === entry.id)) updated.push(entry);
      });
      triggerMutation(updated);
      setBulkInput('');
      showToast(`Imported ${newEntries.length} items!`, 'success');
    } catch (e) {
      showToast("Import failed. Ensure you copy columns in the correct order: ID, Date, Description, Amount, Type, Category, Source, Mode.", 'error');
    }
  };

  const handleUpdateTransaction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTransaction) return;
    const updated = transactions.map(t => t.id === editingTransaction.id ? editingTransaction : t);
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
    setInsights(await getFinancialInsights(data));
    setIsLoadingInsights(false);
  }, []);

  const handleSaveConfig = () => {
    saveSettings({ googleSheetUrl: sheetUrl.trim() });
    setShowConfig(false);
    showToast('Settings saved successfully!', 'success');
    if (sheetUrl.trim()) {
      pullData(sheetUrl.trim(), true);
    }
  };

  const handleResetToEmbedded = () => {
    const res = resetToEmbeddedSettings();
    setSheetUrl(res.googleSheetUrl);
    showToast(res.googleSheetUrl ? 'Reset to embedded Google Sheet URL.' : 'Settings cleared.', 'info');
    if (res.googleSheetUrl) {
      pullData(res.googleSheetUrl, true);
    }
  };

  const handleJumpToDate = (dateString: string) => {
    setSelectedDate(dateString.split('T')[0]);
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
          <form onSubmit={handlePasscodeSubmit} className={passcodeError ? 'animate-shake' : ''}>
            <input type="password" maxLength={4} autoFocus value={passcodeInput} onChange={(e) => setPasscodeInput(e.target.value)} placeholder="Enter Passcode" className={`w-full text-center tracking-[1em] text-2xl font-black py-5 rounded-3xl border-2 outline-none mb-6 ${passcodeError ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-slate-200 bg-white'}`} />
            <button type="submit" className="w-full py-5 bg-slate-900 text-white rounded-3xl font-bold shadow-xl flex items-center justify-center gap-3 active:scale-95 transition-all"><i className="fa-solid fa-lock-open"></i> Unlock Vault</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 md:py-12">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
              <span className="bg-indigo-600 text-white w-10 h-10 flex items-center justify-center rounded-lg shadow-lg">₹</span> RupeeCash
            </h1>
            
            {/* Cloud Sync Status Indicator */}
            {syncStatus === 'SYNCING' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                <i className="fa-solid fa-arrows-rotate fa-spin text-indigo-500"></i> Syncing...
              </span>
            )}
            {syncStatus === 'SUCCESS' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200" title="Connected to Google Sheet">
                <i className="fa-solid fa-cloud-arrow-up text-emerald-600"></i> Cloud Synced
              </span>
            )}
            {syncStatus === 'ERROR' && (
              <button onClick={() => setShowConfig(true)} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 transition-colors">
                <i className="fa-solid fa-triangle-exclamation text-rose-600"></i> Sync Issue
              </button>
            )}
            {!sheetUrl && (
              <button onClick={() => setShowConfig(true)} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors">
                <i className="fa-solid fa-link-slash text-amber-600"></i> Configure Sheet
              </button>
            )}
          </div>
          <div className="mt-4 bg-white p-2 rounded-2xl shadow-sm border border-slate-100 inline-block">
            <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="px-4 py-2 bg-slate-50 rounded-xl font-bold outline-none" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <a 
            href="/rupeecash-source.zip" 
            download="rupeecash-source.zip" 
            className="p-3 text-slate-700 bg-white rounded-2xl border border-slate-200 shadow-sm flex items-center gap-2 px-4 font-bold text-sm hover:bg-slate-50 hover:text-indigo-600 transition-colors"
            title="Download full project ZIP"
          >
            <i className="fa-solid fa-download text-indigo-600"></i>
            <span className="hidden sm:inline">Download ZIP</span>
          </a>
          <button onClick={() => setShowSearch(true)} className="p-3 text-slate-600 bg-white rounded-2xl border border-slate-200 shadow-sm flex items-center gap-2 px-5 font-bold text-sm hover:bg-slate-50 transition-colors"><i className="fa-solid fa-magnifying-glass"></i> Search</button>
          <button onClick={() => setShowConfig(true)} className="p-3 text-slate-600 bg-white rounded-2xl border border-slate-200 shadow-sm hover:bg-slate-50 transition-colors relative" title="Settings">
            <i className="fa-solid fa-gear text-xl"></i>
            {Boolean(EMBEDDED_GOOGLE_SHEET_URL) && (
              <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white" title="Embedded URL Active"></span>
            )}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-10 items-start">
        <StatCard label="Cash Collection (Day)" value={dailyStats.totalCashCollection} icon="fa-coins" color="indigo" />
        <StatCard label="Cash Spends (Day)" value={dailyStats.totalCashExpense} icon="fa-receipt" color="rose" />
        <StatCard label="Net Cash Balance" value={dailyStats.totalCashCollection - dailyStats.totalCashExpense} icon="fa-wallet" color="indigo" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-8">
          <div className="bg-white p-7 rounded-3xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-bold mb-8 flex items-center gap-2"><i className="fa-solid fa-circle-plus text-indigo-600"></i> New Entry</h2>
            <form onSubmit={handleAddTransaction} className="space-y-6">
              <div className="flex p-1 bg-slate-100 rounded-xl">
                <button type="button" onClick={() => setType('INCOME')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${type === 'INCOME' ? 'bg-white text-emerald-600' : 'text-slate-500'}`}>Income</button>
                <button type="button" onClick={() => setType('EXPENSE')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${type === 'EXPENSE' ? 'bg-white text-rose-600' : 'text-slate-500'}`}>Expense</button>
              </div>
              <div><label className={labelClasses}>Description</label><input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details..." className={inputClasses} required /></div>
              <div><label className={labelClasses}>Amount (₹)</label><input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className={inputClasses} required /></div>
              <button type="submit" className={`w-full py-4 ${type === 'INCOME' ? 'bg-emerald-600' : 'bg-slate-900'} text-white rounded-2xl font-bold shadow-lg mt-2`}>Save {type === 'INCOME' ? 'Income' : 'Expense'}</button>
            </form>
          </div>
        </div>
        <div className="lg:col-span-8">
          <TransactionTable transactions={filteredTransactions} onDeleteRequest={setDeletingId} onEditRequest={setEditingTransaction} />
        </div>
      </div>

      {showSearch && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-20">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowSearch(false)}></div>
          <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl relative z-10 p-6 flex flex-col max-h-[70vh]">
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search history..." className={inputClasses + " mb-4"} autoFocus />
            <div className="flex-1 overflow-y-auto space-y-3">
              {searchResults.map(r => (
                <button key={r.id} onClick={() => handleJumpToDate(r.date)} className="w-full text-left p-4 bg-slate-50 rounded-xl hover:bg-slate-100 transition-all">
                  <div className="flex justify-between font-bold mb-1"><span className="text-xs text-indigo-500">{new Date(r.date).toDateString()}</span><span className={r.type === 'INCOME' ? 'text-emerald-600' : 'text-rose-600'}>₹{r.amount}</span></div>
                  <div className="text-sm font-medium">{r.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {showConfig && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowConfig(false)}></div>
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl relative z-10 p-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-2xl text-slate-900">Settings & Cloud Sync</h3>
              <button onClick={() => setShowConfig(false)} className="text-slate-400 hover:text-slate-600 p-2">
                <i className="fa-solid fa-xmark text-xl"></i>
              </button>
            </div>

            <div className="space-y-6">
              {/* Embedded Status Notification */}
              {EMBEDDED_GOOGLE_SHEET_URL ? (
                <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs leading-relaxed">
                  <div className="font-bold text-sm mb-1 flex items-center gap-1.5 text-emerald-900">
                    <i className="fa-solid fa-circle-check text-emerald-600"></i> Embedded URL Active
                  </div>
                  This URL is embedded in the application code. Any new device opening this web app connects automatically to your Google Sheet!
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs leading-relaxed">
                  <div className="font-bold text-sm mb-1 flex items-center gap-1.5 text-indigo-800">
                    <i className="fa-solid fa-code text-indigo-600"></i> Embedded URL Ready
                  </div>
                  To connect all devices automatically without typing this URL every time, set <code className="bg-white/80 px-1 py-0.5 rounded font-mono text-[11px]">EMBEDDED_GOOGLE_SHEET_URL</code> in <code className="bg-white/80 px-1 py-0.5 rounded font-mono text-[11px]">services/sheetService.ts</code>.
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className={labelClasses}>Google Apps Script Web App URL</label>
                  {EMBEDDED_GOOGLE_SHEET_URL && sheetUrl !== EMBEDDED_GOOGLE_SHEET_URL && (
                    <button type="button" onClick={handleResetToEmbedded} className="text-[11px] font-bold text-indigo-600 hover:underline">
                      Reset to Embedded
                    </button>
                  )}
                </div>
                <input 
                  type="url" 
                  value={sheetUrl} 
                  onChange={(e) => setSheetUrl(e.target.value)} 
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className={inputClasses} 
                />
              </div>

              <div className="flex gap-2">
                <button onClick={handleSaveConfig} className="flex-1 py-3.5 bg-indigo-600 text-white rounded-xl font-bold shadow-md hover:bg-indigo-700 transition-colors">
                  Save Settings
                </button>
                <button onClick={() => pullData(sheetUrl, true)} className="px-4 py-3.5 border-2 border-slate-200 rounded-xl font-bold text-sm hover:bg-slate-50 transition-colors" title="Fetch now">
                  <i className="fa-solid fa-rotate mr-1"></i> Pull
                </button>
              </div>

              <div className="pt-6 border-t">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4">Manual Bulk Import</p>
                <textarea value={bulkInput} onChange={(e) => setBulkInput(e.target.value)} placeholder="Paste rows from Google Sheet here..." className={inputClasses + " h-32 text-xs font-mono mb-3"}></textarea>
                <button onClick={handleBulkImport} className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors"><i className="fa-solid fa-file-import"></i> Import Rows</button>
                <p className="text-[9px] text-slate-400 mt-2">Use this to manually re-add data if ever needed.</p>
              </div>

              <div className="pt-6 border-t">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Project Backup & Source Code</p>
                <a 
                  href="/rupeecash-source.zip" 
                  download="rupeecash-source.zip"
                  className="w-full py-3.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors border border-indigo-200"
                >
                  <i className="fa-solid fa-file-zipper text-indigo-600"></i> Download Project ZIP (.zip)
                </a>
                <p className="text-[10px] text-slate-400 mt-2">Includes full source code with your embedded Google Sheet URL and instructions to run locally or push to GitHub.</p>
              </div>

              <div className="pt-6 border-t flex flex-col gap-3">
                <button onClick={() => pullData(sheetUrl, true)} className="w-full py-3 border-2 border-slate-200 rounded-xl font-bold text-sm hover:bg-slate-50 transition-colors">Force Cloud Pull & Merge</button>
                <button onClick={() => pushData(sheetUrl, transactions)} className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors">Push Local to Cloud</button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {toastMessage && (
        <div className={`fixed bottom-6 right-6 z-[120] px-5 py-3.5 rounded-2xl shadow-xl flex items-center gap-3 text-sm font-semibold transition-all ${
          toastMessage.type === 'success' ? 'bg-emerald-900 text-emerald-100' :
          toastMessage.type === 'error' ? 'bg-rose-900 text-rose-100' :
          'bg-slate-900 text-slate-100'
        }`}>
          <i className={`fa-solid ${
            toastMessage.type === 'success' ? 'fa-circle-check text-emerald-400' :
            toastMessage.type === 'error' ? 'fa-circle-exclamation text-rose-400' :
            'fa-circle-info text-indigo-400'
          }`}></i>
          <span>{toastMessage.text}</span>
          <button onClick={() => setToastMessage(null)} className="ml-2 opacity-60 hover:opacity-100">
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>
      )}

      {deletingId && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setDeletingId(null)}></div>
          <div className="bg-white p-8 rounded-3xl shadow-xl relative z-10 text-center max-w-xs">
            <p className="font-bold text-lg mb-6">Delete this record?</p>
            <div className="flex gap-3">
              <button onClick={() => setDeletingId(null)} className="flex-1 py-3 bg-slate-100 rounded-xl font-bold">Cancel</button>
              <button onClick={handleDeleteConfirm} className="flex-1 py-3 bg-rose-600 text-white rounded-xl font-bold">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
