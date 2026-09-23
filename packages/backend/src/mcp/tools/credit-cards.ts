import type { AccountsResponse } from "@sui/shared";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CreateCreditCardPayload,
  CreditCardAssumptionSuggestionResponse,
  CreditCard,
  CreditCardsResponse,
  UpdateCreditCardPayload,
} from "@sui/shared";
import { isValidYearMonth } from "@sui/shared";
import type { SuiApiClient } from "../client";
import { formatCreditCardsText, formatCurrency } from "../format";
import {
  confirmDeleteSchema,
  createToolAnnotations,
  dateShiftPolicySchema,
  deleteToolAnnotations,
  deletePreview,
  nonNegativeMoneySchema,
  readOnlyToolAnnotations,
  textContent,
  updateToolAnnotations,
  uuidSchema,
  registerTool,
  compactRecord,
} from "../helpers";
import { z } from "zod";

const creditCardPayload = {
  name: z.string().min(1).max(100).describe("カード名"),
  settlementDay: z.number().int().min(1).max(31).nullable().optional().describe("引き落とし日"),
  dateShiftPolicy: dateShiftPolicySchema.optional().describe("土日祝の扱い"),
  accountId: uuidSchema.describe("引き落とし口座 ID。取得元: list_accounts.accounts[].id"),
  assumptionAmount: nonNegativeMoneySchema.optional().describe("旧形式の単一仮定額。assumptions を指定する場合は不要"),
  assumptions: z.array(z.object({
    amount: nonNegativeMoneySchema.describe("対象通貨の最小単位の整数"),
    startMonth: z.string().refine(isValidYearMonth).nullable().describe("適用開始の請求月 YYYY-MM。null は制限なし"),
    endMonth: z.string().refine(isValidYearMonth).nullable().describe("適用終了の請求月 YYYY-MM。null は制限なし"),
  })).optional().describe("請求月ごとの仮定額。期間の重複不可。設定のない月は仮定額 0"),
  sortOrder: z.number().int().describe("表示順"),
};

export function registerCreditCardTools(server: McpServer, apiClient: SuiApiClient) {
  registerTool(server, "list_credit_cards", "クレジットカード一覧を取得する", {}, readOnlyToolAnnotations, async () => {
    const data = await apiClient.get<CreditCardsResponse>("/api/credit-cards");
    return textContent(formatCreditCardsText(data), { items: data.map(compactRecord), complete: true });
  });

  registerTool(server,
    "get_credit_card_assumption_suggestion",
    "クレジットカードの過去請求実績から仮定請求額の提案を取得する",
    {
      id: uuidSchema.describe("クレジットカード ID。取得元: list_credit_cards.items[].id"),
      months: z.number().int().min(1).max(60).optional().describe("集計対象月数"),
    },
    readOnlyToolAnnotations,
    async ({ id, months = 6 }) => {
      const cards = await apiClient.get<CreditCardsResponse>("/api/credit-cards");
      const currencyCode = cards.find((card) => card.id === id)?.account?.currencyCode ?? "JPY";
      const suggestion = await apiClient.get<CreditCardAssumptionSuggestionResponse>(
        `/api/credit-cards/${id}/assumption-suggestion?months=${months}`,
      );
      const amount = suggestion.suggestedAmount === null
        ? "提案なし"
        : formatCurrency(suggestion.suggestedAmount, currencyCode);
      return textContent([
        `仮定請求額の提案: ${amount}`,
        `サンプル数: ${suggestion.sampleCount}件`,
      ].join("\n"), { ...suggestion, creditCardId: id, currencyCode });
    },
  );

  registerTool(server, "create_credit_card", "クレジットカードを作成する", creditCardPayload, createToolAnnotations, async (args) => {
    const accounts = await apiClient.get<AccountsResponse>("/api/accounts");
    const card = await apiClient.post<CreditCard>("/api/credit-cards", args as CreateCreditCardPayload);
    return textContent(`クレジットカードを作成しました: ${card.name}`, { item: compactRecord({ ...card, account: accounts.find((account) => account.id === card.accountId) ?? null }) });
  });

  registerTool(server,
    "update_credit_card",
    "クレジットカードを更新する",
    {
      id: uuidSchema.describe("クレジットカード ID。取得元: list_credit_cards.items[].id"),
      ...creditCardPayload,
    },
    updateToolAnnotations,
    async ({ id, ...payload }) => {
      const accounts = await apiClient.get<AccountsResponse>("/api/accounts");
      const card = await apiClient.put<CreditCard>(`/api/credit-cards/${id}`, payload as UpdateCreditCardPayload);
      return textContent(`クレジットカードを更新しました: ${card.name}`, { item: compactRecord({ ...card, account: accounts.find((account) => account.id === card.accountId) ?? null }) });
    },
  );

  registerTool(server,
    "delete_credit_card",
    "クレジットカードを削除する。confirm が true でない場合は API の DELETE を呼ばず、対象カードの要約と再実行案内だけを返す。confirm: true の場合のみ削除を実行する",
    {
      id: uuidSchema.describe("クレジットカード ID。取得元: list_credit_cards.items[].id"),
      confirm: confirmDeleteSchema,
    },
    deleteToolAnnotations,
    async ({ id, confirm }) => {
      if (confirm !== true) {
        const cards = await apiClient.get<CreditCardsResponse>("/api/credit-cards");
        const card = cards.find((entry) => entry.id === id);
        return deletePreview(
          "クレジットカード",
          id,
          card ? `${card.name}（仮定額の期間 ${card.assumptions.length}件）` : null,
        );
      }

      await apiClient.delete(`/api/credit-cards/${id}`);
      return textContent(`クレジットカードを削除しました: ${id}`, { id, deleted: true, executed: true });
    },
  );
}
