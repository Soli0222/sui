import type {
  DashboardExplainResponse,
  DashboardPeriodPreset,
  DashboardResponse,
  ForecastEvent,
  UiSettingsResponse,
} from "@sui/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Repeat, TrendingUp, Wallet } from "lucide-react";
import { AccountLevelList, type AccountLevelRow } from "../components/account-level-list";
import { BalanceChart } from "../components/balance-chart";
import { LevelHeader, type LevelHeaderStatus } from "../components/level-header";
import { OffsetToggle } from "../components/offset-toggle";
import { PeriodSelector } from "../components/period-selector";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { CardList } from "../components/ui/card-list";
import { useEditingNavigation } from "../components/editing/editing-navigation";
import { MoneyCell } from "../components/ui/responsive-table";
import { Switch } from "../components/ui/switch";
import { Table, TableWrapper } from "../components/ui/table";
import { useDashboardResources } from "../hooks/use-dashboard-resources";
import { useDashboardConfirmation } from "../hooks/use-dashboard-confirmation";
import { useDashboardChart } from "../hooks/use-dashboard-chart";
import { DashboardExplainDialog, type ExplainDialogState } from "../components/dashboard/explain-dialog";
import { DashboardConfirmDialog } from "../components/dashboard/confirm-dialog";
import { OverdueQueue } from "../components/dashboard/overdue-queue";
import { StateMessage, formatForecastAccounts, getForecastTypeClassName, getForecastTypeLabel } from "../components/dashboard/dashboard-display";
import { apiFetch } from "../lib/api";
import {
  formatCurrency,
  formatCurrencyWithJpy,
  formatDateWithYear,
  formatTypedAmountParts,
} from "../lib/format";
import {
  DAY_MS,
  dateOnlyToTimestamp,
  getDashboardChartEndDate,
  getDashboardChartStartDate,
} from "../lib/balance-chart";
import { cn, getTodayDate } from "../lib/utils";

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

function buildDashboardExplainPath(params: {
  date: string;
  accountId?: string;
  applyOffset: boolean;
}) {
  const searchParams = new URLSearchParams({
    date: params.date,
    applyOffset: String(params.applyOffset),
  });

  if (params.accountId) {
    searchParams.set("accountId", params.accountId);
  }

  return `/api/dashboard/explain?${searchParams.toString()}`;
}

function formatSummaryEvent(event: DashboardResponse["nextIncome"] | DashboardResponse["nextExpense"]) {
  if (!event) {
    return "なし";
  }

  return `${formatDateWithYear(event.date)} ${event.description} ${formatCurrencyWithJpy(
    event.amount,
    event.currencyCode,
    event.amountJpy,
  )}`;
}

function formatMonthDay(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "long",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

function getMinimumForecastDate(events: ForecastEvent[], currentBalance: number, fallbackDate: string) {
  const minEvent = events.reduce<ForecastEvent | null>((current, event) => {
    if (!current || event.balanceJpy < current.balanceJpy) {
      return event;
    }

    return current;
  }, null);

  return minEvent && minEvent.balanceJpy <= currentBalance ? minEvent.date : fallbackDate;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "確定に失敗しました。";
}

function pickEarliestWarning<T extends { firstNegativeDate: string }>(list: T[]): T | null {
  return list.reduce<T | null>(
    (earliest, item) => (!earliest || item.firstNegativeDate < earliest.firstNegativeDate ? item : earliest),
    null,
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const navigation = useEditingNavigation();
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedAccountId, setSelectedAccountId] = useState<string | "total">("total");
  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>(DEFAULT_DASHBOARD_PERIOD);
  const periodChangedByUser = useRef(false);
  const [applyOffset, setApplyOffset] = useState(true);
  const [showTrend, setShowTrend] = useState(false);
  const [explainDialog, setExplainDialog] = useState<ExplainDialogState | null>(null);
  const explainRequestId = useRef(0);
  const months = presetToMonths[periodPreset];
  const today = getTodayDate();
  const chartDisplayStartDate = getDashboardChartStartDate(today);
  const chartDisplayEndDate = getDashboardChartEndDate(today, months);

  useEffect(() => {
    let cancelled = false;

    void apiFetch<UiSettingsResponse>("/api/settings")
      .then((settings) => {
        if (!cancelled && !periodChangedByUser.current) {
          setPeriodPreset(settings.dashboardDefaultPeriod);
        }
      })
      .catch(() => {
        // 設定を取得できない場合はビルトイン既定値を維持する。
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const { dashboardData, dashboardLoading, dashboardError, eventsData, eventsLoading, eventsError,
    balanceHistoryData, balanceHistoryLoading, balanceHistoryError, refreshForecast, refreshError, setRefreshError } =
    useDashboardResources({ reloadKey, months, applyOffset, selectedAccountId, chartDisplayStartDate, today });

  const accounts = dashboardData?.accounts ?? [];
  const accountForecasts = dashboardData?.dashboard.accountForecasts ?? [];
  const selectedAccountForecast =
    selectedAccountId === "total"
      ? null
      : accountForecasts.find((forecast) => forecast.accountId === selectedAccountId) ?? null;
  const selectedAccountEvents =
    selectedAccountId === "total"
      ? null
      : eventsData?.accountForecasts.find((forecast) => forecast.accountId === selectedAccountId) ?? null;
  const chartForecast = useMemo(
    () =>
      selectedAccountId === "total"
        ? eventsData?.forecast ?? dashboardData?.dashboard.forecast ?? []
        : selectedAccountEvents?.events ?? selectedAccountForecast?.events ?? [],
    [selectedAccountId, eventsData, dashboardData, selectedAccountEvents, selectedAccountForecast],
  );
  const { renderedChart, isChartLoading, hasChartError } = useDashboardChart({
    dashboard: dashboardData?.dashboard ?? null, selectedAccountForecast, chartForecast, balanceHistoryData,
    dashboardLoading, balanceHistoryLoading, eventsLoading, dashboardError, balanceHistoryError, eventsError,
    today, chartDisplayStartDate, chartDisplayEndDate, applyOffset, showTrend,
  });
  const tableForecast = selectedAccountEvents?.events ?? eventsData?.forecast ?? [];
  const overdueForecast = dashboardData?.dashboard.overdueForecast ?? [];
  const { selectedEvent, isQueueCollapsed, setIsQueueCollapsed, overdueDrafts, setOverdueDrafts,
    visibleOverdueForecast, optimisticConfirmedIds, isBatchConfirming, isConfirming, staleOverdueIds,
    selectedOverdueCount, confirmRaw, confirmAmount, accountId, updateConfirmDraft, updateOverdueDraft,
    openConfirm, closeConfirm, handleConfirm, handleBatchConfirm } =
    useDashboardConfirmation({ accounts, overdueForecast, refreshForecast, setRefreshError });
  const yellowForecasts = accountForecasts
    .filter((forecast) => forecast.warningLevel === "yellow")
    .map((forecast) => ({
      accountName: forecast.accountName,
      firstNegativeDate: forecast.events.find((event) => event.balance < 0)?.date ?? forecast.minBalanceDate,
    }));
  const redForecasts = accountForecasts
    .filter((forecast) => forecast.warningLevel === "red")
    .map((forecast) => ({
      accountName: forecast.accountName,
      firstNegativeDate: forecast.firstRealNegativeDate ?? forecast.minBalanceDate,
    }));
  const worstRed = pickEarliestWarning(redForecasts);
  const worstYellow = pickEarliestWarning(yellowForecasts);
  const levelStatus: LevelHeaderStatus = worstRed ? "critical" : worstYellow ? "warning" : "safe";
  const criticalDays = worstRed
    ? Math.max(0, Math.round((dateOnlyToTimestamp(worstRed.firstNegativeDate) - dateOnlyToTimestamp(today)) / DAY_MS))
    : undefined;
  const heroText = worstRed
    ? `${formatMonthDay(worstRed.firstNegativeDate)} に ${worstRed.accountName} が赤字になります`
    : worstYellow
      ? `${formatMonthDay(worstYellow.firstNegativeDate)} に ${worstYellow.accountName} の可処分残高がマイナスになります`
      : `${formatMonthDay(chartDisplayEndDate)}まで水位は保たれます`;
  const totalMinBalanceDate = dashboardData
    ? getMinimumForecastDate(
        dashboardData.dashboard.forecast,
        dashboardData.dashboard.totalBalance,
        today,
      )
    : today;

  const accountLevelRows: AccountLevelRow[] = [
    {
      id: "total" as const,
      name: "全体",
      currentBalance: dashboardData?.dashboard.totalBalance ?? 0,
      currentBalanceJpy: dashboardData?.dashboard.totalBalance ?? 0,
      currencyCode: "JPY" as const,
      minBalance: dashboardData?.dashboard.minBalance ?? 0,
      minBalanceJpy: dashboardData?.dashboard.minBalance ?? 0,
      minBalanceDate: totalMinBalanceDate,
      warningLevel: worstRed ? "red" : worstYellow ? "yellow" : "none",
    },
    ...accountForecasts.map((forecast) => ({
      id: forecast.accountId,
      name: forecast.accountName,
      currentBalance: forecast.currentBalance,
      currentBalanceJpy: forecast.currentBalanceJpy,
      currencyCode: forecast.currencyCode,
      minBalance: forecast.minBalance,
      minBalanceJpy: forecast.minBalanceJpy,
      minBalanceDate: forecast.minBalanceDate,
      warningLevel: forecast.warningLevel,
    })),
  ];

  const openExplain = async ({
    title,
    date,
    accountId,
  }: {
    title: string;
    date: string;
    accountId?: string;
  }) => {
    const requestId = ++explainRequestId.current;
    setExplainDialog({
      title,
      date,
      accountId,
      data: null,
      loading: true,
      error: null,
    });

    try {
      const data = await apiFetch<DashboardExplainResponse>(
        buildDashboardExplainPath({ date, accountId, applyOffset }),
      );
      setExplainDialog((current) =>
        requestId === explainRequestId.current && current?.date === date && current.accountId === accountId
          ? {
              ...current,
              data,
              loading: false,
              error: null,
            }
          : current
      );
    } catch (error) {
      setExplainDialog((current) =>
        requestId === explainRequestId.current && current?.date === date && current.accountId === accountId
          ? {
              ...current,
              data: null,
              loading: false,
              error: getErrorMessage(error),
            }
          : current
      );
    }
  };

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
      {refreshError ? <div role="alert" className="flex items-center gap-2 text-sm text-critical">{refreshError}
        <Button variant="secondary" onClick={() => void refreshForecast().catch((error) => setRefreshError(getErrorMessage(error)))}>表示を再取得</Button>
      </div> : null}
      {!dashboardLoading && accounts.length === 0 ? (
        <OnboardingCard onNavigate={navigate} />
      ) : null}

      <Card className="reveal-stage-1 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
        <LevelHeader
          status={levelStatus}
          heroText={heroText}
          criticalDays={criticalDays}
          totalBalance={dashboardData?.dashboard.totalBalance ?? 0}
          minBalanceLabel={formatCurrency(dashboardData?.dashboard.minBalance ?? 0)}
          onMinBalanceClick={
            dashboardData
              ? () =>
                  openExplain({
                    title: "全体の最小残高の寄与分解",
                    date: totalMinBalanceDate,
                  })
              : undefined
          }
          nextIncomeLabel={formatSummaryEvent(dashboardData?.dashboard.nextIncome ?? null)}
          nextExpenseLabel={formatSummaryEvent(dashboardData?.dashboard.nextExpense ?? null)}
        />

        <div className="min-w-0 border-t border-line pt-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words text-lg font-semibold">
                {selectedAccountForecast ? `${selectedAccountForecast.accountName} の残高推移` : "残高推移"}
              </h2>
              <p className="text-sm text-ink-2">
                {selectedAccountForecast ? "選択した口座に影響するイベントのみ表示します。" : "全口座合計の残高チェーンです。"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <OffsetToggle checked={applyOffset} onChange={(value) => navigation.request(() => setApplyOffset(value))} />
              <div
                className="flex max-w-full min-w-0 items-center gap-3 rounded-[var(--radius-s)] border border-line bg-surface-2 px-4 py-2 text-sm"
                title="実績残高の後方移動平均線を重ねて表示します"
              >
                <span className="min-w-0 truncate">移動平均</span>
                <Switch
                  checked={showTrend}
                  onChange={setShowTrend}
                  aria-label="実績残高の後方移動平均線を表示"
                />
              </div>
              <Button variant="ghost" onClick={() => setReloadKey((value) => value + 1)}>
                再読込
              </Button>
            </div>
          </div>
          <div className="h-[320px] min-w-0 sm:h-[420px]">
            {!renderedChart && isChartLoading ? (
              <ChartSkeleton />
            ) : !renderedChart && hasChartError ? (
              <StateMessage
                message={dashboardError ?? balanceHistoryError ?? eventsError ?? "読み込みに失敗しました。"}
                tone="danger"
              />
            ) : renderedChart ? (
              <div className={cn("h-full min-h-0 min-w-0 transition-opacity duration-200", isChartLoading && "opacity-40")}>
                <BalanceChart {...renderedChart} />
              </div>
            ) : null}
          </div>
        </div>
      </Card>

      <Card className="reveal-stage-2">
        <h2 className="mb-4 text-lg font-semibold">口座別の水位</h2>
        <AccountLevelList rows={accountLevelRows} selectedId={selectedAccountId} onSelect={(value) => navigation.request(() => setSelectedAccountId(value))} />
      </Card>

      <OverdueQueue accounts={accounts} visibleOverdueForecast={visibleOverdueForecast}
        staleOverdueIds={staleOverdueIds} overdueDrafts={overdueDrafts} setOverdueDrafts={setOverdueDrafts}
        optimisticConfirmedIds={optimisticConfirmedIds} isBatchConfirming={isBatchConfirming}
        isQueueCollapsed={isQueueCollapsed} setIsQueueCollapsed={setIsQueueCollapsed}
        selectedOverdueCount={selectedOverdueCount} updateOverdueDraft={updateOverdueDraft}
        openConfirm={openConfirm} handleBatchConfirm={handleBatchConfirm} />

      <Card className="reveal-stage-3">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <h2 className="min-w-0 break-words text-xl font-semibold">
            {selectedAccountForecast ? `${selectedAccountForecast.accountName} の予測イベント` : "予測イベント"}
          </h2>
          <PeriodSelector
            ariaLabel="予測イベントの表示期間"
            className="w-full min-w-28 sm:w-auto"
            presets={dashboardPeriodOptions}
            selected={periodPreset}
            onChange={(value) => {
              navigation.request(() => {
                periodChangedByUser.current = true;
                setPeriodPreset(value);
              });
            }}
          />
        </div>
        <p className="mb-4 max-w-4xl text-sm text-ink-2">
          当日以降の未確定イベントだけを表示します。予測は予定収支、クレジットカード請求、ローン返済から生成し、
          サブスク台帳はカード請求額との二重計上を避けるためここには直接表示しません。
        </p>
        {eventsLoading ? (
          <StateMessage message="読み込み中..." />
        ) : eventsError ? (
          <StateMessage message={eventsError} tone="danger" />
        ) : tableForecast.length === 0 ? (
          <StateMessage message="表示できる予測イベントがありません。" />
        ) : (
          <><div className="hidden 2xl:block"><TableWrapper>
            <Table className="w-full">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium text-ink-3">
                  <th scope="col" className="w-px whitespace-nowrap px-3 py-3">日付</th>
                  <th scope="col" className="w-px whitespace-nowrap px-3 py-3">種別</th>
                  <th scope="col" className="px-3 py-3">内容</th>
                  <th scope="col" className="px-3 py-3 text-right">金額</th>
                  <th scope="col" className="px-3 py-3 text-right">残高</th>
                  <th scope="col" className="px-3 py-3">対象口座</th>
                  <th scope="col" className="w-px whitespace-nowrap px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {tableForecast.map((event) => {
                  const isConfirmed = optimisticConfirmedIds.includes(event.id);

                  return (
                    <tr
                      key={event.id}
                      className={cn(
                        "border-b border-line transition-opacity duration-200 ease-out motion-reduce:transition-none",
                        !isConfirmed && "cursor-pointer hover:bg-surface-2",
                        isConfirmed && "opacity-50",
                      )}
                      onClick={() => openConfirm(event)}
                    >
                      <td className="font-data whitespace-nowrap px-3 py-3 text-ink-2">{formatDateWithYear(event.date)}</td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <span className={getForecastTypeClassName(event.type)}>
                          {getForecastTypeLabel(event.type)}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="break-words">{event.description}</span>
                          {event.isAssumption ? <Badge tone="warning">仮定</Badge> : null}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {(() => {
                          const parts = formatTypedAmountParts(event.type, event.amount, event.currencyCode, event.amountJpy);
                          return <MoneyCell primary={parts.primary} secondary={parts.secondary} />;
                        })()}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {selectedAccountForecast ? (
                          <MoneyCell
                            primary={formatCurrency(event.balance, event.currencyCode)}
                            secondary={event.currencyCode === "JPY" ? null : formatCurrency(event.balanceJpy, "JPY")}
                          />
                        ) : (
                          <MoneyCell primary={formatCurrency(event.balanceJpy)} />
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {formatForecastAccounts(event, accounts)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                        {isConfirmed ? (
                          <span className="text-xs text-ink-3">確定済み</span>
                        ) : <div className="flex justify-end gap-1">
                          <Button variant="ghost" onClick={() => openConfirm(event)}>確定</Button>
                        </div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrapper></div>
          <div className="2xl:hidden"><CardList rows={tableForecast} rowKey={(event) => event.id}
            renderItem={(event) => {
              const isConfirmed = optimisticConfirmedIds.includes(event.id);
              const amount = formatTypedAmountParts(event.type, event.amount, event.currencyCode, event.amountJpy);
              return <>
                <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0"><div className="break-words font-medium">{event.description}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3"><span>{formatDateWithYear(event.date)}</span><span className={getForecastTypeClassName(event.type)}>{getForecastTypeLabel(event.type)}</span>{event.isAssumption && <Badge tone="warning">仮定</Badge>}</div></div>
                  <div className="font-data whitespace-nowrap sm:text-right">{amount.primary}{amount.secondary && <div className="text-xs text-ink-3">JPY換算 {amount.secondary}</div>}</div>
                </div>
                <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2"><span className="whitespace-nowrap">イベント後残高 {selectedAccountForecast ? formatCurrency(event.balance, event.currencyCode) : formatCurrency(event.balanceJpy)}{selectedAccountForecast && event.currencyCode !== "JPY" && <span className="ml-2 text-ink-3">JPY換算 {formatCurrency(event.balanceJpy, "JPY")}</span>}</span><span className="break-words">対象口座 {formatForecastAccounts(event, accounts)}</span></div>
                <div className="flex justify-end">{isConfirmed ? <span className="text-xs text-ink-3">確定済み</span> : <Button variant="ghost" onClick={() => openConfirm(event)}>確認</Button>}</div>
              </>;
            }} /></div></>
        )}
      </Card>

      <DashboardExplainDialog explainDialog={explainDialog} onClose={() => { explainRequestId.current += 1; setExplainDialog(null); }} />
      <DashboardConfirmDialog selectedEvent={selectedEvent} accounts={accounts} confirmAmount={confirmAmount}
        confirmRaw={confirmRaw} accountId={accountId} isConfirming={isConfirming}
        updateConfirmDraft={updateConfirmDraft} handleConfirm={handleConfirm} closeConfirm={closeConfirm} />
    </div>
  );
}

const onboardingSteps = [
  {
    icon: Wallet,
    title: "口座を登録",
    description: "現在の残高を持つ口座を追加します。予測の起点になります。",
    actionLabel: "口座を追加",
    to: "/accounts",
  },
  {
    icon: Repeat,
    title: "予定収支を登録",
    description: "給与や家賃など、毎月決まって動くお金と、一度だけ発生する単発予定を登録します。",
    actionLabel: "予定収支を追加",
    to: "/recurring",
  },
  {
    icon: TrendingUp,
    title: "予測が生まれる",
    description: "登録した口座と予定収支から、残高の予測がここに自動で表示されます。",
  },
] as const;

/**
 * オンボーディング空状態（B-1 empty）。口座ゼロの初回起動時は「¥0 カード＋空メッセージ」
 * ではなく、次に何をすべきかの 3 ステップを導線として示す。
 */
function OnboardingCard({ onNavigate }: { onNavigate: (to: string) => void }) {
  return (
    <Card className="reveal-stage-1 grid gap-4">
      <div>
        <h2 className="text-lg font-semibold">はじめに</h2>
        <p className="mt-1 text-sm text-ink-2">
          口座と予定収支を登録すると、残高の予測がこのダッシュボードに表示されます。
        </p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {onboardingSteps.map((step, index) => (
          <li key={step.title} className="grid gap-2 rounded-[var(--radius-m)] border border-line bg-surface-2 p-4">
            <div className="flex items-center gap-2 text-ink-3">
              <span className="font-data flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-strong text-xs">
                {index + 1}
              </span>
              <step.icon aria-hidden="true" className="h-4 w-4" />
            </div>
            <div className="text-sm font-semibold">{step.title}</div>
            <p className="text-xs text-ink-2">{step.description}</p>
            {"to" in step ? (
              <Button
                variant="secondary"
                className="mt-1 justify-self-start"
                onClick={() => onNavigate(step.to)}
              >
                {step.actionLabel}
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function ChartSkeleton() {
  return (
    <div className="grid h-full min-h-0 grid-rows-[1fr_auto] gap-2">
      <div className="animate-pulse rounded-[var(--radius-m)] bg-surface-2" />
      <div className="flex gap-4">
        <div className="h-3 w-12 animate-pulse rounded-full bg-surface-2" />
        <div className="h-3 w-12 animate-pulse rounded-full bg-surface-2" />
        <div className="h-3 w-12 animate-pulse rounded-full bg-surface-2" />
      </div>
    </div>
  );
}
