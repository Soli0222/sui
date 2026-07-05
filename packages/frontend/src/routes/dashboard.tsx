import type {
  Account,
  BalanceHistoryResponse,
  DashboardEventsResponse,
  DashboardExplainResponse,
  DashboardResponse,
  ForecastEvent,
  SupportedCurrencyCode,
} from "@sui/shared";
import { useEffect, useMemo, useState, startTransition } from "react";
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { MoneyCell } from "../components/ui/responsive-table";
import { Select } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { Table, TableWrapper } from "../components/ui/table";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import {
  formatCurrency,
  formatCurrencyInputValue,
  formatCurrencyWithJpy,
  formatDateWithYear,
  formatTypedAmount,
  formatTypedAmountParts,
  parseCurrencyInputValue,
} from "../lib/format";
import {
  DAY_MS,
  dateOnlyToTimestamp,
  getDashboardChartEndDate,
  getDashboardChartStartDate,
} from "../lib/balance-chart";
import { cn, getTodayDate } from "../lib/utils";

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

function buildDashboardPath(applyOffset: boolean) {
  return `/api/dashboard?applyOffset=${String(applyOffset)}`;
}

function buildDashboardEventsPath(months: number, applyOffset: boolean) {
  return `/api/dashboard/events?months=${months}&applyOffset=${String(applyOffset)}`;
}

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

function buildDashboardBalanceHistoryPath(params: {
  selectedAccountId: string | "total";
  startDate: string;
  endDate: string;
  applyOffset: boolean;
}) {
  const searchParams = new URLSearchParams({
    startDate: params.startDate,
    endDate: params.endDate,
    applyOffset: String(params.applyOffset),
  });

  if (params.selectedAccountId !== "total") {
    searchParams.set("accountId", params.selectedAccountId);
  }

  return `/api/transactions/balance-history?${searchParams.toString()}`;
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

type OverdueConfirmDraft = {
  selected: boolean;
  amount: number;
  accountId: string;
  error?: string;
};

type ExplainDialogState = {
  title: string;
  date: string;
  accountId?: string;
  data: DashboardExplainResponse | null;
  loading: boolean;
  error: string | null;
};

type ChartSnapshot = {
  data: Array<{ date: string; description?: string; balance: number }>;
  forecastData: Array<{ date: string; description?: string; balance: number }>;
  todayPoint: { date: string; description: string; balance: number };
  todayDate: string;
  displayStartDate: string;
  displayEndDate: string;
  currentBalance: number;
  label: string;
  currencyCode: SupportedCurrencyCode;
  exchangeRateToJpy: number;
  disposableZero: boolean;
};

function getDefaultConfirmAccountId(event: ForecastEvent, accounts: Account[]) {
  const fallbackAccount = accounts.find((account) => account.currencyCode === event.currencyCode);
  return event.accountId ?? fallbackAccount?.id ?? "";
}

function isTransferEvent(event: ForecastEvent | null | undefined) {
  return event?.type === "transfer";
}

function getForecastTypeLabel(type: ForecastEvent["type"]) {
  if (type === "income") {
    return "収入";
  }

  if (type === "expense") {
    return "支出";
  }

  return "振替";
}

function getForecastTypeClassName(type: ForecastEvent["type"]) {
  // 種別色は残高の重大度色（positive/warning/critical）と衝突させない。
  // 色は状態（安全/警告/危険）にのみ使い、種別はグレースケールの階調で区別する。
  if (type === "income") {
    return "text-ink";
  }

  if (type === "expense") {
    return "text-ink-2";
  }

  return "text-ink-3";
}

function getForecastSourceLabel(source: ForecastEvent["source"]) {
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

function formatSignedCurrency(value: number) {
  if (value > 0) {
    return `+${formatCurrency(value)}`;
  }

  if (value < 0) {
    return `-${formatCurrency(Math.abs(value))}`;
  }

  return formatCurrency(0);
}

function getExplainSourceTotals(sourceTotals: DashboardExplainResponse["sourceTotals"]) {
  return [
    { label: "固定収入", value: sourceTotals.recurringIncomeJpy },
    { label: "固定支出", value: sourceTotals.recurringExpenseJpy },
    { label: "クレジットカード", value: sourceTotals.creditCardJpy },
    { label: "ローン", value: sourceTotals.loanJpy },
    { label: "振替", value: sourceTotals.transferJpy },
  ];
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

function getAccountName(accounts: Account[], accountId: string | null | undefined) {
  return accountId ? accounts.find((account) => account.id === accountId)?.name ?? "未設定" : "-";
}

function formatForecastAccounts(event: ForecastEvent, accounts: Account[]) {
  if (event.type === "transfer") {
    return `${getAccountName(accounts, event.accountId)} → ${getAccountName(accounts, event.transferToAccountId)}`;
  }

  return getAccountName(accounts, event.accountId);
}

function createOverdueConfirmDraft(event: ForecastEvent, accounts: Account[]): OverdueConfirmDraft {
  return {
    selected: true,
    amount: event.amount,
    accountId: getDefaultConfirmAccountId(event, accounts),
  };
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
  const { toast } = useToast();
  const navigate = useNavigate();
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedAccountId, setSelectedAccountId] = useState<string | "total">("total");
  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>(DEFAULT_DASHBOARD_PERIOD);
  const [applyOffset, setApplyOffset] = useState(true);
  const [manualSelectedEvent, setManualSelectedEvent] = useState<ForecastEvent | null>(null);
  const [explainDialog, setExplainDialog] = useState<ExplainDialogState | null>(null);
  const [isQueueCollapsed, setIsQueueCollapsed] = useState(false);
  const [overdueDrafts, setOverdueDrafts] = useState<Record<string, OverdueConfirmDraft>>({});
  const [hiddenOverdueIds, setHiddenOverdueIds] = useState<string[]>([]);
  const [optimisticConfirmedIds, setOptimisticConfirmedIds] = useState<string[]>([]);
  const [isBatchConfirming, setIsBatchConfirming] = useState(false);
  const [renderedChart, setRenderedChart] = useState<ChartSnapshot | null>(null);
  const [confirmDraft, setConfirmDraft] = useState<{
    eventId: string;
    amount: number;
    accountId: string;
  } | null>(null);
  const months = presetToMonths[periodPreset];
  const today = getTodayDate();
  const chartDisplayStartDate = getDashboardChartStartDate(today);
  const chartDisplayEndDate = getDashboardChartEndDate(today, months);

  const {
    data: dashboardData,
    loading: dashboardLoading,
    error: dashboardError,
  } = useResource(
    () =>
      Promise.all([
        apiFetch<DashboardResponse>(buildDashboardPath(applyOffset)),
        apiFetch<Account[]>("/api/accounts"),
      ]).then(([dashboard, accounts]) => ({ dashboard, accounts })),
    [reloadKey, applyOffset],
  );
  const {
    data: eventsData,
    loading: eventsLoading,
    error: eventsError,
  } = useResource(
    () => apiFetch<DashboardEventsResponse>(buildDashboardEventsPath(months, applyOffset)),
    [reloadKey, months, applyOffset],
  );
  const {
    data: balanceHistoryData,
    loading: balanceHistoryLoading,
    error: balanceHistoryError,
  } = useResource(
    () =>
      apiFetch<BalanceHistoryResponse>(
        buildDashboardBalanceHistoryPath({
          selectedAccountId,
          startDate: chartDisplayStartDate,
          endDate: today,
          applyOffset,
        }),
      ),
    [reloadKey, selectedAccountId, chartDisplayStartDate, today, applyOffset],
  );

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
  const tableForecast = selectedAccountEvents?.events ?? eventsData?.forecast ?? [];
  const overdueForecast = dashboardData?.dashboard.overdueForecast ?? [];
  const visibleOverdueForecast = overdueForecast.filter((event) => !hiddenOverdueIds.includes(event.id));
  const currentBalance =
    selectedAccountForecast?.currentBalance ?? dashboardData?.dashboard.totalBalance ?? 0;
  const displayCurrencyCode: SupportedCurrencyCode = selectedAccountForecast?.currencyCode ?? "JPY";
  const chartExchangeRateToJpy = selectedAccountForecast?.exchangeRateToJpy ?? 1;
  const chartLabel = selectedAccountForecast?.accountName ?? "全体";
  const todayChartPoint = {
    date: today,
    description: selectedAccountForecast ? `${selectedAccountForecast.accountName} 現在残高` : "全体 現在残高",
    balance: currentBalance,
  };
  const chartData = useMemo(
    () =>
      (balanceHistoryData?.points ?? []).map((point) => ({
        date: point.date,
        description: point.description,
        balance: point.balance,
      })),
    [balanceHistoryData],
  );
  const chartForecastData = useMemo(
    () =>
      chartForecast.map((point) => ({
        date: point.date,
        description: point.description,
        balance: point.balance,
      })),
    [chartForecast],
  );
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
      firstNegativeDate: forecast.events.find((event) => event.balance < 0)?.date ?? forecast.minBalanceDate,
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
  const selectedEvent = manualSelectedEvent;
  const defaultAccountId = selectedEvent ? getDefaultConfirmAccountId(selectedEvent, accounts) : "";
  const activeDraft = confirmDraft?.eventId === selectedEvent?.id ? confirmDraft : null;
  const confirmAmount = activeDraft?.amount ?? selectedEvent?.amount ?? 0;
  const accountId = activeDraft?.accountId ?? defaultAccountId;
  const selectedOverdueEvents = visibleOverdueForecast.filter(
    (event) => overdueDrafts[event.id]?.selected ?? true,
  );
  const selectedOverdueCount = selectedOverdueEvents.length;
  const totalMinBalanceDate = dashboardData
    ? getMinimumForecastDate(
        dashboardData.dashboard.forecast,
        dashboardData.dashboard.totalBalance,
        today,
      )
    : today;

  const isChartLoading = dashboardLoading || balanceHistoryLoading || eventsLoading;
  const hasChartError = Boolean(dashboardError || balanceHistoryError || eventsError);

  useEffect(() => {
    if (isChartLoading || hasChartError) {
      return;
    }

    setRenderedChart({
      data: chartData,
      forecastData: chartForecastData,
      todayPoint: todayChartPoint,
      todayDate: today,
      displayStartDate: chartDisplayStartDate,
      displayEndDate: chartDisplayEndDate,
      currentBalance,
      label: chartLabel,
      currencyCode: displayCurrencyCode,
      exchangeRateToJpy: chartExchangeRateToJpy,
      disposableZero: applyOffset,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- todayChartPoint はプリミティブから毎レンダー再構築されるため依存に含めない。
  }, [
    isChartLoading,
    hasChartError,
    chartData,
    chartForecastData,
    currentBalance,
    today,
    chartDisplayStartDate,
    chartDisplayEndDate,
    chartLabel,
    displayCurrencyCode,
    chartExchangeRateToJpy,
    applyOffset,
  ]);

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
        current?.date === date && current.accountId === accountId
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
        current?.date === date && current.accountId === accountId
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

  const updateConfirmDraft = (draft: { amount?: number; accountId?: string }) => {
    if (!selectedEvent) {
      return;
    }

    setConfirmDraft({
      eventId: selectedEvent.id,
      amount: draft.amount ?? confirmAmount,
      accountId: draft.accountId ?? accountId,
    });
  };

  const updateOverdueDraft = (
    event: ForecastEvent,
    draft: Partial<Omit<OverdueConfirmDraft, "error">>,
  ) => {
    setOverdueDrafts((current) => {
      const existing = current[event.id] ?? createOverdueConfirmDraft(event, accounts);

      return {
        ...current,
        [event.id]: {
          ...existing,
          ...draft,
          error: undefined,
        },
      };
    });
  };

  const openConfirm = (event: ForecastEvent) => {
    if (optimisticConfirmedIds.includes(event.id)) {
      return;
    }

    setManualSelectedEvent(event);
    setConfirmDraft({
      eventId: event.id,
      amount: event.amount,
      accountId: getDefaultConfirmAccountId(event, accounts),
    });
  };

  const closeConfirm = () => {
    setManualSelectedEvent(null);
    setConfirmDraft(null);
  };

  const handleConfirm = async () => {
    if (!selectedEvent) {
      return;
    }

    const event = selectedEvent;
    const amount = confirmAmount;
    const targetAccountId = accountId;

    closeConfirm();
    setOptimisticConfirmedIds((ids) => [...ids, event.id]);

    try {
      await apiFetch("/api/dashboard/confirm", {
        method: "POST",
        body: JSON.stringify({
          forecastEventId: event.id,
          amount,
          accountId: event.type === "transfer" ? undefined : targetAccountId || undefined,
        }),
      });

      toast({ title: "確定しました", description: event.description, variant: "success" });
      startTransition(() => setReloadKey((value) => value + 1));
    } catch (error) {
      setOptimisticConfirmedIds((ids) => ids.filter((id) => id !== event.id));
      toast({ title: "確定に失敗しました", description: getErrorMessage(error), variant: "error" });
    }
  };

  const handleBatchConfirm = async () => {
    if (selectedOverdueEvents.length === 0 || isBatchConfirming) {
      return;
    }

    setIsBatchConfirming(true);
    const confirmedIds: string[] = [];
    const failedById = new Map<string, string>();

    for (const event of selectedOverdueEvents) {
      const draft = overdueDrafts[event.id] ?? createOverdueConfirmDraft(event, accounts);

      try {
        await apiFetch("/api/dashboard/confirm", {
          method: "POST",
          body: JSON.stringify({
            forecastEventId: event.id,
            amount: draft.amount,
            accountId: event.type === "transfer" ? undefined : draft.accountId || undefined,
          }),
        });
        confirmedIds.push(event.id);
      } catch (error) {
        failedById.set(event.id, getErrorMessage(error));
      }
    }

    setOverdueDrafts((current) => {
      const next = { ...current };

      for (const eventId of confirmedIds) {
        delete next[eventId];
      }

      for (const [eventId, error] of failedById) {
        const event = overdueForecast.find((item) => item.id === eventId);
        const existing = current[eventId] ?? (event ? createOverdueConfirmDraft(event, accounts) : null);
        if (existing) {
          next[eventId] = {
            ...existing,
            selected: true,
            error,
          };
        }
      }

      return next;
    });
    setHiddenOverdueIds((ids) => Array.from(new Set([...ids, ...confirmedIds])));
    setOptimisticConfirmedIds((ids) => Array.from(new Set([...ids, ...confirmedIds])));
    setIsBatchConfirming(false);

    if (confirmedIds.length > 0) {
      toast({
        title: `${confirmedIds.length} 件を確定しました`,
        description: failedById.size > 0 ? `${failedById.size} 件は失敗しました。` : undefined,
        variant: failedById.size > 0 ? "error" : "success",
      });
    } else {
      toast({
        title: "確定に失敗しました",
        description: `${failedById.size} 件のエラーを確認してください。`,
        variant: "error",
      });
    }

    startTransition(() => setReloadKey((value) => value + 1));
  };

  return (
    <div className="grid gap-6">
      {!dashboardLoading && accounts.length === 0 ? (
        <OnboardingCard onNavigate={navigate} />
      ) : null}

      <Card className="reveal-stage-1 grid gap-6">
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

        <div className="border-t border-line pt-4">
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
              <OffsetToggle checked={applyOffset} onChange={setApplyOffset} />
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
        <AccountLevelList rows={accountLevelRows} selectedId={selectedAccountId} onSelect={setSelectedAccountId} />
      </Card>

      {visibleOverdueForecast.length > 0 ? (
        <Card className="reveal-stage-3">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">確定キュー</h2>
              <Badge tone="warning">{visibleOverdueForecast.length} 件</Badge>
            </div>
            <Button variant="ghost" onClick={() => setIsQueueCollapsed((value) => !value)}>
              {isQueueCollapsed ? "開く" : "閉じる"}
            </Button>
          </div>
          <p className="mb-4 max-w-4xl text-sm text-ink-2">
            予定日を過ぎた未確定イベントです。予定額と実績額が一致するとは限らないため、実際の金額と対象口座を確認して確定してください。
          </p>
          {isQueueCollapsed ? null : (
            <>
              <TableWrapper className="max-h-[55dvh] overflow-y-auto rounded-xl border border-line">
                <Table className="min-w-[58rem]">
                  <thead>
                    <tr className="border-b border-line text-left text-xs font-medium text-ink-3">
                      <th scope="col" className="px-3 py-3">選択</th>
                      <th scope="col" className="px-3 py-3">日付</th>
                      <th scope="col" className="px-3 py-3">説明</th>
                      <th scope="col" className="px-3 py-3">種別</th>
                      <th scope="col" className="px-3 py-3">金額</th>
                      <th scope="col" className="px-3 py-3">対象口座</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleOverdueForecast.map((event) => {
                      const draft = overdueDrafts[event.id] ?? createOverdueConfirmDraft(event, accounts);
                      const isConfirmed = optimisticConfirmedIds.includes(event.id);

                      return (
                        <tr
                          key={event.id}
                          className={cn(
                            "border-b border-line align-top transition-opacity duration-200 ease-out motion-reduce:transition-none",
                            !isConfirmed && "cursor-pointer hover:bg-surface-2",
                            isConfirmed && "opacity-50",
                          )}
                          onClick={() => openConfirm(event)}
                        >
                          <td className="px-3 py-3" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                            <Switch
                              aria-label={`${event.description} を確定対象にする`}
                              checked={draft.selected}
                              onChange={(selected) => updateOverdueDraft(event, { selected })}
                              disabled={isBatchConfirming || isConfirmed}
                            />
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-ink-2">
                            {formatDateWithYear(event.date)}
                          </td>
                          <td className="min-w-48 px-3 py-3">
                            <div className="break-words">{event.description}</div>
                            {isConfirmed ? (
                              <div className="mt-1 text-xs text-ink-3">確定済み</div>
                            ) : draft.error ? (
                              <div role="alert" className="mt-2 break-words text-xs text-critical">
                                {draft.error}
                              </div>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-3 py-3">
                            <span className={getForecastTypeClassName(event.type)}>
                              {getForecastTypeLabel(event.type)}
                            </span>
                          </td>
                          <td className="px-3 py-3" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                            <Input
                              type="number"
                              inputMode="decimal"
                              step={event.currencyCode === "JPY" ? 1 : 0.01}
                              aria-label={`${event.description} の実際の金額`}
                              value={formatCurrencyInputValue(draft.amount, event.currencyCode)}
                              onChange={(changeEvent) =>
                                updateOverdueDraft(event, {
                                  amount: parseCurrencyInputValue(changeEvent.target.value, event.currencyCode),
                                })}
                              className="w-36"
                              disabled={isBatchConfirming || isConfirmed}
                            />
                          </td>
                          <td className="px-3 py-3" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                            {event.type === "transfer" ? (
                              <Select
                                aria-label={`${event.description} の対象口座`}
                                value="fixed"
                                className="w-56"
                                disabled
                              >
                                <option value="fixed">{formatForecastAccounts(event, accounts)}</option>
                              </Select>
                            ) : (
                              <Select
                                aria-label={`${event.description} の対象口座`}
                                value={draft.accountId}
                                onChange={(changeEvent) =>
                                  updateOverdueDraft(event, {
                                    accountId: changeEvent.target.value,
                                  })}
                                className="w-48"
                                disabled={isBatchConfirming || isConfirmed}
                              >
                                <option value="">イベント設定口座を使用</option>
                                {accounts
                                  .filter((account) => account.currencyCode === event.currencyCode)
                                  .map((account) => (
                                    <option key={account.id} value={account.id}>
                                      {account.name}
                                    </option>
                                  ))}
                              </Select>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </TableWrapper>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-ink-2">
                  選択中 {selectedOverdueCount} / {visibleOverdueForecast.length} 件
                </div>
                <Button onClick={handleBatchConfirm} disabled={isBatchConfirming || selectedOverdueCount === 0}>
                  選択した {selectedOverdueCount} 件を確定
                </Button>
              </div>
            </>
          )}
        </Card>
      ) : null}

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
            onChange={setPeriodPreset}
          />
        </div>
        <p className="mb-4 max-w-4xl text-sm text-ink-2">
          当日以降の未確定イベントだけを表示します。予測は固定収支、クレジットカード請求、ローン返済から生成し、
          サブスク台帳はカード請求額との二重計上を避けるためここには直接表示しません。
        </p>
        {eventsLoading ? (
          <StateMessage message="読み込み中..." />
        ) : eventsError ? (
          <StateMessage message={eventsError} tone="danger" />
        ) : tableForecast.length === 0 ? (
          <StateMessage message="表示できる予測イベントがありません。" />
        ) : (
          <TableWrapper>
            <Table className="min-w-[60rem]">
              <thead>
                <tr className="border-b border-line text-left text-xs font-medium text-ink-3">
                  <th scope="col" className="px-3 py-3">日付</th>
                  <th scope="col" className="px-3 py-3">種別</th>
                  <th scope="col" className="px-3 py-3">内容</th>
                  <th scope="col" className="px-3 py-3 text-right">金額</th>
                  <th scope="col" className="px-3 py-3 text-right">残高</th>
                  <th scope="col" className="px-3 py-3">対象口座</th>
                  <th scope="col" className="px-3 py-3" />
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
                      <td className="font-data px-3 py-3 text-ink-2">{formatDateWithYear(event.date)}</td>
                      <td className="px-3 py-3">
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
                      <td className="px-3 py-3">
                        {(() => {
                          const parts = formatTypedAmountParts(event.type, event.amount, event.currencyCode, event.amountJpy);
                          return <MoneyCell primary={parts.primary} secondary={parts.secondary} />;
                        })()}
                      </td>
                      <td className="px-3 py-3">
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
                      <td className="px-3 py-3 text-right" onClick={(clickEvent) => clickEvent.stopPropagation()}>
                        {isConfirmed ? (
                          <span className="text-xs text-ink-3">確定済み</span>
                        ) : (
                          <Button variant="ghost" onClick={() => openConfirm(event)}>
                            確定
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </TableWrapper>
        )}
      </Card>

      <Dialog
        open={Boolean(explainDialog)}
        onOpenChange={(open) => {
          if (!open) {
            setExplainDialog(null);
          }
        }}
      >
        <DialogContent className="w-[min(96vw,64rem)]">
          <DialogTitle className="text-lg font-semibold">
            {explainDialog?.title ?? "寄与分解"}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">
            {explainDialog ? `${formatDateWithYear(explainDialog.date)} までの予測残高` : ""}
          </DialogDescription>
          <div className="mt-6">
            {explainDialog?.loading ? (
              <StateMessage message="読み込み中..." />
            ) : explainDialog?.error ? (
              <StateMessage message={explainDialog.error} tone="danger" />
            ) : explainDialog?.data ? (
              <div className="grid gap-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-line bg-surface-2 p-3">
                    <div className="text-xs font-medium text-ink-3">起点残高</div>
                    <div className="mt-2 font-data overflow-x-auto whitespace-nowrap text-lg font-semibold">
                      {formatCurrency(explainDialog.data.startBalance)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-line bg-surface-2 p-3">
                    <div className="text-xs font-medium text-ink-3">指定日残高</div>
                    <div className="mt-2 font-data overflow-x-auto whitespace-nowrap text-lg font-semibold">
                      {formatCurrency(explainDialog.data.finalBalance)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-line bg-surface-2 p-3">
                    <div className="text-xs font-medium text-ink-3">仮定値</div>
                    <div className="mt-2 text-lg font-semibold">
                      {explainDialog.data.assumptionEventCount} 件
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold text-ink-2">source 別小計</h3>
                  <div className="grid gap-2 sm:grid-cols-5">
                    {getExplainSourceTotals(explainDialog.data.sourceTotals).map((item) => (
                      <div key={item.label} className="rounded-xl border border-line bg-surface-2 p-3">
                        <div className="break-words text-xs text-ink-3">{item.label}</div>
                        <div className="mt-1 font-data overflow-x-auto whitespace-nowrap text-sm font-semibold">
                          {formatSignedCurrency(item.value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold text-ink-2">寄与イベント</h3>
                  {explainDialog.data.events.length === 0 ? (
                    <StateMessage message="対象期間の寄与イベントはありません。" />
                  ) : (
                    <TableWrapper className="max-h-[45dvh] overflow-y-auto rounded-xl border border-line">
                      <Table className="min-w-[52rem]">
                        <thead>
                          <tr className="border-b border-line text-left text-xs font-medium text-ink-3">
                            <th scope="col" className="px-3 py-3">日付</th>
                            <th scope="col" className="px-3 py-3">種別</th>
                            <th scope="col" className="px-3 py-3">source</th>
                            <th scope="col" className="px-3 py-3">内容</th>
                            <th scope="col" className="px-3 py-3 text-right">金額</th>
                            <th scope="col" className="px-3 py-3 text-right">残高</th>
                          </tr>
                        </thead>
                        <tbody>
                          {explainDialog.data.events.map((event) => (
                            <tr key={event.id} className="border-b border-line align-top">
                              <td className="whitespace-nowrap px-3 py-3 text-ink-2">
                                {formatDateWithYear(event.date)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3">
                                <span className={getForecastTypeClassName(event.type)}>
                                  {getForecastTypeLabel(event.type)}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-ink-2">
                                {getForecastSourceLabel(event.source)}
                              </td>
                              <td className="min-w-48 px-3 py-3">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <span className="break-words">{event.description}</span>
                                  {event.isAssumption ? <Badge tone="warning">仮定</Badge> : null}
                                </div>
                              </td>
                              <td className="font-data whitespace-nowrap px-3 py-3 text-right">
                                {formatTypedAmount(event.type, event.amountJpy)}
                              </td>
                              <td className="font-data whitespace-nowrap px-3 py-3 text-right">
                                {formatCurrency(event.runningBalance)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </TableWrapper>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedEvent)}
        onOpenChange={(open) => {
          if (!open) {
            closeConfirm();
          }
        }}
      >
        <DialogContent className="inset-x-0 bottom-0 left-0 top-auto w-full max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-[var(--radius-l)] pb-[max(1rem,env(safe-area-inset-bottom))] sm:inset-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[min(94vw,32rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[var(--radius-l)]">
          <DialogTitle className="text-lg font-semibold">予測イベントを確定</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">
            予定額と実績額が一致するとは限らないため、自動確定せず手動で確認します。必要なら金額を変更できます。
            収入・支出イベントでは口座も変更できます。
          </DialogDescription>
          <div className="mt-6 grid gap-4">
            <div className="rounded-2xl bg-surface-2 p-4 text-sm">
              {selectedEvent && (
                <>
                  <div>{selectedEvent.description}</div>
                  <div className="mt-1 text-ink-2">
                    {formatDateWithYear(selectedEvent.date)} /{" "}
                    {selectedEvent.currencyCode === "JPY"
                      ? formatTypedAmount(selectedEvent.type, selectedEvent.amount, selectedEvent.currencyCode)
                      : `${formatTypedAmount(selectedEvent.type, selectedEvent.amount, selectedEvent.currencyCode)}（${formatTypedAmount(selectedEvent.type, selectedEvent.amountJpy, "JPY")}）`}
                  </div>
                </>
              )}
            </div>
            <label className="grid gap-2 text-sm">
              <span>実際の金額</span>
              <Input
                type="number"
                inputMode="decimal"
                step={selectedEvent?.currencyCode === "JPY" ? 1 : 0.01}
                value={
                  selectedEvent
                    ? formatCurrencyInputValue(confirmAmount, selectedEvent.currencyCode)
                    : confirmAmount
                }
                onChange={(event) =>
                  updateConfirmDraft({
                    amount: selectedEvent
                      ? parseCurrencyInputValue(event.target.value, selectedEvent.currencyCode)
                      : Number(event.target.value),
                  })}
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span>対象口座</span>
              {isTransferEvent(selectedEvent) && selectedEvent ? (
                <Select value="fixed" disabled>
                  <option value="fixed">{formatForecastAccounts(selectedEvent, accounts)}</option>
                </Select>
              ) : (
                <Select value={accountId} onChange={(event) => updateConfirmDraft({ accountId: event.target.value })}>
                  <option value="">イベント設定口座を使用</option>
                  {accounts
                    .filter((account) => !selectedEvent || account.currencyCode === selectedEvent.currencyCode)
                    .map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                </Select>
              )}
            </label>
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button variant="ghost" className="w-full sm:w-auto">
                  閉じる
                </Button>
              </DialogClose>
              <Button onClick={handleConfirm} className="w-full sm:w-auto">
                確定する
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
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
    title: "固定収支を登録",
    description: "給与や家賃など、毎月決まって動くお金を登録します。",
    actionLabel: "固定収支を追加",
    to: "/recurring",
  },
  {
    icon: TrendingUp,
    title: "予測が生まれる",
    description: "登録した口座と固定収支から、残高の予測がここに自動で表示されます。",
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
          口座と固定収支を登録すると、残高の予測がこのダッシュボードに表示されます。
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

function StateMessage({ message, tone = "default" }: { message: string; tone?: "default" | "danger" }) {
  return <div className={tone === "danger" ? "text-critical" : "text-ink-2"}>{message}</div>;
}
