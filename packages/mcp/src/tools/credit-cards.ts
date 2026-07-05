import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CreateCreditCardPayload,
  CreditCardAssumptionSuggestionResponse,
  CreditCard,
  CreditCardsResponse,
  UpdateCreditCardPayload,
} from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { formatCreditCardsText, formatJson } from "../format";
import {
  confirmDeleteSchema,
  createToolAnnotations,
  dateShiftPolicySchema,
  deleteToolAnnotations,
  formatDeletePreview,
  nonNegativeMoneySchema,
  readOnlyToolAnnotations,
  textContent,
  updateToolAnnotations,
  uuidSchema,
} from "../helpers";
import { z } from "zod";

const creditCardPayload = {
  name: z.string().min(1).max(100).describe("カード名"),
  settlementDay: z.number().int().min(1).max(31).nullable().optional().describe("引き落とし日"),
  dateShiftPolicy: dateShiftPolicySchema.optional().describe("土日祝の扱い"),
  accountId: uuidSchema.describe("引き落とし口座 ID"),
  assumptionAmount: nonNegativeMoneySchema.describe("仮定請求額"),
  sortOrder: z.number().int().describe("表示順"),
};

export function registerCreditCardTools(server: McpServer, apiClient: SuiApiClient) {
  server.tool("list_credit_cards", "クレジットカード一覧を取得する", {}, readOnlyToolAnnotations, async () => {
    const data = await apiClient.get<CreditCardsResponse>("/api/credit-cards");
    return textContent(formatCreditCardsText(data));
  });

  server.tool(
    "get_credit_card_assumption_suggestion",
    "クレジットカードの過去請求実績から仮定請求額の提案を取得する",
    {
      id: uuidSchema.describe("クレジットカード ID"),
      months: z.number().int().min(1).max(60).optional().describe("集計対象月数"),
    },
    readOnlyToolAnnotations,
    async ({ id, months = 6 }) => {
      const suggestion = await apiClient.get<CreditCardAssumptionSuggestionResponse>(
        `/api/credit-cards/${id}/assumption-suggestion?months=${months}`,
      );
      const amount = suggestion.suggestedAmount === null
        ? "提案なし"
        : `¥${suggestion.suggestedAmount.toLocaleString("ja-JP")}`;
      return textContent([
        `仮定請求額の提案: ${amount}`,
        `サンプル数: ${suggestion.sampleCount}件`,
        "",
        formatJson(suggestion),
      ].join("\n"));
    },
  );

  server.tool("create_credit_card", "クレジットカードを作成する", creditCardPayload, createToolAnnotations, async (args) => {
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
    updateToolAnnotations,
    async ({ id, ...payload }) => {
      const card = await apiClient.put<CreditCard>(`/api/credit-cards/${id}`, payload as UpdateCreditCardPayload);
      return textContent(`クレジットカードを更新しました: ${card.name}`);
    },
  );

  server.tool(
    "delete_credit_card",
    "クレジットカードを削除する。confirm が true でない場合は API の DELETE を呼ばず、対象カードの要約と再実行案内だけを返す。confirm: true の場合のみ削除を実行する",
    {
      id: uuidSchema.describe("クレジットカード ID"),
      confirm: confirmDeleteSchema,
    },
    deleteToolAnnotations,
    async ({ id, confirm }) => {
      if (confirm !== true) {
        const cards = await apiClient.get<CreditCardsResponse>("/api/credit-cards");
        const card = cards.find((entry) => entry.id === id);
        return textContent(formatDeletePreview(
          "クレジットカード",
          id,
          card ? `${card.name}（仮定請求額 ¥${card.assumptionAmount.toLocaleString("ja-JP")}）` : null,
        ));
      }

      await apiClient.delete(`/api/credit-cards/${id}`);
      return textContent(`クレジットカードを削除しました: ${id}`);
    },
  );
}
