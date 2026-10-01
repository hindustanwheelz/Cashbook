# RupeeCash - Daily Cash Book

A streamlined daily cash book and income/expenditure tracker with real-time Google Sheets synchronization and financial insights.

## Features
- **Daily Cash Flow**: Track daily cash collections, expenses, and net cash balance.
- **Auto-Sync to Google Sheets**: Seamless bidirectional sync with your Google Sheet via Google Apps Script Web App.
- **Embedded Web App URL**: Your Google Apps Script Web App URL is embedded so any device automatically connects out of the box.
- **Secured Vault**: Passcode-protected access (`DLYJ`).
- **AI Financial Insights**: Financial summaries powered by the Gemini API.

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment (Optional)
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
Add your optional `GEMINI_API_KEY` for AI features. The Google Apps Script URL is already embedded in `services/sheetService.ts`.

### 3. Run Development Server
```bash
npm run dev
```
Open your browser at `http://localhost:3000`.

### 4. Build for Production
```bash
npm run build
```

## Default Passcode
- Master Vault Passcode: `DLYJ`
