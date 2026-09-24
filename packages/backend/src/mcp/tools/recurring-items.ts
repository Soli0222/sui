import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CreateRecurringItemPayload,
  RecurringItem,
  RecurringItemAmountChange,
  RecurringItemsResponse,
  UpdateRecurringItemPayload,
} from "@sui/shared";
import type { SuiApiClient } from "../client";
import { formatCurrency, formatRecurringItemAmount, formatRecurringItemsText, formatRecurringSchedule } from "../format";
import {
  confirmDeleteSchema,
  createToolAnnotations,
  dateSchema,
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

function currencyCode(item: RecurringItem) {
  return item.account?.currencyCode ?? item.transferToAccount?.currencyCode ?? "JPY";
}

const recurringPayload = {
  name: z.string().min(1).max(100).describe("予定収支名"),
  type: z.enum(["income", "expense", "transfer"]).describe("種別。transfer は振替"),
  amount: nonNegativeMoneySchema.describe("選択口座の金額：対象通貨の最小単位の整数（JPYは円、USD/EURはセント。USD 250.00は25000）"),
  recurrence: z.enum(["monthly", "weekly"]).optional().describe("繰り返し種別。monthly または weekly。省略時は monthly。単発予定は monthly にして interval=1、startDate と endDate を同じ日付、dayOfMonth をその日の日にちにする"),
  interval: z.number().int().min(1).optional().describe("繰り返し間隔。monthly は N ヶ月ごと、weekly は N 週ごと。省略時は 1。単発予定は 1"),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional().describe("毎月の対象日（1-31）。monthly の場合のみ指定（weekly では null または未指定）。単発予定は startDate/endDate の日にちと一致させる"),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional().describe("曜日（0=日曜、6=土曜）。weekly の場合のみ指定（monthly では null または未指定）。単発予定は null"),
  startDate: dateSchema.nullable().describe("開始日。単発予定の場合は予定日と同じ日付"),
  endDate: dateSchema.nullable().describe("終了日。単発予定の場合は startDate と同じ日付"),
  dateShiftPolicy: dateShiftPolicySchema.optional().describe("土日祝の扱い"),
  accountId: uuidSchema.optional().nullable().describe("口座 ID。振替では送金元口座。type が transfer の場合は null または省略で送金元なし。取得元: list_accounts.accounts[].id"),
  transferToAccountId: uuidSchema.optional().nullable().describe("振替先口座 ID。type が transfer の場合に指定。null または省略で振替先なし。取得元: list_accounts.accounts[].id"),
  enabled: z.boolean().describe("有効フラグ"),
  sortOrder: z.number().int().describe("表示順"),
};

export function registerRecurringItemTools(server: McpServer, apiClient: SuiApiClient) {
  registerTool(server, "list_recurring_items", "予定収支一覧を取得する", {}, readOnlyToolAnnotations, async () => {
    const data = await apiClient.get<RecurringItemsResponse>("/api/recurring-items");
    return textContent(formatRecurringItemsText(data), { items: data.map(compactRecord), complete: true });
  });

  registerTool(server, "get_recurring_item", "予定収支の詳細を ID で取得する", { id: uuidSchema.describe("取得元: list_recurring_items.items[].id") }, readOnlyToolAnnotations, async ({ id }) => {
    const item = await apiClient.get<RecurringItem>(`/api/recurring-items/${id}`);
    return textContent(`予定収支: ${item.name}`, { item: compactRecord(item) });
  });

  registerTool(server, "list_recurring_item_amount_changes", "予定収支の初期金額・現在金額・金額履歴を取得する", { recurringItemId: uuidSchema.describe("取得元: list_recurring_items.items[].id") }, readOnlyToolAnnotations, async ({ recurringItemId }) => {
    const items = await apiClient.get<RecurringItemsResponse>("/api/recurring-items");
    const item = items.find((entry) => entry.id === recurringItemId);
    const changes = await apiClient.get<RecurringItemAmountChange[]>(`/api/recurring-items/${recurringItemId}/amount-changes`);
    return textContent("操作結果", { recurringItemId, currencyCode: item ? currencyCode(item) : null, initialAmount: item?.amount, effectiveAmount: item?.effectiveAmount, amountChanges: changes });
  });

  registerTool(server, "create_recurring_item_amount_change", "予定収支の金額変更を予約する。適用日は開始日より後。単発予定は対象外", { recurringItemId: uuidSchema.describe("取得元: list_recurring_items.items[].id"), effectiveFrom: dateSchema, amount: nonNegativeMoneySchema }, createToolAnnotations, async ({ recurringItemId, effectiveFrom, amount }) => {
    const change = await apiClient.post<RecurringItemAmountChange>(`/api/recurring-items/${recurringItemId}/amount-changes`, { effectiveFrom, amount });
    const items = await apiClient.get<RecurringItemsResponse>("/api/recurring-items");
    const item = items.find((entry) => entry.id === recurringItemId);
    return textContent("操作結果", { ...change, currencyCode: item ? currencyCode(item) : null });
  });

  registerTool(server, "update_recurring_item_amount_change", "予定収支の金額履歴を訂正する。過去の未確定予測も変わる", { recurringItemId: uuidSchema.describe("取得元: list_recurring_items.items[].id"), changeId: uuidSchema.describe("取得元: list_recurring_item_amount_changes.amountChanges[].id"), effectiveFrom: dateSchema, amount: nonNegativeMoneySchema }, updateToolAnnotations, async ({ recurringItemId, changeId, effectiveFrom, amount }) => {
    const change = await apiClient.put<RecurringItemAmountChange>(`/api/recurring-items/${recurringItemId}/amount-changes/${changeId}`, { effectiveFrom, amount });
    const items = await apiClient.get<RecurringItemsResponse>("/api/recurring-items");
    const item = items.find((entry) => entry.id === recurringItemId);
    return textContent("操作結果", { ...change, currencyCode: item ? currencyCode(item) : null });
  });

  registerTool(server, "delete_recurring_item_amount_change", "予定収支の金額履歴を削除する。confirm: true の場合のみ実行", { recurringItemId: uuidSchema.describe("取得元: list_recurring_items.items[].id"), changeId: uuidSchema.describe("取得元: list_recurring_item_amount_changes.amountChanges[].id"), confirm: confirmDeleteSchema }, deleteToolAnnotations, async ({ recurringItemId, changeId, confirm }) => {
    if (confirm !== true) {
      const items = await apiClient.get<RecurringItemsResponse>("/api/recurring-items");
      const item = items.find((entry) => entry.id === recurringItemId);
      const changes = item ? await apiClient.get<RecurringItemAmountChange[]>(`/api/recurring-items/${recurringItemId}/amount-changes`) : [];
      const change = changes.find((entry) => entry.id === changeId);
      return deletePreview("予定収支金額履歴", changeId, change && item ? `${item.name} [${recurringItemId}] ${change.effectiveFrom} から ${formatCurrency(change.amount, currencyCode(item))}` : null, { recurringItemId, changeId });
    }
    await apiClient.delete(`/api/recurring-items/${recurringItemId}/amount-changes/${changeId}`);
    return textContent("操作結果", { recurringItemId, changeId, id: changeId, deleted: true, executed: true });
  });

  registerTool(server,
    "create_recurring_item",
    "予定収支を作成する。type=transfer の振替は口座別予測に反映され、合計残高には中立。単発予定は recurrence=monthly、interval=1、startDate=endDate、dayOfMonth をその日にちにする",
    recurringPayload,
    createToolAnnotations,
    async (args) => {
      const item = await apiClient.post<RecurringItem>("/api/recurring-items", args as CreateRecurringItemPayload);
      return textContent(`予定収支を作成しました: ${item.name} ${formatRecurringItemAmount(item)}（${formatRecurringSchedule(item)}）`, { item: compactRecord(item) });
    },
  );

  registerTool(server,
    "update_recurring_item",
    "予定収支を更新する。type=transfer の振替は口座別予測に反映され、合計残高には中立。単発予定は recurrence=monthly、interval=1、startDate=endDate、dayOfMonth をその日にちにする",
    {
      id: uuidSchema.describe("予定収支 ID。取得元: list_recurring_items.items[].id"),
      ...recurringPayload,
    },
    updateToolAnnotations,
    async ({ id, ...payload }) => {
      const item = await apiClient.put<RecurringItem>(
        `/api/recurring-items/${id}`,
        payload as UpdateRecurringItemPayload,
      );
      return textContent(`予定収支を更新しました: ${item.name} ${formatRecurringItemAmount(item)}（${formatRecurringSchedule(item)}）`, { item: compactRecord(item) });
    },
  );

  registerTool(server,
    "delete_recurring_item",
    "予定収支を削除する。confirm が true でない場合は API の DELETE を呼ばず、対象予定収支の要約と再実行案内だけを返す。confirm: true の場合のみ削除を実行する",
    {
      id: uuidSchema.describe("予定収支 ID。取得元: list_recurring_items.items[].id"),
      confirm: confirmDeleteSchema,
    },
    deleteToolAnnotations,
    async ({ id, confirm }) => {
      if (confirm !== true) {
        const items = await apiClient.get<RecurringItemsResponse>("/api/recurring-items");
        const item = items.find((entry) => entry.id === id);
        return deletePreview(
          "予定収支",
          id,
          item ? `${item.name} ${item.type} ${formatRecurringItemAmount(item)}（${formatRecurringSchedule(item)}）` : null,
        );
      }

      await apiClient.delete(`/api/recurring-items/${id}`);
      return textContent(`予定収支を削除しました: ${id}`, { id, deleted: true, executed: true });
    },
  );
}
