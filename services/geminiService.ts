import { GoogleGenAI } from "@google/genai";
import { Transaction } from "../types";

export const getFinancialInsights = async (transactions: Transaction[]) => {
  if (transactions.length === 0) return "Add some transactions to get AI insights!";

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = 'gemini-3-flash-preview';

  const transactionContext = transactions.map(t => 
    `${t.date}: ${t.type} - ₹${t.amount} for "${t.description}" (${t.category})`
  ).join('\n');

  const prompt = `
    Analyze the following daily cash book transactions (all amounts in Indian Rupees ₹):
    
    ${transactionContext}
    
    Provide 3 concise and helpful financial insights in plain text (bullet points). 
    Focus on spending patterns, potential savings, and a quick summary. Keep it brief and friendly.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: "You are a professional Indian financial advisor. Use ₹ symbol for currency. Provide short, actionable advice.",
        temperature: 0.7,
      }
    });

    return response.text || "Could not generate insights at this time.";
  } catch (error) {
    console.error("Gemini Insight Error:", error);
    return "Insights are currently unavailable.";
  }
};

export const suggestCategory = async (description: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = 'gemini-3-flash-preview';

  try {
    const response = await ai.models.generateContent({
      model,
      contents: `Suggest a one-word category for this transaction description: "${description}". Output only the category name.`,
      config: {
        temperature: 0,
      }
    });
    return response.text?.trim() || "General";
  } catch {
    return "General";
  }
};