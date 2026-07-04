import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Account, AccountsResponse, CreateAccountPayload, UpdateAccountPayload } from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { formatAccountsText } from "../format";
import { moneySchema, supportedCurrencyCodeSchema, textContent, uuidSchema } from "../helpers";
import { z } from "zod";

const accountPayload = {
  name: z.string().min(1).max(100).describe("口座名"),
  balance: moneySchema.describe("残高（通貨の最小単位）。既存口座の実残高合わせでは直接編集を避け、将来の調整取引・照合フローへ移行予定"),
  balanceOffset: moneySchema.describe("可処分計算用オフセット（通貨の最小単位）"),
  currencyCode: z
    .preprocess((value) => (typeof value === "string" ? value.toUpperCase() : value), supportedCurrencyCodeSchema)
    .describe("通貨コード"),
  exchangeRateToJpy: z.number().positive().describe("JPY換算レート。JPY口座では 1"),
  sortOrder: z.number().int().describe("表示順"),
};

export function registerAccountTools(server: McpServer, apiClient: SuiApiClient) {
  server.tool("list_accounts", "口座一覧を取得する", {}, async () => {
    const data = await apiClient.get<AccountsResponse>("/api/accounts");
    return textContent(formatAccountsText(data));
  });

  server.tool("create_account", "口座を作成する", accountPayload, async (args) => {
    const account = await apiClient.post<Account>("/api/accounts", args as CreateAccountPayload);
    return textContent(`口座を作成しました: ${account.name}（残高 ${account.balance.toLocaleString("ja-JP")}円）`);
  });

  server.tool(
    "update_account",
    "口座を更新する。現行 API では残高更新も可能だが、残高の直接編集は履歴をずらすため通常の照合用途では推奨しない",
    {
      id: uuidSchema.describe("口座 ID"),
      ...accountPayload,
    },
    async ({ id, ...payload }) => {
      const account = await apiClient.put<Account>(`/api/accounts/${id}`, payload as UpdateAccountPayload);
      return textContent(`口座を更新しました: ${account.name}（残高 ${account.balance.toLocaleString("ja-JP")}円）`);
    },
  );

  server.tool(
    "delete_account",
    "口座を削除する",
    { id: uuidSchema.describe("口座 ID") },
    async ({ id }) => {
      await apiClient.delete(`/api/accounts/${id}`);
      return textContent(`口座を削除しました: ${id}`);
    },
  );
}
