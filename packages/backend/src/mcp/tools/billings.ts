import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BillingResponse, BillingUpdatePayload, CreditCardsResponse } from "@sui/shared";
import type { SuiApiClient } from "../client";
import { formatBillingText } from "../format";
import {
  dateSchema,
  nonNegativeMoneySchema,
  readOnlyToolAnnotations,
  textContent,
  updateToolAnnotations,
  uuidSchema,
  yearMonthSchema,
  registerTool,
} from "../helpers";
import { z } from "zod";

const billingItemsSchema = z.array(
  z.object({
    creditCardId: uuidSchema.describe("クレジットカード ID。取得元: list_credit_cards.items[].id"),
    amount: nonNegativeMoneySchema.describe("請求額：対象通貨の最小単位の整数（JPYは円、USD/EURはセント。USD 250.00は25000）。カードの引き落とし口座の通貨を使う"),
  }),
).describe("請求項目");

function billingResult(billing: BillingResponse, cards: CreditCardsResponse) {
  return {
    ...billing,
    items: billing.items.map((item) => {
      const card = cards.find((entry) => entry.id === item.creditCardId);
      return { ...item, creditCardName: card?.name ?? null, accountId: card?.accountId ?? null, currencyCode: card?.account?.currencyCode ?? "JPY" as const };
    }),
    totalsCurrencyCode: "JPY",
  };
}

export function registerBillingTools(server: McpServer, apiClient: SuiApiClient) {
  registerTool(server,
    "get_billing",
    "指定月のクレジットカード請求を取得する",
    {
      month: yearMonthSchema.describe("対象月（YYYY-MM）。利用者が指定する月キー。get_billing.yearMonth を update_billing.yearMonth に再利用"),
    },
    readOnlyToolAnnotations,
    async ({ month }) => {
      const cards = await apiClient.get<CreditCardsResponse>("/api/credit-cards");
      const billing = await apiClient.get<BillingResponse>(`/api/billings?month=${month}`);
      const result = billingResult(billing, cards);
      return textContent(formatBillingText(result), result);
    },
  );

  registerTool(server,
    "update_billing",
    "請求データを更新する",
    {
      yearMonth: yearMonthSchema.describe("対象月（YYYY-MM）。利用者が指定する月キー。get_billing.yearMonth を update_billing.yearMonth に再利用"),
      settlementDate: dateSchema.optional().describe("引き落とし日"),
      items: billingItemsSchema,
    },
    updateToolAnnotations,
    async ({ yearMonth, ...payload }) => {
      const cards = await apiClient.get<CreditCardsResponse>("/api/credit-cards");
      const billing = await apiClient.put<BillingResponse>(
        `/api/billings/${yearMonth}`,
        payload as BillingUpdatePayload,
      );
      const result = billingResult(billing, cards);
      return textContent(formatBillingText(result), result);
    },
  );
}
