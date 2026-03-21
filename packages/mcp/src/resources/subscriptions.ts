import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SubscriptionsResponse } from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { jsonResource } from "../helpers";

export function registerSubscriptionResources(server: McpServer, apiClient: SuiApiClient) {
  server.resource(
    "subscriptions",
    "sui://subscriptions",
    { description: "サブスク一覧" },
    async (uri) => {
      const data = await apiClient.get<SubscriptionsResponse>("/api/subscriptions");
      return jsonResource(uri.href, data);
    },
  );
}
