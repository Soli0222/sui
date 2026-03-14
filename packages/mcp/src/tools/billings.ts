import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BillingResponse, BillingUpdatePayload } from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { formatBillingText } from "../format";
import { dateSchema, nonNegativeMoneySchema, textContent, uuidSchema, yearMonthSchema } from "../helpers";
import { z } from "zod";

const billingItemsSchema = z.array(
  z.object({
    creditCardId: uuidSchema.describe("クレジットカード ID"),
    amount: nonNegativeMoneySchema.describe("請求額"),
  }),
).describe("請求項目");

export function registerBillingTools(server: McpServer, apiClient: SuiApiClient) {
  server.tool(
    "get_billing",
    "指定月のクレジットカード請求を取得する",
    {
      month: yearMonthSchema.describe("対象月（YYYY-MM）"),
    },
    async ({ month }) => {
      const billing = await apiClient.get<BillingResponse>(`/api/billings?month=${month}`);
      return textContent(formatBillingText(billing));
    },
  );

  server.tool(
    "update_billing",
    "請求データを更新する",
    {
      yearMonth: yearMonthSchema.describe("対象月（YYYY-MM）"),
      settlementDate: dateSchema.optional().describe("引き落とし日"),
      items: billingItemsSchema,
    },
    async ({ yearMonth, ...payload }) => {
      const billing = await apiClient.put<BillingResponse>(
        `/api/billings/${yearMonth}`,
        payload as BillingUpdatePayload,
      );
      return textContent(formatBillingText(billing));
    },
  );
}
