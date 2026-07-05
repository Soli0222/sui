import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  AccountsResponse,
  ConfirmForecastPayload,
  DashboardEventsResponse,
  DashboardExplainResponse,
  DashboardResponse,
  DashboardSimulationPayload,
  DashboardSimulationResponse,
  Transaction,
} from "@sui/shared";
import type { SuiApiClient } from "../api-client";
import { formatDashboardText } from "../format";
import {
  booleanFlagSchema,
  dateSchema,
  positiveMoneySchema,
  readOnlyToolAnnotations,
  supportedCurrencyCodeSchema,
  textContent,
  updateToolAnnotations,
  uuidSchema,
} from "../helpers";
import { z } from "zod";

const reviewOverdueEventSchema = z.object({
  id: z.string(),
  date: z.string(),
  type: z.enum(["income", "expense", "transfer"]),
  description: z.string(),
  amount: z.number(),
  amountJpy: z.number(),
  currencyCode: supportedCurrencyCodeSchema,
  accountId: z.string().nullable(),
  accountName: z.string().nullable(),
  transferToAccountId: z.string().nullable(),
  transferToAccountName: z.string().nullable(),
});

const reviewOverdueGuidance =
  "各イベントについてユーザーに実際の金額と口座を確認し、確認が取れたものだけ confirm_forecast で確定してください。自動で確定してはいけません。";

const currencyFormatter = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

const forecastSourceSchema = z.enum(["recurring", "credit-card", "loan", "transfer"]);

const explainEventSchema = z.object({
  id: z.string(),
  date: z.string(),
  description: z.string(),
  type: z.enum(["income", "expense", "transfer"]),
  source: forecastSourceSchema,
  isAssumption: z.boolean(),
  amountJpy: z.number(),
  runningBalance: z.number(),
});

const explainSourceTotalsSchema = z.object({
  recurringIncomeJpy: z.number(),
  recurringExpenseJpy: z.number(),
  creditCardJpy: z.number(),
  loanJpy: z.number(),
  transferJpy: z.number(),
});

const explainOutputSchema = {
  date: z.string(),
  accountId: z.string().nullable(),
  startBalance: z.number(),
  events: z.array(explainEventSchema),
  sourceTotals: explainSourceTotalsSchema,
  finalBalance: z.number(),
  assumptionEventCount: z.number().int().nonnegative(),
};

const simulationSummarySchema = z.object({
  minBalance: z.number(),
  minBalanceDate: z.string().nullable(),
  finalBalance: z.number(),
  warningAccountCount: z.number().int().nonnegative(),
});

const simulationOutputSchema = {
  baseline: simulationSummarySchema,
  simulated: simulationSummarySchema,
  delta: z.object({
    minBalance: z.number(),
    finalBalance: z.number(),
    warningAccountCount: z.number().int(),
  }),
};

function formatJpy(amount: number) {
  return currencyFormatter.format(amount);
}

function formatSignedJpy(amount: number) {
  if (amount > 0) {
    return `+${formatJpy(amount)}`;
  }
  if (amount < 0) {
    return `-${formatJpy(Math.abs(amount))}`;
  }
  return formatJpy(0);
}

function formatReviewAmount(event: z.infer<typeof reviewOverdueEventSchema>) {
  const amount = event.amount.toLocaleString("ja-JP");
  const amountJpy = event.amountJpy.toLocaleString("ja-JP");

  if (event.currencyCode === "JPY") {
    return `¥${amount}`;
  }

  return `${event.currencyCode} ${amount}（¥${amountJpy}）`;
}

function formatReviewEventType(type: z.infer<typeof reviewOverdueEventSchema>["type"]) {
  if (type === "income") {
    return "収入";
  }

  if (type === "expense") {
    return "支出";
  }

  return "振替";
}

function formatSourceLabel(source: DashboardExplainResponse["events"][number]["source"]) {
  if (source === "recurring") {
    return "固定収支";
  }

  if (source === "credit-card") {
    return "クレジットカード";
  }

  if (source === "loan") {
    return "ローン";
  }

  return "振替";
}

function formatForecastEventType(type: DashboardExplainResponse["events"][number]["type"]) {
  if (type === "income") {
    return "収入";
  }

  if (type === "expense") {
    return "支出";
  }

  return "振替";
}

function formatExplainForecastText(data: DashboardExplainResponse) {
  const lines = [
    `起点残高: ${formatJpy(data.startBalance)}`,
    "",
    "寄与イベント:",
  ];

  if (data.events.length === 0) {
    lines.push("  ありません");
  } else {
    for (const event of data.events) {
      const assumption = event.isAssumption ? " 仮定" : "";
      lines.push(
        `  ${event.date} ${formatForecastEventType(event.type)} ${formatSourceLabel(event.source)}${assumption}: ${event.description} ${formatJpy(event.amountJpy)} -> ${formatJpy(event.runningBalance)}`,
      );
    }
  }

  lines.push(
    "",
    "source 別小計:",
    `  固定収入: ${formatSignedJpy(data.sourceTotals.recurringIncomeJpy)}`,
    `  固定支出: ${formatSignedJpy(data.sourceTotals.recurringExpenseJpy)}`,
    `  クレジットカード: ${formatSignedJpy(data.sourceTotals.creditCardJpy)}`,
    `  ローン: ${formatSignedJpy(data.sourceTotals.loanJpy)}`,
    `  振替: ${formatSignedJpy(data.sourceTotals.transferJpy)}`,
    "",
    `指定日残高: ${formatJpy(data.finalBalance)}`,
    `仮定値 ${data.assumptionEventCount} 件を含む予測です`,
  );

  return lines.join("\n");
}

function formatSimulationSummary(label: string, summary: DashboardSimulationResponse["baseline"]) {
  const minDate = summary.minBalanceDate ?? "該当なし";
  return `${label}: 最小残高 ${formatJpy(summary.minBalance)}（${minDate}） / 期末残高 ${formatJpy(summary.finalBalance)} / 警告口座 ${summary.warningAccountCount}件`;
}

function formatSimulateForecastText(data: DashboardSimulationResponse) {
  return [
    "what-if 予測（読み取り専用、DB 変更なし）",
    "",
    formatSimulationSummary("baseline", data.baseline),
    formatSimulationSummary("simulated", data.simulated),
    `delta: 最小残高 ${formatSignedJpy(data.delta.minBalance)} / 期末残高 ${formatSignedJpy(data.delta.finalBalance)} / 警告口座 ${data.delta.warningAccountCount >= 0 ? "+" : ""}${data.delta.warningAccountCount}件`,
  ].join("\n");
}

function formatReviewAccount(event: z.infer<typeof reviewOverdueEventSchema>) {
  if (event.type === "transfer") {
    return `${event.accountName ?? "口座未解決"} → ${event.transferToAccountName ?? "口座未解決"}`;
  }

  return event.accountName ?? "口座未解決";
}

function formatReviewOverdueText(events: Array<z.infer<typeof reviewOverdueEventSchema>>) {
  if (events.length === 0) {
    return "予定日超過の未確定イベントはありません。";
  }

  const lines = [`予定日超過の未確定イベント: ${events.length}件`, ""];
  for (const event of events) {
    const typeLabel = formatReviewEventType(event.type);
    lines.push(
      `[${event.id}] ${event.date} ${typeLabel} ${event.description} ${formatReviewAmount(event)} ${formatReviewAccount(event)}`,
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
  const buildExplainForecastPath = ({
    date,
    accountId,
    applyOffset,
  }: {
    date: string;
    accountId?: string;
    applyOffset: boolean;
  }) => {
    const params = new URLSearchParams({
      date,
      applyOffset: String(applyOffset),
    });
    if (accountId) {
      params.set("accountId", accountId);
    }
    return `/api/dashboard/explain?${params.toString()}`;
  };

  server.tool(
    "get_dashboard",
    "ダッシュボードデータ（残高予測・直近イベント・口座別予測）を取得する。予測は固定収支・クレジットカード請求・ローン返済から生成し、サブスク台帳は二重計上防止のため含めない",
    {
      months: z.number().int().min(1).max(24).optional().describe("予測イベントの取得期間（月数、省略時は既定の24ヶ月）"),
      applyOffset: booleanFlagSchema.optional().describe("残高オフセットを適用するか"),
    },
    readOnlyToolAnnotations,
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
        transferToAccountId: event.transferToAccountId ?? null,
        transferToAccountName: event.transferToAccountId
          ? accountNames.get(event.transferToAccountId) ?? null
          : null,
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

  server.registerTool(
    "explain_forecast",
    {
      description: "指定日までの残高予測について、起点残高、寄与イベント、source 別小計、指定日残高を説明する（読み取り専用）",
      inputSchema: {
        date: dateSchema.describe("説明対象日（YYYY-MM-DD）"),
        accountId: uuidSchema.optional().describe("口座別に説明する場合の口座 ID"),
        applyOffset: booleanFlagSchema.optional().describe("残高オフセットを適用するか"),
      },
      outputSchema: explainOutputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ date, accountId, applyOffset = true }) => {
      const data = await apiClient.get<DashboardExplainResponse>(
        buildExplainForecastPath({ date, accountId, applyOffset }),
      );

      return {
        content: [{ type: "text" as const, text: formatExplainForecastText(data) }],
        structuredContent: data as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "simulate_forecast",
    {
      description: "what-if の残高予測を実行する。POST を使うが読み取り専用で、DB は変更しない",
      inputSchema: {
        months: z.number().int().min(1).max(24).optional().describe("予測期間（月数）"),
        applyOffset: booleanFlagSchema.optional().describe("残高オフセットを適用するか"),
        exclude: z.object({
          recurringItemIds: z.array(uuidSchema).optional().describe("除外する固定収支 ID"),
          loanIds: z.array(uuidSchema).optional().describe("除外するローン ID"),
          creditCardIds: z.array(uuidSchema).optional().describe("除外するクレジットカード ID"),
        }).optional().describe("シミュレーション上だけ除外する対象"),
        cardAssumptionOverrides: z.array(z.object({
          creditCardId: uuidSchema.describe("クレジットカード ID"),
          assumptionAmount: positiveMoneySchema.describe("シミュレーション上だけ使う正の仮定請求額"),
        })).optional().describe("シミュレーション上だけ上書きするカード仮定請求額"),
      },
      outputSchema: simulationOutputSchema,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const data = await apiClient.post<DashboardSimulationResponse>(
        "/api/dashboard/simulate",
        args as DashboardSimulationPayload,
      );

      return {
        content: [{ type: "text" as const, text: formatSimulateForecastText(data) }],
        structuredContent: data as unknown as Record<string, unknown>,
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
    updateToolAnnotations,
    async (args) => {
      const result = await apiClient.post<Transaction>("/api/dashboard/confirm", args as ConfirmForecastPayload);
      return textContent(`手動確認済みの予測を確定しました: ${result.description} ¥${result.amount.toLocaleString("ja-JP")}`);
    },
  );
}
