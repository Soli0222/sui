import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  Account,
  AccountsResponse,
  CreateAccountPayload,
  ReconcileAccountPayload,
  ReconcileAccountResponse,
  UpdateAccountPayload,
} from "@sui/shared";
import type { SuiApiClient } from "../client";
import { formatAccountsText, formatCurrency } from "../format";
import {
  confirmDeleteSchema,
  createToolAnnotations,
  deleteToolAnnotations,
  deletePreview,
  moneySchema,
  readOnlyToolAnnotations,
  supportedCurrencyCodeSchema,
  textContent,
  updateToolAnnotations,
  uuidSchema,
  registerTool,
} from "../helpers";
import { z } from "zod";

const accountDetails = {
  name: z.string().min(1).max(100).describe("口座名"),
  balanceOffset: moneySchema.describe("可処分計算用オフセット（対象通貨の最小単位の整数（JPYは円、USD/EURはセント。USD 250.00は25000））"),
  currencyCode: z
    .preprocess((value) => (typeof value === "string" ? value.toUpperCase() : value), supportedCurrencyCodeSchema)
    .describe("通貨コード"),
  exchangeRateToJpy: z.number().positive().describe("JPY換算レート。JPY口座では 1"),
  sortOrder: z.number().int().describe("表示順"),
};
const createAccountPayload = {
  ...accountDetails,
  balance: moneySchema.describe("初期残高（対象通貨の最小単位の整数。JPYは円、USD/EURはセント）"),
};

export function registerAccountTools(server: McpServer, apiClient: SuiApiClient) {
  registerTool(server, "list_accounts", "口座名、ID、残高等を取得する", {}, readOnlyToolAnnotations, async () => {
    const data = await apiClient.get<AccountsResponse>("/api/accounts");
    return textContent(formatAccountsText(data), { accounts: data, complete: true });
  });

  registerTool(server, "create_account", "初期残高を指定して口座を作成する", createAccountPayload, createToolAnnotations, async (args) => {
    const account = await apiClient.post<Account>("/api/accounts", args as CreateAccountPayload);
    return textContent(`口座を作成しました: ${account.name}（残高 ${formatCurrency(account.balance, account.currencyCode)}）`, { account });
  });

  registerTool(server,
    "update_account",
    "口座の基本情報を更新する。残高の変更には reconcile_account を使用する",
    {
      id: uuidSchema.describe("口座 ID。取得元: list_accounts.accounts[].id"),
      ...accountDetails,
    },
    updateToolAnnotations,
    async ({ id, ...payload }) => {
      const account = await apiClient.put<Account>(`/api/accounts/${id}`, payload as UpdateAccountPayload);
      return textContent(`口座を更新しました: ${account.name}（残高 ${formatCurrency(account.balance, account.currencyCode)}）`, { account });
    },
    { balance: "残高の変更には reconcile_account の actualBalance を使用してください" },
  );

  registerTool(server,
    "reconcile_account",
    "口座の実残高を入力して照合する。差分は adjustment 取引として記録し、差額0でも照合日時を更新する。残高履歴を遡及的に書き換えない",
    {
      accountId: uuidSchema.describe("口座 ID。取得元: list_accounts.accounts[].id"),
      actualBalance: moneySchema.describe("実残高（対象通貨の最小単位の整数（JPYは円、USD/EURはセント。USD 250.00は25000））"),
    },
    updateToolAnnotations,
    async ({ accountId, actualBalance }) => {
      const payload: ReconcileAccountPayload = { actualBalance };
      const result = await apiClient.post<ReconcileAccountResponse>(
        `/api/accounts/${accountId}/reconcile`,
        payload,
      );
      const sign = result.diff > 0 ? "+" : "";
      return textContent(
        `口座を照合しました: ${result.account.name}（差分 ${sign}${formatCurrency(result.diff, result.account.currencyCode)}、新残高 ${formatCurrency(result.account.balance, result.account.currencyCode)}）`, result,
      );
    },
  );

  registerTool(server,
    "delete_account",
    "口座を削除する。confirm が true でない場合は API の DELETE を呼ばず、対象口座の要約と再実行案内だけを返す。confirm: true の場合のみ削除を実行する",
    {
      id: uuidSchema.describe("口座 ID。取得元: list_accounts.accounts[].id"),
      confirm: confirmDeleteSchema,
    },
    deleteToolAnnotations,
    async ({ id, confirm }) => {
      if (confirm !== true) {
        const accounts = await apiClient.get<AccountsResponse>("/api/accounts");
        const account = accounts.find((item) => item.id === id);
        return deletePreview(
          "口座",
          id,
          account ? `${account.name}（残高 ${formatCurrency(account.balance, account.currencyCode)}）` : null,
        );
      }

      await apiClient.delete(`/api/accounts/${id}`);
      return textContent(`口座を削除しました: ${id}`, { id, deleted: true, executed: true });
    },
  );
}
