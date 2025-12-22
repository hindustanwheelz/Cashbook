
import { Transaction } from "../types";

const LOCAL_STORAGE_KEY = 'rupeecash_transactions';
const SETTINGS_KEY = 'rupeecash_settings';

export const saveTransactionsLocal = (transactions: Transaction[]) => {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(transactions));
};

export const loadTransactionsLocal = (): Transaction[] => {
  const data = localStorage.getItem(LOCAL_STORAGE_KEY);
  try {
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error("Local load error", e);
    return [];
  }
};

export const saveSettings = (settings: { googleSheetUrl: string }) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

export const loadSettings = () => {
  const data = localStorage.getItem(SETTINGS_KEY);
  try {
    return data ? JSON.parse(data) : { googleSheetUrl: '' };
  } catch {
    return { googleSheetUrl: '' };
  }
};

export const syncToGoogleSheet = async (url: string, transactions: Transaction[]): Promise<{success: boolean, message: string}> => {
  if (!url) return { success: false, message: "URL not configured." };
  
  // Note: App-level logic now handles checking if empty sync is valid (intentional deletion)
  // versus accidental (initial load failure).

  try {
    // We use text/plain to avoid CORS preflight issues with Google Apps Script
    const response = await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      cache: 'no-cache',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'sync', data: transactions })
    });
    
    // Note: no-cors mode always results in opaque responses, so we assume success if no error is thrown
    return { success: true, message: "Synced successfully." };
  } catch (error) {
    console.error("Sync Error:", error);
    return { success: false, message: "Sync failed." };
  }
};

export const fetchFromGoogleSheet = async (url: string): Promise<{success: boolean, data?: Transaction[], message: string}> => {
  if (!url) return { success: false, message: "URL not configured." };
  try {
    const response = await fetch(`${url}?action=get`);
    if (!response.ok) throw new Error("Network error");
    const result = await response.json();
    if (Array.isArray(result)) return { success: true, data: result, message: "Fetched." };
    return { success: false, message: "Invalid format." };
  } catch (error) {
    console.error("Fetch Error:", error);
    return { success: false, message: "Fetch failed." };
  }
};

export const GOOGLE_APPS_SCRIPT_TEMPLATE = `
function doGet(e) {
  var action = e.parameter.action;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  if (action === 'get') {
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return ContentService.createTextOutput(JSON.stringify([])).setMimeType(ContentService.MimeType.JSON);
    var headers = data.shift();
    var json = data.map(function(row) {
      return {
        id: String(row[0]),
        date: row[1] instanceof Date ? row[1].toISOString() : String(row[1]),
        description: String(row[2]),
        amount: Number(row[3]),
        type: String(row[4]),
        category: String(row[5]),
        incomeSource: String(row[6] || 'NA'),
        paymentMode: String(row[7] || 'NA')
      };
    });
    return ContentService.createTextOutput(JSON.stringify(json)).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var params = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getActiveSheet();
    if (params.action === 'sync') {
      if (!params.data || !Array.isArray(params.data)) {
         return ContentService.createTextOutput(JSON.stringify({result: 'error', message: 'No data'})).setMimeType(ContentService.MimeType.JSON);
      }
      
      sheet.clear();
      var headers = ['ID', 'Date', 'Description', 'Amount', 'Type', 'Category', 'Income Source', 'Payment Mode'];
      sheet.appendRow(headers);
      if (params.data.length > 0) {
        var rows = params.data.map(function(t) {
          return [t.id, t.date, t.description, t.amount, t.type, t.category, t.incomeSource, t.paymentMode];
        });
        sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
      }
      return ContentService.createTextOutput(JSON.stringify({result: 'success'})).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (f) {
    return ContentService.createTextOutput(JSON.stringify({result: 'error', error: f.toString()})).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
`;
