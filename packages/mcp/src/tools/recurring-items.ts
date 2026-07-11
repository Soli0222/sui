import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CreateRecurringItemPayload,
  RecurringItem,
  RecurringItemsResponse,
  UpdateRecurringItemPayload,
} from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { formatRecurringItemAmount, formatRecurringItemsText, formatRecurringSchedule } from "../format";
import {
  confirmDeleteSchema,
  createToolAnnotations,
  dateSchema,
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

const recurringPayload = {
  name: z.string().min(1).max(100).describe("固定収支名"),
  type: z.enum(["income", "expense", "transfer"]).describe("種別。transfer は定期振替"),
  amount: nonNegativeMoneySchema.describe("金額（選択口座通貨建て）"),
  recurrence: z.enum(["monthly", "weekly"]).optional().describe("繰り返し種別。monthly または weekly。省略時は monthly"),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional().describe("毎月の対象日（1-31）。monthly の場合のみ指定（weekly では null または未指定）"),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional().describe("曜日（0=日曜、6=土曜）。weekly の場合のみ指定（monthly では null または未指定）"),
  startDate: dateSchema.nullable().describe("開始日"),
  endDate: dateSchema.nullable().describe("終了日"),
  dateShiftPolicy: dateShiftPolicySchema.optional().describe("土日祝の扱い"),
  accountId: uuidSchema.optional().nullable().describe("口座 ID。振替では送金元口座。type が transfer の場合は null または省略で送金元なし"),
  transferToAccountId: uuidSchema.optional().nullable().describe("振替先口座 ID。type が transfer の場合に指定。null または省略で振替先なし"),
  enabled: z.boolean().describe("有効フラグ"),
  sortOrder: z.number().int().describe("表示順"),
};

export function registerRecurringItemTools(server: McpServer, apiClient: SuiApiClient) {
  server.tool("list_recurring_items", "固定収支一覧を取得する", {}, readOnlyToolAnnotations, async () => {
    const data = await apiClient.get<RecurringItemsResponse>("/api/recurring-items");
    return textContent(formatRecurringItemsText(data));
  });

  server.tool(
    "create_recurring_item",
    "固定収支を作成する。type=transfer の定期振替は口座別予測に反映され、合計残高には中立",
    recurringPayload,
    createToolAnnotations,
    async (args) => {
      const item = await apiClient.post<RecurringItem>("/api/recurring-items", args as CreateRecurringItemPayload);
      return textContent(`固定収支を作成しました: ${item.name} ${formatRecurringItemAmount(item)}`);
    },
  );

  server.tool(
    "update_recurring_item",
    "固定収支を更新する。type=transfer の定期振替は口座別予測に反映され、合計残高には中立",
    {
      id: uuidSchema.describe("固定収支 ID"),
      ...recurringPayload,
    },
    updateToolAnnotations,
    async ({ id, ...payload }) => {
      const item = await apiClient.put<RecurringItem>(
        `/api/recurring-items/${id}`,
        payload as UpdateRecurringItemPayload,
      );
      return textContent(`固定収支を更新しました: ${item.name} ${formatRecurringItemAmount(item)}`);
    },
  );

  server.tool(
    "delete_recurring_item",
    "固定収支を削除する。confirm が true でない場合は API の DELETE を呼ばず、対象固定収支の要約と再実行案内だけを返す。confirm: true の場合のみ削除を実行する",
    {
      id: uuidSchema.describe("固定収支 ID"),
      confirm: confirmDeleteSchema,
    },
    deleteToolAnnotations,
    async ({ id, confirm }) => {
      if (confirm !== true) {
        const items = await apiClient.get<RecurringItemsResponse>("/api/recurring-items");
        const item = items.find((entry) => entry.id === id);
        return textContent(formatDeletePreview(
          "固定収支",
          id,
          item ? `${item.name} ${item.type} ${formatRecurringItemAmount(item)}（${formatRecurringSchedule(item)}）` : null,
        ));
      }

      await apiClient.delete(`/api/recurring-items/${id}`);
      return textContent(`固定収支を削除しました: ${id}`);
    },
  );
}
