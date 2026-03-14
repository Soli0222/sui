import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CreateCreditCardPayload,
  CreditCard,
  CreditCardsResponse,
  UpdateCreditCardPayload,
} from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { formatCreditCardsText } from "../format";
import { nonNegativeMoneySchema, textContent, uuidSchema } from "../helpers";
import { z } from "zod";

const creditCardPayload = {
  name: z.string().min(1).max(100).describe("カード名"),
  settlementDay: z.number().int().min(1).max(31).nullable().optional().describe("引き落とし日"),
  accountId: uuidSchema.describe("引き落とし口座 ID"),
  assumptionAmount: nonNegativeMoneySchema.describe("仮定請求額"),
  sortOrder: z.number().int().describe("表示順"),
};

export function registerCreditCardTools(server: McpServer, apiClient: SuiApiClient) {
  server.tool("list_credit_cards", "クレジットカード一覧を取得する", {}, async () => {
    const data = await apiClient.get<CreditCardsResponse>("/api/credit-cards");
    return textContent(formatCreditCardsText(data));
  });

  server.tool("create_credit_card", "クレジットカードを作成する", creditCardPayload, async (args) => {
    const card = await apiClient.post<CreditCard>("/api/credit-cards", args as CreateCreditCardPayload);
    return textContent(`クレジットカードを作成しました: ${card.name}`);
  });

  server.tool(
    "update_credit_card",
    "クレジットカードを更新する",
    {
      id: uuidSchema.describe("クレジットカード ID"),
      ...creditCardPayload,
    },
    async ({ id, ...payload }) => {
      const card = await apiClient.put<CreditCard>(`/api/credit-cards/${id}`, payload as UpdateCreditCardPayload);
      return textContent(`クレジットカードを更新しました: ${card.name}`);
    },
  );

  server.tool(
    "delete_credit_card",
    "クレジットカードを削除する",
    { id: uuidSchema.describe("クレジットカード ID") },
    async ({ id }) => {
      await apiClient.delete(`/api/credit-cards/${id}`);
      return textContent(`クレジットカードを削除しました: ${id}`);
    },
  );
}
