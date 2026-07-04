import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  AccountsResponse,
  ConfirmForecastPayload,
  DashboardEventsResponse,
  DashboardResponse,
  Transaction,
} from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { formatDashboardText } from "../format";
import { booleanFlagSchema, positiveMoneySchema, supportedCurrencyCodeSchema, textContent, uuidSchema } from "../helpers";
import { z } from "zod";

const reviewOverdueEventSchema = z.object({
  id: z.string(),
  date: z.string(),
  type: z.enum(["income", "expense"]),
  description: z.string(),
  amount: z.number(),
  amountJpy: z.number(),
  currencyCode: supportedCurrencyCodeSchema,
  accountId: z.string().nullable(),
  accountName: z.string().nullable(),
});

const reviewOverdueGuidance =
  "各イベントについてユーザーに実際の金額と口座を確認し、確認が取れたものだけ confirm_forecast で確定してください。自動で確定してはいけません。";

function formatReviewAmount(event: z.infer<typeof reviewOverdueEventSchema>) {
  const amount = event.amount.toLocaleString("ja-JP");
  const amountJpy = event.amountJpy.toLocaleString("ja-JP");

  if (event.currencyCode === "JPY") {
    return `¥${amount}`;
  }

  return `${event.currencyCode} ${amount}（¥${amountJpy}）`;
}

function formatReviewOverdueText(events: Array<z.infer<typeof reviewOverdueEventSchema>>) {
  if (events.length === 0) {
    return "予定日超過の未確定イベントはありません。";
  }

  const lines = [`予定日超過の未確定イベント: ${events.length}件`, ""];
  for (const event of events) {
    const typeLabel = event.type === "income" ? "収入" : "支出";
    lines.push(
      `[${event.id}] ${event.date} ${typeLabel} ${event.description} ${formatReviewAmount(event)} ${event.accountName ?? "口座未解決"}`,
    );
  }
  lines.push("", reviewOverdueGuidance);

  return lines.join("\n");
}

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

  server.registerTool(
    "review_overdue_events",
    {
      description: "予定日を過ぎた未確定の予測イベントを確認用に一覧する（読み取り専用）。確定には人間の確認を経て confirm_forecast を使う",
      inputSchema: {},
      outputSchema: {
        overdueCount: z.number().int().nonnegative(),
        events: z.array(reviewOverdueEventSchema),
      },
      annotations: { readOnlyHint: true },
    },
    async () => {
      const [dashboard, accounts] = await Promise.all([
        apiClient.get<DashboardResponse>("/api/dashboard"),
        apiClient.get<AccountsResponse>("/api/accounts"),
      ]);
      const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
      const events = (dashboard.overdueForecast ?? []).map((event) => ({
        id: event.id,
        date: event.date,
        type: event.type,
        description: event.description,
        amount: event.amount,
        amountJpy: event.amountJpy,
        currencyCode: event.currencyCode,
        accountId: event.accountId,
        accountName: event.accountId ? accountNames.get(event.accountId) ?? null : null,
      }));
      const structuredContent = {
        overdueCount: events.length,
        events,
      };

      return {
        content: [{ type: "text" as const, text: formatReviewOverdueText(events) }],
        structuredContent,
      };
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
