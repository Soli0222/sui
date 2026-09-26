import { dayOfMonthSchema, dayOfWeekSchema, intervalSchema, name100Schema, recurrenceSchema } from "../../schemas/fields";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CreateSubscriptionPayload,
  Subscription,
  SubscriptionAmountChange,
  SubscriptionMonthlyResponse,
  SubscriptionsResponse,
  UpdateSubscriptionPayload,
} from "@sui/shared";
import { z } from "zod";
import type { SuiApiClient } from "../client";
import { formatCurrency, formatSubscriptionSchedule, formatSubscriptionsText } from "../format";
import {
  confirmDeleteSchema,
  createToolAnnotations,
  dateSchema,
  deleteToolAnnotations,
  deletePreview,
  positiveMoneySchema,
  readOnlyToolAnnotations,
  supportedCurrencyCodeSchema,
  textContent,
  updateToolAnnotations,
  uuidSchema,
  registerTool,
} from "../helpers";

const subscriptionPayload = {
  name: name100Schema.describe("サービス名"),
  amount: positiveMoneySchema.describe("支払額：対象通貨の最小単位の整数（JPYは円、USD/EURはセント。USD 250.00は25000）"),
  currencyCode: supportedCurrencyCodeSchema.optional().describe("通貨コード（JPY/USD/EUR）。省略時は JPY"),
  exchangeRateToJpy: z.number().positive().optional().describe("JPY 換算レート。通貨が JPY 以外の場合に指定。省略時は 1"),
  recurrence: recurrenceSchema.optional().describe("繰り返し種別。monthly または weekly。省略時は monthly"),
  interval: intervalSchema.optional().describe("課金周期。monthly は N ヶ月ごと、weekly は N 週ごと。省略時は 1"),
  startDate: dateSchema.describe("課金開始日"),
  dayOfMonth: dayOfMonthSchema.nullable().optional().describe("課金日（1-31）。monthly の場合のみ指定（weekly では null または未指定）"),
  dayOfWeek: dayOfWeekSchema.nullable().optional().describe("曜日（0=日曜、6=土曜）。weekly の場合のみ指定（monthly では null または未指定）"),
  endDate: dateSchema.nullable().optional().describe("終了日"),
  paymentSource: z.string().max(100).nullable().optional().describe("支払い元メモ（カード名など）"),
};

export function registerSubscriptionTools(server: McpServer, apiClient: SuiApiClient) {
  registerTool(server,
    "list_subscriptions",
    "サブスク台帳の一覧を取得する。サブスクは残高予測に直接反映されず、カード払い分はクレジットカード請求額に含めて扱う",
    {},
    readOnlyToolAnnotations,
    async () => {
      const data = await apiClient.get<SubscriptionsResponse>("/api/subscriptions");
      return textContent(formatSubscriptionsText(data), { items: data, complete: true });
    },
  );

  registerTool(server, "get_subscription", "サブスクの詳細を ID で取得する", { id: uuidSchema.describe("取得元: list_subscriptions.items[].id") }, readOnlyToolAnnotations, async ({ id }) => {
    const item = await apiClient.get<Subscription>(`/api/subscriptions/${id}`);
    return textContent(`サブスク: ${item.name}`, { item });
  });

  registerTool(server, "get_subscription_monthly", "指定月のサブスク課金日、適用価格、JPY 換算合計を取得する", {
    yearMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).describe("対象月（YYYY-MM）"),
  }, readOnlyToolAnnotations, async ({ yearMonth }) => {
    const data = await apiClient.get<SubscriptionMonthlyResponse>(`/api/subscriptions/monthly/${yearMonth}`);
    return textContent(`${yearMonth} のサブスク: ${data.items.length}件`, {
      yearMonth,
      ...data,
      items: data.items.map((entry) => ({ ...entry, currencyCode: entry.subscription.currencyCode })),
      complete: true,
      totalsCurrencyCode: "JPY",
    });
  });

  registerTool(server,
    "create_subscription",
    "サブスク台帳を作成する。残高予測へ直接追加する操作ではない",
    subscriptionPayload,
    createToolAnnotations,
    async (args) => {
      const subscription = await apiClient.post<Subscription>(
        "/api/subscriptions",
        args as CreateSubscriptionPayload,
      );
      return textContent(
        `サブスク台帳を作成しました: ${subscription.name} ${formatCurrency(subscription.amount, subscription.currencyCode)}（残高予測には直接反映されません）`, { item: subscription },
      );
    },
  );

  registerTool(server,
    "update_subscription",
    "サブスク台帳を更新する。残高予測へ直接追加する操作ではない",
    {
      id: uuidSchema.describe("サブスク ID。取得元: list_subscriptions.items[].id"),
      ...subscriptionPayload,
    },
    updateToolAnnotations,
    async ({ id, ...payload }) => {
      const subscription = await apiClient.put<Subscription>(
        `/api/subscriptions/${id}`,
        payload as UpdateSubscriptionPayload,
      );
      return textContent(
        `サブスク台帳を更新しました: ${subscription.name} ${formatCurrency(subscription.amount, subscription.currencyCode)}（残高予測には直接反映されません）`, { item: subscription },
      );
    },
  );

  registerTool(server,
    "delete_subscription",
    "サブスク台帳から削除する。残高予測へ直接反映する操作ではない。confirm が true でない場合は API の DELETE を呼ばず、対象サブスクの要約と再実行案内だけを返す。confirm: true の場合のみ削除を実行する",
    {
      id: uuidSchema.describe("サブスク ID。取得元: list_subscriptions.items[].id"),
      confirm: confirmDeleteSchema,
    },
    deleteToolAnnotations,
    async ({ id, confirm }) => {
      if (confirm !== true) {
        const subscriptions = await apiClient.get<SubscriptionsResponse>("/api/subscriptions");
        const subscription = subscriptions.find((entry) => entry.id === id);
        return deletePreview(
          "サブスク",
          id,
          subscription ? `${subscription.name} ${formatCurrency(subscription.amount, subscription.currencyCode)}（${formatSubscriptionSchedule(subscription)}）` : null,
        );
      }

      await apiClient.delete(`/api/subscriptions/${id}`);
      return textContent(`サブスクを削除しました: ${id}`, { id, deleted: true, executed: true });
    },
  );

  registerTool(server,
    "list_subscription_amount_changes",
    "サブスクの価格履歴を取得する。subscriptionId は list_subscriptions の ID を使う。返却された履歴 ID は訂正・削除に使う",
    { subscriptionId: uuidSchema.describe("サブスク ID。取得元: list_subscriptions.items[].id") },
    readOnlyToolAnnotations,
    async ({ subscriptionId }) => {
      const subscriptions = await apiClient.get<SubscriptionsResponse>("/api/subscriptions");
      const subscription = subscriptions.find((item) => item.id === subscriptionId);

      const changes = await apiClient.get<SubscriptionAmountChange[]>(`/api/subscriptions/${subscriptionId}/amount-changes`);
      return textContent("操作結果", { subscriptionId, currencyCode: subscription?.currencyCode, initialAmount: subscription?.amount, effectiveAmount: subscription?.effectiveAmount, amountChanges: changes });
    },
  );

  registerTool(server,
    "create_subscription_amount_change",
    "サブスクの価格変更を予約する。適用開始日は契約開始日より後に指定する。初日からの金額は初期金額を訂正する。subscriptionId は list_subscriptions の ID。金額は対象通貨の最小単位（JPYは円、USD/EURはセント）",
    { subscriptionId: uuidSchema.describe("取得元: list_subscriptions.items[].id"), effectiveFrom: dateSchema, amount: positiveMoneySchema },
    createToolAnnotations,
    async ({ subscriptionId, effectiveFrom, amount }) => {
      const change = await apiClient.post<SubscriptionAmountChange>(`/api/subscriptions/${subscriptionId}/amount-changes`, { effectiveFrom, amount });
      const subscriptions = await apiClient.get<SubscriptionsResponse>("/api/subscriptions");
      const currencyCode = subscriptions.find((item) => item.id === subscriptionId)?.currencyCode;
      return textContent("操作結果", { ...change, currencyCode });
    },
  );

  registerTool(server,
    "update_subscription_amount_change",
    "既存の価格履歴を訂正する。適用開始日は契約開始日より後に指定する。subscriptionId は list_subscriptions、changeId は list_subscription_amount_changes から取得する。過去の台帳集計が変わる場合がある",
    { subscriptionId: uuidSchema.describe("取得元: list_subscriptions.items[].id"), changeId: uuidSchema.describe("取得元: list_subscription_amount_changes.amountChanges[].id"), effectiveFrom: dateSchema, amount: positiveMoneySchema },
    updateToolAnnotations,
    async ({ subscriptionId, changeId, effectiveFrom, amount }) => {
      const change = await apiClient.put<SubscriptionAmountChange>(`/api/subscriptions/${subscriptionId}/amount-changes/${changeId}`, { effectiveFrom, amount });
      const subscriptions = await apiClient.get<SubscriptionsResponse>("/api/subscriptions");
      const currencyCode = subscriptions.find((item) => item.id === subscriptionId)?.currencyCode;
      return textContent("操作結果", { ...change, currencyCode });
    },
  );

  registerTool(server,
    "delete_subscription_amount_change",
    "価格履歴を削除する。subscriptionId は list_subscriptions、changeId は list_subscription_amount_changes から取得する。過去の台帳集計が変わる場合がある。confirm: true の場合のみ削除する",
    { subscriptionId: uuidSchema.describe("取得元: list_subscriptions.items[].id"), changeId: uuidSchema.describe("取得元: list_subscription_amount_changes.amountChanges[].id"), confirm: confirmDeleteSchema },
    deleteToolAnnotations,
    async ({ subscriptionId, changeId, confirm }) => {
      if (confirm !== true) {
        const subscriptions = await apiClient.get<SubscriptionsResponse>("/api/subscriptions");
        const subscription = subscriptions.find((item) => item.id === subscriptionId);
        const changes = subscription ? await apiClient.get<SubscriptionAmountChange[]>(`/api/subscriptions/${subscriptionId}/amount-changes`) : [];
        const change = changes.find((item) => item.id === changeId);
        return deletePreview("サブスク価格履歴", changeId,
          change && subscription ? `${subscription.name} [${subscriptionId}] ${change.effectiveFrom} から ${formatCurrency(change.amount, subscription.currencyCode)}` : null, { subscriptionId, changeId });
      }
      await apiClient.delete(`/api/subscriptions/${subscriptionId}/amount-changes/${changeId}`);
      return textContent("操作結果", { subscriptionId, changeId, id: changeId, deleted: true, executed: true });
    },
  );
}
