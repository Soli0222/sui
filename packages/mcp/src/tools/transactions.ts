import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  BalanceHistoryResponse,
  CreateTransactionPayload,
  Transaction,
  TransactionsResponse,
  UpdateTransactionPayload,
} from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { formatBalanceHistory, formatTransactionsText } from "../format";
import {
  booleanFlagSchema,
  confirmDeleteSchema,
  createToolAnnotations,
  dateSchema,
  deleteToolAnnotations,
  formatDeletePreview,
  limitSchema,
  pageSchema,
  positiveMoneySchema,
  readOnlyToolAnnotations,
  textContent,
  updateToolAnnotations,
  uuidSchema,
} from "../helpers";
import { z } from "zod";

const transactionPayload = {
  accountId: uuidSchema.optional().describe("対象口座の ID（振替では省略可）"),
  date: dateSchema.describe("取引日（YYYY-MM-DD）"),
  type: z.enum(["income", "expense", "transfer"]).describe("取引種別"),
  description: z.string().min(1).max(200).describe("取引の説明"),
  amount: positiveMoneySchema.describe("金額（正の整数、円単位）"),
  transferToAccountId: uuidSchema.optional().describe("振替先口座の ID（振替では省略可）"),
};

const transactionPayloadSchema = z.object({
  accountId: uuidSchema.optional(),
  date: dateSchema,
  type: z.enum(["income", "expense", "transfer"]),
  description: z.string().min(1).max(200),
  amount: positiveMoneySchema,
  transferToAccountId: uuidSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.type === "transfer") {
    if (!value.accountId && !value.transferToAccountId) {
      ctx.addIssue({
        code: "custom",
        path: ["accountId"],
        message: "type が transfer の場合は accountId または transferToAccountId が必須です",
      });
    }
    if (value.accountId && value.accountId === value.transferToAccountId) {
      ctx.addIssue({
        code: "custom",
        path: ["transferToAccountId"],
        message: "振替元口座と振替先口座は別の口座を指定してください",
      });
    }
  } else if (!value.accountId) {
    ctx.addIssue({
      code: "custom",
      path: ["accountId"],
      message: "accountId は必須です",
    });
  }
  if (value.type !== "transfer" && value.transferToAccountId) {
    ctx.addIssue({
      code: "custom",
      path: ["transferToAccountId"],
      message: "transferToAccountId は振替時のみ指定できます",
    });
  }
});

async function findTransactionForDeletion(apiClient: SuiApiClient, id: string) {
  const limit = 100;
  let page = 1;

  while (true) {
    const data = await apiClient.get<TransactionsResponse>(`/api/transactions?page=${page}&limit=${limit}`);
    const transaction = data.items.find((item) => item.id === id);
    if (transaction) {
      return transaction;
    }
    if (page * limit >= data.total || data.items.length === 0) {
      return null;
    }
    page += 1;
  }
}

function formatTransactionDeleteSummary(transaction: Transaction) {
  const account =
    transaction.type === "transfer"
      ? `${transaction.accountName ?? transaction.accountId ?? "未設定"} -> ${transaction.transferToAccountName ?? transaction.transferToAccountId ?? "未設定"}`
      : transaction.accountName ?? transaction.accountId ?? "未設定";

  return `${transaction.date} ${transaction.description} ¥${transaction.amount.toLocaleString("ja-JP")}（${account}）`;
}

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
    readOnlyToolAnnotations,
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
    transactionPayload,
    createToolAnnotations,
    async (args) => {
      const parsed = transactionPayloadSchema.parse(args);

      const result = await apiClient.post<Transaction>("/api/transactions", parsed as CreateTransactionPayload);
      return textContent(`取引を記録しました: ${result.description} ¥${result.amount.toLocaleString("ja-JP")}（${result.date}）`);
    },
  );

  server.tool(
    "update_transaction",
    "既存の取引を更新する",
    {
      id: uuidSchema.describe("取引 ID"),
      ...transactionPayload,
    },
    updateToolAnnotations,
    async ({ id, ...args }) => {
      const payload = transactionPayloadSchema.parse(args);
      const result = await apiClient.put<Transaction>(`/api/transactions/${id}`, payload as UpdateTransactionPayload);
      return textContent(`取引を更新しました: ${result.description} ¥${result.amount.toLocaleString("ja-JP")}（${result.date}）`);
    },
  );

  server.tool(
    "delete_transaction",
    "手動で登録された取引を削除する（soft delete。口座残高は自動的に元に戻る。予測確定で自動生成された取引は削除不可）。confirm が true でない場合は API の DELETE を呼ばず、対象取引の要約と再実行案内だけを返す。confirm: true の場合のみ削除を実行する",
    {
      id: uuidSchema.describe("取引 ID"),
      confirm: confirmDeleteSchema,
    },
    deleteToolAnnotations,
    async ({ id, confirm }) => {
      if (confirm !== true) {
        const transaction = await findTransactionForDeletion(apiClient, id);
        return textContent(formatDeletePreview(
          "取引",
          id,
          transaction ? formatTransactionDeleteSummary(transaction) : null,
        ));
      }

      await apiClient.delete(`/api/transactions/${id}`);
      return textContent(`取引を削除しました: ${id}`);
    },
  );

  server.tool(
    "get_balance_history",
    "口座の過去の残高推移を取得します。期間と口座でフィルタ可能です。",
    {
      accountId: uuidSchema.optional().describe("口座ID（省略時は全口座合算）"),
      startDate: dateSchema.optional().describe("開始日 (YYYY-MM-DD)"),
      endDate: dateSchema.optional().describe("終了日 (YYYY-MM-DD)"),
      applyOffset: booleanFlagSchema.optional().describe("残高オフセットを適用するか"),
    },
    readOnlyToolAnnotations,
    async ({ accountId, startDate, endDate, applyOffset = true }) => {
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
      params.set("applyOffset", String(applyOffset));

      const query = params.toString();
      const data = await apiClient.get<BalanceHistoryResponse>(
        query ? `/api/transactions/balance-history?${query}` : "/api/transactions/balance-history",
      );
      return textContent(formatBalanceHistory(data));
    },
  );
}
