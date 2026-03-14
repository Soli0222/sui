import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  BillingResponse,
  CreditCardsResponse,
  DashboardResponse,
  LoansResponse,
  RecurringItemsResponse,
  TransactionsResponse,
} from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { yearMonthSchema } from "../helpers";
import { z } from "zod";

export function registerAnalysisPrompts(server: McpServer, apiClient: SuiApiClient) {
  server.prompt(
    "budget-advice",
    "現在の家計状況に基づく改善アドバイスを生成する",
    {},
    async () => {
      const [dashboard, recurring, creditCards, loans] = await Promise.all([
        apiClient.get<DashboardResponse>("/api/dashboard"),
        apiClient.get<RecurringItemsResponse>("/api/recurring-items"),
        apiClient.get<CreditCardsResponse>("/api/credit-cards"),
        apiClient.get<LoansResponse>("/api/loans"),
      ]);

      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "以下の家計データを分析し、日本語で具体的な改善アドバイスをしてください。",
              "",
              "分析の観点：",
              "- 収入に対する固定費の割合",
              "- クレジットカードの利用傾向",
              "- ローンの返済負担",
              "- 残高がマイナスになるリスク",
              "- 節約できそうな項目",
              "",
              "【ダッシュボード】",
              JSON.stringify(dashboard, null, 2),
              "",
              "【固定収支】",
              JSON.stringify(recurring, null, 2),
              "",
              "【クレジットカード】",
              JSON.stringify(creditCards, null, 2),
              "",
              "【ローン】",
              JSON.stringify(loans, null, 2),
            ].join("\n"),
          },
        }],
      };
    },
  );

  server.prompt(
    "forecast-analysis",
    "残高予測の分析と改善提案を生成する",
    {
      months: z.number().int().min(1).max(24).optional().describe("分析対象月数"),
    },
    async ({ months = 6 }) => {
      const dashboard = await apiClient.get<DashboardResponse>("/api/dashboard");
      const relevantEvents = dashboard.forecast.slice(0, months * 10);

      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `以下の残高予測データを分析し、今後 ${months} ヶ月の資金繰りリスクと改善提案を日本語でまとめてください。`,
              "",
              "含めてほしい観点：",
              "1. 合計残高が落ち込む時期",
              "2. 残高不足の可能性がある口座",
              "3. 影響の大きい定期収支や請求",
              "4. 具体的な対策案",
              "",
              "【ダッシュボード】",
              JSON.stringify({
                ...dashboard,
                forecast: relevantEvents,
              }, null, 2),
            ].join("\n"),
          },
        }],
      };
    },
  );

  server.prompt(
    "expense-breakdown",
    "カテゴリ別支出内訳の分析を生成する",
    {
      month: yearMonthSchema.describe("対象月（YYYY-MM）"),
    },
    async ({ month }) => {
      const [transactions, billing, recurring] = await Promise.all([
        apiClient.get<TransactionsResponse>("/api/transactions?page=1&limit=200"),
        apiClient.get<BillingResponse>(`/api/billings?month=${month}`),
        apiClient.get<RecurringItemsResponse>("/api/recurring-items"),
      ]);

      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `${month} の支出内訳を日本語で分析してください。`,
              "",
              "前提：このシステムには厳密なカテゴリがないため、説明文・固定費・クレジットカード請求から支出の傾向を推定してください。",
              "",
              "出力に含めてほしい内容：",
              "1. 主な支出項目の分類と合計",
              "2. 固定費と変動費の傾向",
              "3. 特徴的な支出や改善余地",
              "",
              "【取引履歴】",
              JSON.stringify(transactions, null, 2),
              "",
              "【請求データ】",
              JSON.stringify(billing, null, 2),
              "",
              "【固定収支】",
              JSON.stringify(recurring, null, 2),
            ].join("\n"),
          },
        }],
      };
    },
  );
}
