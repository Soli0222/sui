import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DashboardResponse } from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { formatForecastSummary } from "../format";
import { jsonResource, textResource } from "../helpers";

export function registerDashboardResources(server: McpServer, apiClient: SuiApiClient) {
  server.resource(
    "dashboard",
    "sui://dashboard",
    { description: "残高予測を含むダッシュボード全体のデータ" },
    async (uri) => {
      const data = await apiClient.get<DashboardResponse>("/api/dashboard");
      return jsonResource(uri.href, data);
    },
  );

  server.resource(
    "forecast-summary",
    "sui://forecast/summary",
    { description: "残高予測の自然言語向け要約テキスト" },
    async (uri) => {
      const data = await apiClient.get<DashboardResponse>("/api/dashboard");
      return textResource(uri.href, formatForecastSummary(data));
    },
  );
}
