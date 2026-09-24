import { convertMinorUnitToJpy } from "@sui/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  AccountsResponse,
  BalanceHistoryResponse,
  CreateTransactionPayload,
  Transaction,
  TransactionsResponse,
  UpdateTransactionPayload,
} from "@sui/shared";
import type { SuiApiClient } from "../client";
import { formatBalanceHistory, formatCurrency, formatTransactionsText } from "../format";
import {
  booleanFlagSchema,
  confirmDeleteSchema,
  createToolAnnotations,
  dateSchema,
  deleteToolAnnotations,
  deletePreview,
  limitSchema,
  pageSchema,
  positiveMoneySchema,
  readOnlyToolAnnotations,
  textContent,
  updateToolAnnotations,
  uuidSchema,
  registerTool,
} from "../helpers";
import { z } from "zod";

const transactionPayload = {
  accountId: uuidSchema.nullable().optional().describe("対象口座の ID（振替では省略可）。取得元: list_accounts.accounts[].id"),
  date: dateSchema.describe("取引日（YYYY-MM-DD）"),
  type: z.enum(["income", "expense", "transfer"]).describe("取引種別"),
  description: z.string().min(1).max(200).describe("取引の説明"),
  amount: positiveMoneySchema.describe("金額：対象通貨の最小単位の整数（JPYは円、USD/EURはセント。USD 250.00は25000）"),
  transferToAccountId: uuidSchema.nullable().optional().describe("振替先口座の ID（振替では省略可）。取得元: list_accounts.accounts[].id"),
};

const transactionPayloadSchema = z.object({
  accountId: uuidSchema.nullable().optional().describe("取得元: list_accounts.accounts[].id"),
  date: dateSchema,
  type: z.enum(["income", "expense", "transfer"]),
  description: z.string().min(1).max(200),
  amount: positiveMoneySchema.describe("金額：対象通貨の最小単位の整数（JPYは円、USD/EURはセント。USD 250.00は25000）"),
  transferToAccountId: uuidSchema.nullable().optional().describe("取得元: list_accounts.accounts[].id"),
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
  const data = await apiClient.get<TransactionsResponse>(`/api/transactions?id=${id}`);
  return data.items[0] ?? null;
}

/**
 * update_transaction / delete_transaction に必要な最小限のフィールドだけを返す。
 * 口座オブジェクトなどのネストした表現を含めないことで、大量一覧でも ID が省略されにくくする。
 */
function withTransactionCurrency(transaction: Transaction, accounts: AccountsResponse): Transaction {
  const account = accounts.find((item) => item.id === (transaction.accountId ?? transaction.transferToAccountId));
  const currencyCode = transaction.currencyCode ?? account?.currencyCode ?? "JPY";
  return {
    ...transaction,
    date: transaction.date.slice(0, 10),
    currencyCode,
    amountJpy: transaction.amountJpy ?? convertMinorUnitToJpy(transaction.amount, currencyCode, account?.exchangeRateToJpy ?? 1),
  };
}

function toTransactionSummary(transaction: Transaction) {
  return {
    id: transaction.id,
    date: transaction.date,
    type: transaction.type,
    description: transaction.description,
    amount: transaction.amount,
    amountJpy: transaction.amountJpy,
    currencyCode: transaction.currencyCode,
    accountId: transaction.accountId,
    transferToAccountId: transaction.transferToAccountId,
    forecastEventId: transaction.forecastEventId,
  };
}

function toTransactionListStructuredContent(data: TransactionsResponse) {
  return {
    items: data.items.map(toTransactionSummary),
    page: data.page,
    limit: data.limit,
    total: data.total,
    complete: data.total <= data.limit && data.page === 1,
    nextPage: data.page * data.limit < data.total ? data.page + 1 : null,
    nextPageTool: "list_transactions（同じフィルタと limit、nextPage を page に指定）",
  };
}

function formatTransactionDeleteSummary(transaction: Transaction) {
  const account =
    transaction.type === "transfer"
      ? `${transaction.accountName ?? transaction.accountId ?? "未設定"} -> ${transaction.transferToAccountName ?? transaction.transferToAccountId ?? "未設定"}`
      : transaction.accountName ?? transaction.accountId ?? "未設定";

  return `${transaction.date} ${transaction.description} ${formatCurrency(transaction.amount, transaction.currencyCode)}（${account}）`;
}

export function registerTransactionTools(server: McpServer, apiClient: SuiApiClient) {
  registerTool(server,
    "list_transactions",
    "取引履歴を取得する。structuredContent に取引 ID を含む一覧を返すため、update_transaction / delete_transaction に必要な ID はここから取得できる",
    {
      page: pageSchema.optional().describe("ページ番号"),
      limit: limitSchema.optional().describe("取得件数"),
      accountId: uuidSchema.optional().describe("口座 ID で絞り込む。取得元: list_accounts.accounts[].id"),
      id: uuidSchema.optional().describe("取引 ID で絞り込む。取得元: list_transactions.items[].id"),
      type: z.enum(["income", "expense", "transfer"]).optional().describe("取引種別で絞り込む"),
      startDate: dateSchema.optional().describe("開始日（YYYY-MM-DD）"),
      endDate: dateSchema.optional().describe("終了日（YYYY-MM-DD）"),
    },
    readOnlyToolAnnotations,
    async ({ page = 1, limit = 50, accountId, id, type, startDate, endDate }) => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (accountId) {
        params.set("accountId", accountId);
      }
      if (id) params.set("id", id);
      if (type) params.set("type", type);
      if (startDate) {
        params.set("startDate", startDate);
      }
      if (endDate) {
        params.set("endDate", endDate);
      }
      const data = await apiClient.get<TransactionsResponse>(`/api/transactions?${params.toString()}`);
      return textContent(formatTransactionsText(data), toTransactionListStructuredContent(data));
    },
  );

  registerTool(server,
    "create_transaction",
    "手動で取引（入金・出金・振替）を記録する",
    transactionPayload,
    createToolAnnotations,
    async (args) => {
      const parsed = transactionPayloadSchema.parse(args);

      const accounts = await apiClient.get<AccountsResponse>("/api/accounts");
      const result = withTransactionCurrency(await apiClient.post<Transaction>("/api/transactions", parsed as CreateTransactionPayload), accounts);
      return textContent(`取引を記録しました: ${result.description} ${formatCurrency(result.amount, result.currencyCode)}（${result.date}）`, { transaction: toTransactionSummary(result) });
    },
  );

  registerTool(server,
    "update_transaction",
    "既存の取引を更新する",
    {
      id: uuidSchema.describe("取引 ID。取得元: list_transactions.items[].id"),
      ...transactionPayload,
    },
    updateToolAnnotations,
    async ({ id, ...args }) => {
      const payload = transactionPayloadSchema.parse(args);
      const accounts = await apiClient.get<AccountsResponse>("/api/accounts");
      const result = withTransactionCurrency(await apiClient.put<Transaction>(`/api/transactions/${id}`, payload as UpdateTransactionPayload), accounts);
      return textContent(`取引を更新しました: ${result.description} ${formatCurrency(result.amount, result.currencyCode)}（${result.date}）`, { transaction: toTransactionSummary(result) });
    },
  );

  registerTool(server,
    "delete_transaction",
    "手動で登録された取引を削除する（soft delete。口座残高は自動的に元に戻る。予測確定で自動生成された取引は削除不可）。confirm が true でない場合は API の DELETE を呼ばず、対象取引の要約と再実行案内だけを返す。confirm: true の場合のみ削除を実行する",
    {
      id: uuidSchema.describe("取引 ID。取得元: list_transactions.items[].id"),
      confirm: confirmDeleteSchema,
    },
    deleteToolAnnotations,
    async ({ id, confirm }) => {
      if (confirm !== true) {
        const transaction = await findTransactionForDeletion(apiClient, id);
        return deletePreview(
          "取引",
          id,
          transaction ? formatTransactionDeleteSummary(transaction) : null,
        );
      }

      await apiClient.delete(`/api/transactions/${id}`);
      return textContent(`取引を削除しました: ${id}`, { id, deleted: true, executed: true });
    },
  );

  registerTool(server,
    "get_balance_history",
    "口座の過去の残高推移を取得します。期間と口座でフィルタ可能です。",
    {
      accountId: uuidSchema.optional().describe("口座ID（省略時は全口座合算）。取得元: list_accounts.accounts[].id"),
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
      return textContent(formatBalanceHistory(data), { ...data, currencySource: accountId ? "list_accounts.accounts[].currencyCode (accountId)" : "JPY" });
    },
  );
}
