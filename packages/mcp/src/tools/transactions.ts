import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  BalanceHistoryResponse,
  CreateTransactionPayload,
  Transaction,
  TransactionsResponse,
} from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { formatBalanceHistory, formatTransactionsText } from "../format";
import { dateSchema, limitSchema, pageSchema, positiveMoneySchema, textContent, uuidSchema } from "../helpers";
import { z } from "zod";

export function registerTransactionTools(server: McpServer, apiClient: SuiApiClient) {
  server.tool(
    "list_transactions",
    "取引履歴を取得する",
    {
      page: pageSchema.optional().describe("ページ番号"),
      limit: limitSchema.optional().describe("取得件数"),
      accountId: uuidSchema.optional().describe("口座 ID で絞り込む"),
      startDate: dateSchema.optional().describe("開始日（YYYY-MM-DD）"),
      endDate: dateSchema.optional().describe("終了日（YYYY-MM-DD）"),
    },
    async ({ page = 1, limit = 50, accountId, startDate, endDate }) => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (accountId) {
        params.set("accountId", accountId);
      }
      if (startDate) {
        params.set("startDate", startDate);
      }
      if (endDate) {
        params.set("endDate", endDate);
      }
      const data = await apiClient.get<TransactionsResponse>(`/api/transactions?${params.toString()}`);
      return textContent(formatTransactionsText(data));
    },
  );

  server.tool(
    "create_transaction",
    "手動で取引（入金・出金・振替）を記録する",
    {
      accountId: uuidSchema.describe("対象口座の ID"),
      date: dateSchema.describe("取引日（YYYY-MM-DD）"),
      type: z.enum(["income", "expense", "transfer"]).describe("取引種別"),
      description: z.string().min(1).max(200).describe("取引の説明"),
      amount: positiveMoneySchema.describe("金額（正の整数、円単位）"),
      transferToAccountId: uuidSchema.optional().describe("振替先口座の ID"),
    },
    async (args) => {
      const parsed = z.object({
        accountId: uuidSchema,
        date: dateSchema,
        type: z.enum(["income", "expense", "transfer"]),
        description: z.string().min(1).max(200),
        amount: positiveMoneySchema,
        transferToAccountId: uuidSchema.optional(),
      }).superRefine((value, ctx) => {
        if (value.type === "transfer" && !value.transferToAccountId) {
          ctx.addIssue({
            code: "custom",
            path: ["transferToAccountId"],
            message: "type が transfer の場合は transferToAccountId が必須です",
          });
        }
        if (value.type !== "transfer" && value.transferToAccountId) {
          ctx.addIssue({
            code: "custom",
            path: ["transferToAccountId"],
            message: "transferToAccountId は振替時のみ指定できます",
          });
        }
      }).parse(args);

      const result = await apiClient.post<Transaction>("/api/transactions", parsed as CreateTransactionPayload);
      return textContent(`取引を記録しました: ${result.description} ¥${result.amount.toLocaleString("ja-JP")}（${result.date}）`);
    },
  );

  server.tool(
    "get_balance_history",
    "口座の過去の残高推移を取得します。期間と口座でフィルタ可能です。",
    {
      accountId: uuidSchema.optional().describe("口座ID（省略時は全口座合算）"),
      startDate: dateSchema.optional().describe("開始日 (YYYY-MM-DD)"),
      endDate: dateSchema.optional().describe("終了日 (YYYY-MM-DD)"),
    },
    async ({ accountId, startDate, endDate }) => {
      const params = new URLSearchParams();
      if (accountId) {
        params.set("accountId", accountId);
      }
      if (startDate) {
        params.set("startDate", startDate);
      }
      if (endDate) {
        params.set("endDate", endDate);
      }

      const query = params.toString();
      const data = await apiClient.get<BalanceHistoryResponse>(
        query ? `/api/transactions/balance-history?${query}` : "/api/transactions/balance-history",
      );
      return textContent(formatBalanceHistory(data));
    },
  );
}
