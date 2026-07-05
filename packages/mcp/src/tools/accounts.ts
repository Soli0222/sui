import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  Account,
  AccountsResponse,
  CreateAccountPayload,
  ReconcileAccountPayload,
  ReconcileAccountResponse,
  UpdateAccountPayload,
} from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { formatAccountsText } from "../format";
import {
  confirmDeleteSchema,
  createToolAnnotations,
  deleteToolAnnotations,
  formatDeletePreview,
  moneySchema,
  readOnlyToolAnnotations,
  supportedCurrencyCodeSchema,
  textContent,
  updateToolAnnotations,
  uuidSchema,
} from "../helpers";
import { z } from "zod";

const accountPayload = {
  name: z.string().min(1).max(100).describe("口座名"),
  balance: moneySchema.describe("残高（通貨の最小単位）。既存口座で変更した差分は調整取引として記録される"),
  balanceOffset: moneySchema.describe("可処分計算用オフセット（通貨の最小単位）"),
  currencyCode: z
    .preprocess((value) => (typeof value === "string" ? value.toUpperCase() : value), supportedCurrencyCodeSchema)
    .describe("通貨コード"),
  exchangeRateToJpy: z.number().positive().describe("JPY換算レート。JPY口座では 1"),
  sortOrder: z.number().int().describe("表示順"),
};

export function registerAccountTools(server: McpServer, apiClient: SuiApiClient) {
  server.tool("list_accounts", "口座一覧を取得する", {}, readOnlyToolAnnotations, async () => {
    const data = await apiClient.get<AccountsResponse>("/api/accounts");
    return textContent(formatAccountsText(data));
  });

  server.tool("create_account", "口座を作成する", accountPayload, createToolAnnotations, async (args) => {
    const account = await apiClient.post<Account>("/api/accounts", args as CreateAccountPayload);
    return textContent(`口座を作成しました: ${account.name}（残高 ${account.balance.toLocaleString("ja-JP")}円）`);
  });

  server.tool(
    "update_account",
    "口座を更新する。balance を変更した差分は調整取引として記録される",
    {
      id: uuidSchema.describe("口座 ID"),
      ...accountPayload,
    },
    updateToolAnnotations,
    async ({ id, ...payload }) => {
      const account = await apiClient.put<Account>(`/api/accounts/${id}`, payload as UpdateAccountPayload);
      return textContent(`口座を更新しました: ${account.name}（残高 ${account.balance.toLocaleString("ja-JP")}円）`);
    },
  );

  server.tool(
    "reconcile_account",
    "口座の実残高を入力して照合する。差分は adjustment 取引として記録され、残高履歴を遡及的に書き換えない",
    {
      accountId: uuidSchema.describe("口座 ID"),
      actualBalance: moneySchema.describe("実残高（通貨の最小単位）"),
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
        `口座を照合しました: ${result.account.name}（差分 ${sign}${result.diff.toLocaleString("ja-JP")}、新残高 ${result.account.balance.toLocaleString("ja-JP")}）`,
      );
    },
  );

  server.tool(
    "delete_account",
    "口座を削除する。confirm が true でない場合は API の DELETE を呼ばず、対象口座の要約と再実行案内だけを返す。confirm: true の場合のみ削除を実行する",
    {
      id: uuidSchema.describe("口座 ID"),
      confirm: confirmDeleteSchema,
    },
    deleteToolAnnotations,
    async ({ id, confirm }) => {
      if (confirm !== true) {
        const accounts = await apiClient.get<AccountsResponse>("/api/accounts");
        const account = accounts.find((item) => item.id === id);
        return textContent(formatDeletePreview(
          "口座",
          id,
          account ? `${account.name}（残高 ${account.balance.toLocaleString("ja-JP")}円）` : null,
        ));
      }

      await apiClient.delete(`/api/accounts/${id}`);
      return textContent(`口座を削除しました: ${id}`);
    },
  );
}
