import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ConfirmForecastPayload, DashboardResponse, Transaction } from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { formatDashboardText } from "../format";
import { positiveMoneySchema, textContent, uuidSchema } from "../helpers";
import { z } from "zod";

export function registerDashboardTools(server: McpServer, apiClient: SuiApiClient) {
  server.tool(
    "get_dashboard",
    "ダッシュボードデータ（残高予測・直近イベント・口座別予測）を取得する",
    {},
    async () => {
      const data = await apiClient.get<DashboardResponse>("/api/dashboard");
      const now = new Date();
      const today = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return textContent(formatDashboardText(data, today));
    },
  );

  server.tool(
    "confirm_forecast",
    "ダッシュボード上の予測イベントを実取引として確定する",
    {
      forecastEventId: z.string().min(1).describe("予測イベント ID"),
      amount: positiveMoneySchema.describe("確定金額（円単位）"),
      accountId: uuidSchema.optional().describe("口座 ID（変更する場合のみ指定）"),
    },
    async (args) => {
      const result = await apiClient.post<Transaction>("/api/dashboard/confirm", args as ConfirmForecastPayload);
      return textContent(`予測を確定しました: ${result.description} ¥${result.amount.toLocaleString("ja-JP")}`);
    },
  );
}
