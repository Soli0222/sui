import type { Account, DashboardEventsResponse, DashboardResponse, ForecastEvent } from "@sui/shared";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState, startTransition } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Table, TableWrapper } from "../components/ui/table";
import { useResource } from "../hooks/use-resource";
import { apiFetch } from "../lib/api";
import { formatChartDateWithYear, formatCurrency, formatDateWithYear } from "../lib/format";
import { getTodayDate } from "../lib/utils";

type DashboardPeriodPreset = "next1Month" | "next3Months" | "next6Months" | "next1Year" | "all";

const DEFAULT_DASHBOARD_PERIOD: DashboardPeriodPreset = "next3Months";

const dashboardPeriodOptions: Array<{ value: DashboardPeriodPreset; label: string }> = [
  { value: "next1Month", label: "1ヶ月" },
  { value: "next3Months", label: "3ヶ月" },
  { value: "next6Months", label: "6ヶ月" },
  { value: "next1Year", label: "1年" },
  { value: "all", label: "全期間" },
];

const presetToMonths: Record<DashboardPeriodPreset, number> = {
  next1Month: 1,
  next3Months: 3,
  next6Months: 6,
  next1Year: 12,
  all: 24,
};

export function DashboardPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedTab, setSelectedTab] = useState<string>("total");
  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>(DEFAULT_DASHBOARD_PERIOD);
  const [selectedEvent, setSelectedEvent] = useState<ForecastEvent | null>(null);
  const [confirmAmount, setConfirmAmount] = useState(0);
  const [accountId, setAccountId] = useState("");
  const months = presetToMonths[periodPreset];

  const {
    data: dashboardData,
    loading: dashboardLoading,
    error: dashboardError,
  } = useResource(
    () =>
      Promise.all([
        apiFetch<DashboardResponse>("/api/dashboard"),
        apiFetch<Account[]>("/api/accounts"),
      ]).then(([dashboard, accounts]) => ({ dashboard, accounts })),
    [reloadKey],
  );
  const {
    data: eventsData,
    loading: eventsLoading,
    error: eventsError,
  } = useResource(
    () => apiFetch<DashboardEventsResponse>(`/api/dashboard/events?months=${months}`),
    [reloadKey, months],
  );

  const today = getTodayDate();
  const accounts = dashboardData?.accounts ?? [];
  const accountForecasts = dashboardData?.dashboard.accountForecasts ?? [];
  const selectedAccountForecast =
    selectedTab === "total"
      ? null
      : accountForecasts.find((forecast) => forecast.accountId === selectedTab) ?? null;
  const selectedAccountEvents =
    selectedTab === "total"
      ? null
      : eventsData?.accountForecasts.find((forecast) => forecast.accountId === selectedTab) ?? null;
  const chartForecast = selectedAccountForecast?.events ?? dashboardData?.dashboard.forecast ?? [];
  const tableForecast = selectedAccountEvents?.events ?? eventsData?.forecast ?? [];
  const currentBalance =
    selectedAccountForecast?.currentBalance ?? dashboardData?.dashboard.totalBalance ?? 0;
  const chartData = [
    {
      id: "today-marker",
      date: today,
      description: selectedAccountForecast ? `${selectedAccountForecast.accountName} 現在残高` : "総所持金",
      amount: 0,
      balance: currentBalance,
      accountId: selectedAccountForecast?.accountId ?? null,
    },
    ...chartForecast,
  ];
  const chartDomain: [number, number] =
    chartData.length === 0
      ? [0, 1]
      : (() => {
          const balances = chartData.map((point) => point.balance);
          const minBalance = Math.min(...balances);
          const maxBalance = Math.max(...balances);

          if (minBalance === maxBalance) {
            const padding = Math.max(Math.abs(minBalance) * 0.08, 10_000);
            return [minBalance - padding, maxBalance + padding];
          }

          const padding = Math.max((maxBalance - minBalance) * 0.12, 10_000);
          return [minBalance - padding, maxBalance + padding];
        })();
  const showZeroLine = chartDomain[0] <= 0 && chartDomain[1] >= 0;
  const negativeForecasts = accountForecasts
    .filter((forecast) => forecast.willBeNegative)
    .map((forecast) => ({
      accountName: forecast.accountName,
      firstNegativeDate: forecast.events.find((event) => event.balance < 0)?.date ?? forecast.minBalanceDate,
    }));

  const openConfirm = (event: ForecastEvent) => {
    setSelectedEvent(event);
    setConfirmAmount(event.amount);
    setAccountId(event.accountId ?? accounts[0]?.id ?? "");
  };

  const handleConfirm = async () => {
    if (!selectedEvent) {
      return;
    }

    await apiFetch("/api/dashboard/confirm", {
      method: "POST",
      body: JSON.stringify({
        forecastEventId: selectedEvent.id,
        amount: confirmAmount,
        accountId: accountId || undefined,
      }),
    });

    setSelectedEvent(null);
    startTransition(() => setReloadKey((value) => value + 1));
  };

  return (
    <div className="grid gap-6">
      {negativeForecasts.length > 0 ? (
        <Card className="border-pink-400/30 bg-pink-900/70">
          <div className="text-sm font-medium text-pink-100">
            ⚠ 以下の口座で残高不足が予測されています:{" "}
            {negativeForecasts
              .map((forecast) => `${forecast.accountName}（${formatDateWithYear(forecast.firstNegativeDate)}）`)
              .join("、")}
          </div>
        </Card>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="総所持金" value={formatCurrency(dashboardData?.dashboard.totalBalance ?? 0)} />
        <SummaryCard title="全体の最小残高" value={formatCurrency(dashboardData?.dashboard.minBalance ?? 0)} />
        <SummaryCard
          title="次の収入"
          value={
            dashboardData?.dashboard.nextIncome
              ? `${formatDateWithYear(dashboardData.dashboard.nextIncome.date)} ${formatCurrency(dashboardData.dashboard.nextIncome.amount)}`
              : "なし"
          }
          detail={dashboardData?.dashboard.nextIncome?.description}
        />
        <SummaryCard
          title="次の支出"
          value={
            dashboardData?.dashboard.nextExpense
              ? `${formatDateWithYear(dashboardData.dashboard.nextExpense.date)} ${formatCurrency(dashboardData.dashboard.nextExpense.amount)}`
              : "なし"
          }
          detail={dashboardData?.dashboard.nextExpense?.description}
        />
      </section>

      <div className="flex flex-wrap gap-2">
        <Button variant={selectedTab === "total" ? "primary" : "ghost"} onClick={() => setSelectedTab("total")}>
          全体
        </Button>
        {accountForecasts.map((forecast) => (
          <Button key={forecast.accountId} variant={selectedTab === forecast.accountId ? "primary" : "ghost"} onClick={() => setSelectedTab(forecast.accountId)}>
            {forecast.accountName}
          </Button>
        ))}
      </div>

      <Card className="flex h-[450px] flex-col overflow-hidden px-5 pt-5 pb-2">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">
              {selectedAccountForecast ? `${selectedAccountForecast.accountName} の残高推移` : "所持金推移"}
            </h2>
            <p className="text-sm text-white/60">
              {selectedAccountForecast ? "選択した口座に影響するイベントのみ表示します。" : "全口座合計の残高チェーンです。"}
            </p>
          </div>
          {selectedAccountForecast ? (
            <Badge className="max-w-full truncate" tone={selectedAccountForecast.willBeNegative ? "danger" : "success"}>
              最小残高 {formatCurrency(selectedAccountForecast.minBalance)}
            </Badge>
          ) : (
            <Button variant="ghost" onClick={() => setReloadKey((value) => value + 1)}>
              再読込
            </Button>
          )}
        </div>
        {dashboardLoading ? (
          <StateMessage message="読み込み中..." />
        ) : dashboardError ? (
          <StateMessage message={dashboardError} tone="danger" />
        ) : chartData.length === 0 ? (
          <StateMessage message="表示できる予測イベントがありません。" />
        ) : (
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ left: 12, right: 12, top: 12, bottom: 8 }}>
                {showZeroLine ? <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" /> : null}
                <XAxis
                  dataKey="date"
                  stroke="rgba(255,255,255,0.28)"
                  height={28}
                  tick={{ fontSize: 10, fill: "rgba(255,255,255,0.58)" }}
                  tickLine={false}
                  tickMargin={6}
                  minTickGap={24}
                  interval="preserveStartEnd"
                  tickFormatter={formatChartDateWithYear}
                  padding={{ left: 20, right: 20 }}
                />
                <YAxis
                  stroke="rgba(255,255,255,0.4)"
                  tickFormatter={formatCurrency}
                  width={110}
                  domain={chartDomain}
                  tickCount={6}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgba(18, 22, 30, 0.96)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 16,
                  }}
                  formatter={(value) => formatCurrency(value as number)}
                  labelFormatter={(_, payload) =>
                    payload?.[0]?.payload
                      ? `${payload[0].payload.description} / ${formatDateWithYear(payload[0].payload.date)}`
                      : ""
                  }
                />
                <Line type="monotone" dataKey="balance" stroke="hsl(var(--primary))" strokeWidth={3} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-xl font-semibold">
            {selectedAccountForecast ? `${selectedAccountForecast.accountName} の予測イベント` : "予測イベント"}
          </h2>
          <Select
            aria-label="予測イベントの表示期間"
            className="w-auto min-w-28"
            value={periodPreset}
            onChange={(event) => setPeriodPreset(event.target.value as DashboardPeriodPreset)}
          >
            {dashboardPeriodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <p className="mb-4 text-sm text-white/60">当日以降の未確定イベントだけを表示します。</p>
        {eventsLoading ? (
          <StateMessage message="読み込み中..." />
        ) : eventsError ? (
          <StateMessage message={eventsError} tone="danger" />
        ) : tableForecast.length === 0 ? (
          <StateMessage message="表示できる予測イベントがありません。" />
        ) : (
          <TableWrapper>
            <Table>
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.18em] text-white/45">
                  <th className="px-3 py-3">日付</th>
                  <th className="px-3 py-3">種別</th>
                  <th className="px-3 py-3">内容</th>
                  <th className="px-3 py-3">金額</th>
                  <th className="px-3 py-3">残高</th>
                  <th className="px-3 py-3">対象口座</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {tableForecast.map((event) => (
                  <tr key={event.id} className="border-b border-white/5">
                    <td className="px-3 py-3 text-white/70">{formatDateWithYear(event.date)}</td>
                    <td className="px-3 py-3">
                      <span className={event.type === "income" ? "text-sky-300" : "text-pink-300"}>
                        {event.type === "income" ? "収入" : "支出"}
                      </span>
                    </td>
                    <td className="px-3 py-3">{event.description}</td>
                    <td className="px-3 py-3">{formatCurrency(event.amount)}</td>
                    <td className="px-3 py-3">{formatCurrency(event.balance)}</td>
                    <td className="px-3 py-3">
                      {accounts.find((account) => account.id === event.accountId)?.name ?? "-"}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Button variant="ghost" onClick={() => openConfirm(event)}>
                        確定
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrapper>
        )}
      </Card>

      <Dialog open={Boolean(selectedEvent)} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">予測イベントを確定</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-white/60">
            アイテムに設定された口座を初期値として表示します。必要なら変更できます。
          </DialogDescription>
          <div className="mt-6 grid gap-4">
            <div className="rounded-2xl bg-black/20 p-4 text-sm">
              {selectedEvent && (
                <>
                  <div>{selectedEvent.description}</div>
                  <div className="mt-1 text-white/60">
                    {formatDateWithYear(selectedEvent.date)} / {formatCurrency(selectedEvent.amount)}
                  </div>
                </>
              )}
            </div>
            <label className="grid gap-2 text-sm">
              <span>実際の金額</span>
              <Input type="number" value={confirmAmount} onChange={(event) => setConfirmAmount(Number(event.target.value))} />
            </label>
            <label className="grid gap-2 text-sm">
              <span>対象口座</span>
              <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                <option value="">イベント設定口座を使用</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
            </label>
            <div className="flex justify-end gap-3">
              <DialogClose asChild>
                <Button variant="ghost">閉じる</Button>
              </DialogClose>
              <Button onClick={handleConfirm}>確定する</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  detail,
}: {
  title: string;
  value: string;
  detail?: string;
}) {
  return (
    <Card>
      <div className="text-sm uppercase tracking-[0.18em] text-white/45">{title}</div>
      <div className="mt-3 text-3xl font-semibold">{value}</div>
      {detail ? <div className="mt-2 text-sm text-white/60">{detail}</div> : null}
    </Card>
  );
}

function StateMessage({ message, tone = "default" }: { message: string; tone?: "default" | "danger" }) {
  return <div className={tone === "danger" ? "text-pink-300" : "text-white/60"}>{message}</div>;
}
