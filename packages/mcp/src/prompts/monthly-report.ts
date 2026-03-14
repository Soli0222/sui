import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AccountsResponse, BillingResponse, DashboardResponse } from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { buildMonthlyReportPrompt, yearMonthSchema } from "../helpers";

export function registerMonthlyReportPrompt(server: McpServer, apiClient: SuiApiClient) {
  server.prompt(
    "monthly-report",
    "指定月の収支レポートを生成する",
    {
      month: yearMonthSchema.describe("対象月（YYYY-MM）"),
    },
    async ({ month }) => {
      const [dashboard, billing, accounts] = await Promise.all([
        apiClient.get<DashboardResponse>("/api/dashboard"),
        apiClient.get<BillingResponse>(`/api/billings?month=${month}`),
        apiClient.get<AccountsResponse>("/api/accounts"),
      ]);

      return {
        messages: [{
          role: "user" as const,
          content: {
            type: "text" as const,
            text: buildMonthlyReportPrompt(month, dashboard, billing, accounts),
          },
        }],
      };
    },
  );
}
