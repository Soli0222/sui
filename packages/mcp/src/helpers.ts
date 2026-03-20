import type { BillingResponse, DashboardResponse } from "@sui/shared";
import { z } from "zod";

export const uuidSchema = z.string().uuid();
export const yearMonthSchema = z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM形式で指定してください");
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD形式で指定してください");
export const pageSchema = z.number().int().min(1).default(1);
export const limitSchema = z.number().int().min(1).max(100).default(50);
export const moneySchema = z.number().int();
export const nonNegativeMoneySchema = z.number().int().min(0);
export const positiveMoneySchema = z.number().int().positive();

export function textContent(text: string) {
  return {
    content: [{ type: "text" as const, text }],
  };
}

export function jsonResource(uri: string, data: unknown) {
  return {
    contents: [{
      uri,
      mimeType: "application/json",
      text: JSON.stringify(data, null, 2),
    }],
  };
}

export function textResource(uri: string, text: string) {
  return {
    contents: [{
      uri,
      mimeType: "text/plain",
      text,
    }],
  };
}

export function buildMonthlyReportPrompt(month: string, dashboard: DashboardResponse, billing: BillingResponse, accounts: unknown) {
  return [
    `以下のデータをもとに、${month} の月次収支レポートを日本語で作成してください。`,
    "",
    "レポートには以下を含めてください：",
    "1. 当月の確定済み収入・支出の一覧と合計",
    "2. クレジットカードの請求状況",
    "3. 口座残高の変動",
    "4. 特筆すべき項目やアドバイス",
    "",
    "【ダッシュボードデータ】",
    JSON.stringify(dashboard, null, 2),
    "",
    "【請求データ】",
    JSON.stringify(billing, null, 2),
    "",
    "【口座一覧】",
    JSON.stringify(accounts, null, 2),
  ].join("\n");
}
