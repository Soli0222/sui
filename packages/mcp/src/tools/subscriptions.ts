import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CreateSubscriptionPayload,
  Subscription,
  SubscriptionsResponse,
  UpdateSubscriptionPayload,
} from "@sui/shared";
import { z } from "zod";
import type { SuiApiClient } from "../api-client";
import { formatSubscriptionsText } from "../format";
import { dateSchema, positiveMoneySchema, textContent, uuidSchema } from "../helpers";

const subscriptionPayload = {
  name: z.string().min(1).max(100).describe("サービス名"),
  amount: positiveMoneySchema.describe("支払額"),
  intervalMonths: z.number().int().positive().describe("課金周期（月数）"),
  startDate: dateSchema.describe("課金開始日"),
  dayOfMonth: z.number().int().min(1).max(31).describe("課金日"),
  endDate: dateSchema.nullable().optional().describe("終了日"),
  paymentSource: z.string().max(100).nullable().optional().describe("支払い元"),
};

export function registerSubscriptionTools(server: McpServer, apiClient: SuiApiClient) {
  server.tool("list_subscriptions", "サブスク一覧を取得する", {}, async () => {
    const data = await apiClient.get<SubscriptionsResponse>("/api/subscriptions");
    return textContent(formatSubscriptionsText(data));
  });

  server.tool("create_subscription", "サブスクを作成する", subscriptionPayload, async (args) => {
    const subscription = await apiClient.post<Subscription>(
      "/api/subscriptions",
      args as CreateSubscriptionPayload,
    );
    return textContent(`サブスクを作成しました: ${subscription.name} ¥${subscription.amount.toLocaleString("ja-JP")}`);
  });

  server.tool(
    "update_subscription",
    "サブスクを更新する",
    {
      id: uuidSchema.describe("サブスク ID"),
      ...subscriptionPayload,
    },
    async ({ id, ...payload }) => {
      const subscription = await apiClient.put<Subscription>(
        `/api/subscriptions/${id}`,
        payload as UpdateSubscriptionPayload,
      );
      return textContent(`サブスクを更新しました: ${subscription.name} ¥${subscription.amount.toLocaleString("ja-JP")}`);
    },
  );

  server.tool(
    "delete_subscription",
    "サブスクを削除する",
    { id: uuidSchema.describe("サブスク ID") },
    async ({ id }) => {
      await apiClient.delete(`/api/subscriptions/${id}`);
      return textContent(`サブスクを削除しました: ${id}`);
    },
  );
}
