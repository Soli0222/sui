import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ConfirmForecastPayload,
  DashboardEventsResponse,
  DashboardResponse,
  Transaction,
} from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { formatDashboardText } from "../format";
import { booleanFlagSchema, positiveMoneySchema, textContent, uuidSchema } from "../helpers";
import { z } from "zod";

function replaceDashboardEvents(
  dashboard: DashboardResponse,
  events: DashboardEventsResponse,
): DashboardResponse {
  const eventMap = new Map(events.accountForecasts.map((forecast) => [forecast.accountId, forecast.events]));

  return {
    ...dashboard,
    forecast: events.forecast,
    accountForecasts: dashboard.accountForecasts.map((forecast) => ({
      ...forecast,
      events: eventMap.get(forecast.accountId) ?? [],
    })),
  };
}

export function registerDashboardTools(server: McpServer, apiClient: SuiApiClient) {
  const buildDashboardPath = (applyOffset: boolean) => `/api/dashboard?applyOffset=${String(applyOffset)}`;
  const buildDashboardEventsPath = (months: number, applyOffset: boolean) =>
    `/api/dashboard/events?months=${months}&applyOffset=${String(applyOffset)}`;

  server.tool(
    "get_dashboard",
    "ダッシュボードデータ（残高予測・直近イベント・口座別予測）を取得する。予測は固定収支・クレジットカード請求・ローン返済から生成し、サブスク台帳は二重計上防止のため含めない",
    {
      months: z.number().int().min(1).max(24).optional().describe("予測イベントの取得期間（月数、省略時は既定の24ヶ月）"),
      applyOffset: booleanFlagSchema.optional().describe("残高オフセットを適用するか"),
    },
    async ({ months, applyOffset = true }) => {
      const dashboard = await apiClient.get<DashboardResponse>(buildDashboardPath(applyOffset));
      const data = months
        ? replaceDashboardEvents(
            dashboard,
            await apiClient.get<DashboardEventsResponse>(buildDashboardEventsPath(months, applyOffset)),
          )
        : dashboard;
      const now = new Date();
      const today = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return textContent(formatDashboardText(data, today));
    },
  );

  server.tool(
    "confirm_forecast",
    "実際の金額と口座を人間が確認した予測イベントを、手動で実取引として確定する。予定額と実績額は一致しないことがあるため、自動確定目的では使わない",
    {
      forecastEventId: z.string().min(1).describe("手動確認済みの予測イベント ID"),
      amount: positiveMoneySchema.describe("実績確認後の確定金額（円単位）"),
      accountId: uuidSchema.optional().describe("実績確認後の口座 ID（イベント設定口座から変更する場合のみ指定）"),
    },
    async (args) => {
      const result = await apiClient.post<Transaction>("/api/dashboard/confirm", args as ConfirmForecastPayload);
      return textContent(`手動確認済みの予測を確定しました: ${result.description} ¥${result.amount.toLocaleString("ja-JP")}`);
    },
  );
}
