export type TransactionType = 'INCOME' | 'EXPENSE';
export type IncomeSource = 'SALE' | 'ALIGNMENT' | 'OTHER' | 'NA';
export type PaymentMode = 'CASH' | 'BANK' | 'NA';

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: TransactionType;
  category: string;
  incomeSource: IncomeSource;
  paymentMode: PaymentMode;
}

export interface CashBookSummary {
  totalIncome: number;
  totalExpense: number;
  balance: number;
}

export interface SyncSettings {
  googleSheetUrl: string;
  autoSync: boolean;
}