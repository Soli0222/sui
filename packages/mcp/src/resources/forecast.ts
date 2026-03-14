import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BillingResponse } from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { jsonResource, yearMonthSchema } from "../helpers";

export function registerForecastResources(server: McpServer, apiClient: SuiApiClient) {
  server.resource(
    "billings",
    new ResourceTemplate("sui://billings/{yearMonth}", { list: undefined }),
    { description: "指定月のクレジットカード請求データ（YYYY-MM形式）" },
    async (uri, variables) => {
      const yearMonth = yearMonthSchema.parse(variables.yearMonth);
      const data = await apiClient.get<BillingResponse>(`/api/billings?month=${yearMonth}`);
      return jsonResource(uri.href, data);
    },
  );
}
