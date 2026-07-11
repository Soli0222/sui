import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CreateSubscriptionPayload,
  Subscription,
  SubscriptionsResponse,
  UpdateSubscriptionPayload,
} from "@sui/shared";
import { z } from "zod";
import type { SuiApiClient } from "../api-client";
import { formatSubscriptionSchedule, formatSubscriptionsText } from "../format";
import {
  confirmDeleteSchema,
  createToolAnnotations,
  dateSchema,
  deleteToolAnnotations,
  formatDeletePreview,
  positiveMoneySchema,
  readOnlyToolAnnotations,
  textContent,
  updateToolAnnotations,
  uuidSchema,
} from "../helpers";

const subscriptionPayload = {
  name: z.string().min(1).max(100).describe("サービス名"),
  amount: positiveMoneySchema.describe("支払額"),
  recurrence: z.enum(["monthly", "weekly"]).optional().describe("繰り返し種別。省略時は monthly"),
  intervalMonths: z.number().int().positive().nullable().optional().describe("課金周期（月数）。monthly の場合に指定"),
  startDate: dateSchema.describe("課金開始日"),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional().describe("課金日（1-31）。monthly の場合に指定"),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional().describe("曜日（0=日曜、6=土曜）。weekly の場合に指定"),
  endDate: dateSchema.nullable().optional().describe("終了日"),
  paymentSource: z.string().max(100).nullable().optional().describe("支払い元メモ（カード名など）"),
};

export function registerSubscriptionTools(server: McpServer, apiClient: SuiApiClient) {
  server.tool(
    "list_subscriptions",
    "サブスク台帳の一覧を取得する。サブスクは残高予測に直接反映されず、カード払い分はクレジットカード請求額に含めて扱う",
    {},
    readOnlyToolAnnotations,
    async () => {
      const data = await apiClient.get<SubscriptionsResponse>("/api/subscriptions");
      return textContent(formatSubscriptionsText(data));
    },
  );

  server.tool(
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
        `サブスク台帳を作成しました: ${subscription.name} ¥${subscription.amount.toLocaleString("ja-JP")}（残高予測には直接反映されません）`,
      );
    },
  );

  server.tool(
    "update_subscription",
    "サブスク台帳を更新する。残高予測へ直接追加する操作ではない",
    {
      id: uuidSchema.describe("サブスク ID"),
      ...subscriptionPayload,
    },
    updateToolAnnotations,
    async ({ id, ...payload }) => {
      const subscription = await apiClient.put<Subscription>(
        `/api/subscriptions/${id}`,
        payload as UpdateSubscriptionPayload,
      );
      return textContent(
        `サブスク台帳を更新しました: ${subscription.name} ¥${subscription.amount.toLocaleString("ja-JP")}（残高予測には直接反映されません）`,
      );
    },
  );

  server.tool(
    "delete_subscription",
    "サブスク台帳から削除する。残高予測へ直接反映する操作ではない。confirm が true でない場合は API の DELETE を呼ばず、対象サブスクの要約と再実行案内だけを返す。confirm: true の場合のみ削除を実行する",
    {
      id: uuidSchema.describe("サブスク ID"),
      confirm: confirmDeleteSchema,
    },
    deleteToolAnnotations,
    async ({ id, confirm }) => {
      if (confirm !== true) {
        const subscriptions = await apiClient.get<SubscriptionsResponse>("/api/subscriptions");
        const subscription = subscriptions.find((entry) => entry.id === id);
        return textContent(formatDeletePreview(
          "サブスク",
          id,
          subscription ? `${subscription.name} ¥${subscription.amount.toLocaleString("ja-JP")}（${formatSubscriptionSchedule(subscription)}）` : null,
        ));
      }

      await apiClient.delete(`/api/subscriptions/${id}`);
      return textContent(`サブスクを削除しました: ${id}`);
    },
  );
}
