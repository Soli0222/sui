import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CreateRecurringItemPayload,
  RecurringItem,
  RecurringItemsResponse,
  UpdateRecurringItemPayload,
} from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { formatRecurringItemsText } from "../format";
import { dateSchema, nonNegativeMoneySchema, textContent, uuidSchema } from "../helpers";
import { z } from "zod";

const recurringPayload = {
  name: z.string().min(1).max(100).describe("固定収支名"),
  type: z.enum(["income", "expense"]).describe("種別"),
  amount: nonNegativeMoneySchema.describe("金額"),
  dayOfMonth: z.number().int().min(1).max(31).describe("毎月の対象日"),
  startDate: dateSchema.nullable().describe("開始日"),
  endDate: dateSchema.nullable().describe("終了日"),
  accountId: uuidSchema.describe("口座 ID"),
  enabled: z.boolean().describe("有効フラグ"),
  sortOrder: z.number().int().describe("表示順"),
};

export function registerRecurringItemTools(server: McpServer, apiClient: SuiApiClient) {
  server.tool("list_recurring_items", "固定収支一覧を取得する", {}, async () => {
    const data = await apiClient.get<RecurringItemsResponse>("/api/recurring-items");
    return textContent(formatRecurringItemsText(data));
  });

  server.tool("create_recurring_item", "固定収支を作成する", recurringPayload, async (args) => {
    const item = await apiClient.post<RecurringItem>("/api/recurring-items", args as CreateRecurringItemPayload);
    return textContent(`固定収支を作成しました: ${item.name} ¥${item.amount.toLocaleString("ja-JP")}`);
  });

  server.tool(
    "update_recurring_item",
    "固定収支を更新する",
    {
      id: uuidSchema.describe("固定収支 ID"),
      ...recurringPayload,
    },
    async ({ id, ...payload }) => {
      const item = await apiClient.put<RecurringItem>(
        `/api/recurring-items/${id}`,
        payload as UpdateRecurringItemPayload,
      );
      return textContent(`固定収支を更新しました: ${item.name} ¥${item.amount.toLocaleString("ja-JP")}`);
    },
  );

  server.tool(
    "delete_recurring_item",
    "固定収支を削除する",
    { id: uuidSchema.describe("固定収支 ID") },
    async ({ id }) => {
      await apiClient.delete(`/api/recurring-items/${id}`);
      return textContent(`固定収支を削除しました: ${id}`);
    },
  );
}
