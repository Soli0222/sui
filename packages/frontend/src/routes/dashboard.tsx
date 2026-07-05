import type {
  Account,
  BalanceHistoryResponse,
  DashboardEventsResponse,
  DashboardExplainResponse,
  DashboardResponse,
  ForecastEvent,
  SupportedCurrencyCode,
} from "@sui/shared";
import { useState, startTransition } from "react";
import { AccountSelector } from "../components/account-selector";
import { BalanceChart } from "../components/balance-chart";
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
import { Select } from "../components/ui/select";
import { Table, TableWrapper } from "../components/ui/table";
import { useResource } from "../hooks/use-resource";
import { apiFetch } from "../lib/api";
import {
  formatCurrency,
  formatCurrencyInputValue,
  formatCurrencyWithJpy,
  formatDateWithYear,
  parseCurrencyInputValue,
} from "../lib/format";
import { getDashboardChartEndDate, getDashboardChartStartDate } from "../lib/balance-chart";
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

  return `${formatDateWithYear(event.date)} ${formatCurrencyWithJpy(
    event.amount,
    event.currencyCode,
    event.amountJpy,
  )}`;
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
  if (type === "income") {
    return "text-sky-300";
  }

  if (type === "expense") {
    return "text-pink-300";
  }

  return "text-amber-300";
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

export function DashboardPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedAccountId, setSelectedAccountId] = useState<string | "total">("total");
  const [periodPreset, setPeriodPreset] = useState<DashboardPeriodPreset>(DEFAULT_DASHBOARD_PERIOD);
  const [applyOffset, setApplyOffset] = useState(true);
  const [manualSelectedEvent, setManualSelectedEvent] = useState<ForecastEvent | null>(null);
  const [explainDialog, setExplainDialog] = useState<ExplainDialogState | null>(null);
  const [dismissedOverdueSignature, setDismissedOverdueSignature] = useState<string | null>(null);
  const [overdueDrafts, setOverdueDrafts] = useState<Record<string, OverdueConfirmDraft>>({});
  const [hiddenOverdueIds, setHiddenOverdueIds] = useState<string[]>([]);
  const [isBatchConfirming, setIsBatchConfirming] = useState(false);
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
  const chartForecast =
    selectedAccountId === "total"
      ? eventsData?.forecast ?? dashboardData?.dashboard.forecast ?? []
      : selectedAccountEvents?.events ?? selectedAccountForecast?.events ?? [];
  const tableForecast = selectedAccountEvents?.events ?? eventsData?.forecast ?? [];
  const overdueForecast = dashboardData?.dashboard.overdueForecast ?? [];
  const visibleOverdueForecast = overdueForecast.filter((event) => !hiddenOverdueIds.includes(event.id));
  const visibleOverdueSignature = visibleOverdueForecast.map((event) => event.id).join("|");
  const isOverdueDialogOpen =
    visibleOverdueForecast.length > 0 && dismissedOverdueSignature !== visibleOverdueSignature;
  const currentBalance =
    selectedAccountForecast?.currentBalance ?? dashboardData?.dashboard.totalBalance ?? 0;
  const displayCurrencyCode: SupportedCurrencyCode = selectedAccountForecast?.currencyCode ?? "JPY";
  const todayChartPoint = {
    date: today,
    description: selectedAccountForecast ? `${selectedAccountForecast.accountName} 現在残高` : "総所持金",
    balance: currentBalance,
  };
  const chartData = (balanceHistoryData?.points ?? []).map((point) => ({
    date: point.date,
    description: point.description,
    balance: point.balance,
  }));
  const chartForecastData = chartForecast.map((point) => ({
    date: point.date,
    description: point.description,
    balance: point.balance,
  }));
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

    await apiFetch("/api/dashboard/confirm", {
      method: "POST",
      body: JSON.stringify({
        forecastEventId: selectedEvent.id,
        amount: confirmAmount,
        accountId: selectedEvent.type === "transfer" ? undefined : accountId || undefined,
      }),
    });

    closeConfirm();
    startTransition(() => setReloadKey((value) => value + 1));
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
    setDismissedOverdueSignature(failedById.size > 0 ? null : visibleOverdueSignature);
    setIsBatchConfirming(false);
    startTransition(() => setReloadKey((value) => value + 1));
  };

  return (
    <div className="grid gap-6">
      {redForecasts.length > 0 ? (
        <Card className="border-pink-400/30 bg-pink-900/70">
          <div className="break-words text-sm font-medium text-pink-100">
            🔴 実残高がマイナスになる見込み:{" "}
            {redForecasts
              .map((forecast) => `${forecast.accountName}（${formatDateWithYear(forecast.firstNegativeDate)}）`)
              .join("、")}
          </div>
        </Card>
      ) : null}
      {yellowForecasts.length > 0 ? (
        <Card className="border-yellow-400/30 bg-yellow-900/70">
          <div className="break-words text-sm font-medium text-yellow-100">
            ⚠️ 可処分残高がマイナスになる見込み:{" "}
            {yellowForecasts
              .map((forecast) => `${forecast.accountName}（${formatDateWithYear(forecast.firstNegativeDate)}）`)
              .join("、")}
          </div>
        </Card>
      ) : null}
      {visibleOverdueForecast.length > 0 && !isOverdueDialogOpen ? (
        <Card className="border-yellow-400/30 bg-yellow-900/70">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="break-words text-sm font-medium text-yellow-100">
              ⏳ 予定日超過の未確定イベントが {visibleOverdueForecast.length} 件あります
            </div>
            <Button variant="ghost" onClick={() => setDismissedOverdueSignature(null)}>
              確認する
            </Button>
          </div>
        </Card>
      ) : null}

      <section className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="総所持金" value={formatCurrency(dashboardData?.dashboard.totalBalance ?? 0)} />
        <SummaryCard
          title="全体の最小残高"
          value={formatCurrency(dashboardData?.dashboard.minBalance ?? 0)}
          onClick={dashboardData
            ? () =>
                openExplain({
                  title: "全体の最小残高の寄与分解",
                  date: totalMinBalanceDate,
                })
            : undefined}
        />
        <SummaryCard
          title="次の収入"
          value={formatSummaryEvent(dashboardData?.dashboard.nextIncome ?? null)}
          detail={dashboardData?.dashboard.nextIncome?.description}
        />
        <SummaryCard
          title="次の支出"
          value={formatSummaryEvent(dashboardData?.dashboard.nextExpense ?? null)}
          detail={dashboardData?.dashboard.nextExpense?.description}
        />
      </section>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <AccountSelector
            accounts={accounts}
            selected={selectedAccountId}
            onChange={(next) => setSelectedAccountId(next)}
          />
        </div>
        <div className="ml-auto min-w-0 shrink">
          <OffsetToggle checked={applyOffset} onChange={setApplyOffset} />
        </div>
      </div>

      <Card className="flex h-[360px] flex-col overflow-hidden px-4 pt-4 pb-2 sm:h-[450px] sm:px-5 sm:pt-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-xl font-semibold">
              {selectedAccountForecast ? `${selectedAccountForecast.accountName} の残高推移` : "所持金推移"}
            </h2>
            <p className="text-sm text-white/60">
              {selectedAccountForecast ? "選択した口座に影響するイベントのみ表示します。" : "全口座合計の残高チェーンです。"}
            </p>
          </div>
          {selectedAccountForecast ? (
            <Button
              variant="ghost"
              className={cn(
                "max-w-full justify-start rounded-full px-3 py-1 text-xs",
                selectedAccountForecast.warningLevel === "red" && "bg-danger/15 text-pink-300 hover:bg-danger/25",
                selectedAccountForecast.warningLevel === "yellow" &&
                  "bg-yellow-500/15 text-yellow-300 hover:bg-yellow-500/25",
                selectedAccountForecast.warningLevel === "none" &&
                  "bg-success/15 text-sky-300 hover:bg-success/25",
              )}
              onClick={() =>
                openExplain({
                  title: `${selectedAccountForecast.accountName} の最小残高の寄与分解`,
                  date: selectedAccountForecast.minBalanceDate,
                  accountId: selectedAccountForecast.accountId,
                })}
            >
              最小残高 {formatCurrencyWithJpy(
                selectedAccountForecast.minBalance,
                selectedAccountForecast.currencyCode,
                selectedAccountForecast.minBalanceJpy,
              )}
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setReloadKey((value) => value + 1)}>
              再読込
            </Button>
          )}
        </div>
        {dashboardLoading || balanceHistoryLoading || eventsLoading ? (
          <StateMessage message="読み込み中..." />
        ) : dashboardError || balanceHistoryError || eventsError ? (
          <StateMessage message={dashboardError ?? balanceHistoryError ?? eventsError ?? "読み込みに失敗しました。"} tone="danger" />
        ) : (
          <div className="min-h-0 min-w-0 flex-1">
            <BalanceChart
              data={chartData}
              forecastData={chartForecastData}
              todayPoint={todayChartPoint}
              todayDate={today}
              displayStartDate={chartDisplayStartDate}
              displayEndDate={chartDisplayEndDate}
              currentBalance={currentBalance}
              label={selectedAccountForecast?.accountName ?? "総所持金"}
              currencyCode={displayCurrencyCode}
            />
          </div>
        )}
      </Card>

      <Card>
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
        <p className="mb-4 max-w-4xl text-sm text-white/60">
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
                      {formatCurrencyWithJpy(event.amount, event.currencyCode, event.amountJpy)}
                    </td>
                    <td className="px-3 py-3">
                      {selectedAccountForecast
                        ? formatCurrencyWithJpy(event.balance, event.currencyCode, event.balanceJpy)
                        : formatCurrency(event.balanceJpy)}
                    </td>
                    <td className="px-3 py-3">
                      {formatForecastAccounts(event, accounts)}
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
          <DialogDescription className="mt-2 text-sm text-white/60">
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
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-white/45">起点残高</div>
                    <div className="mt-2 break-all text-lg font-semibold">
                      {formatCurrency(explainDialog.data.startBalance)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-white/45">指定日残高</div>
                    <div className="mt-2 break-all text-lg font-semibold">
                      {formatCurrency(explainDialog.data.finalBalance)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-white/45">仮定値</div>
                    <div className="mt-2 text-lg font-semibold">
                      {explainDialog.data.assumptionEventCount} 件
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold text-white/70">source 別小計</h3>
                  <div className="grid gap-2 sm:grid-cols-5">
                    {getExplainSourceTotals(explainDialog.data.sourceTotals).map((item) => (
                      <div key={item.label} className="rounded-xl border border-white/10 bg-black/20 p-3">
                        <div className="break-words text-xs text-white/50">{item.label}</div>
                        <div className="mt-1 break-all text-sm font-semibold">
                          {formatSignedCurrency(item.value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="mb-3 text-sm font-semibold text-white/70">寄与イベント</h3>
                  {explainDialog.data.events.length === 0 ? (
                    <StateMessage message="対象期間の寄与イベントはありません。" />
                  ) : (
                    <TableWrapper className="max-h-[45dvh] overflow-y-auto rounded-xl border border-white/10">
                      <Table className="min-w-[52rem]">
                        <thead>
                          <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.18em] text-white/45">
                            <th className="px-3 py-3">日付</th>
                            <th className="px-3 py-3">種別</th>
                            <th className="px-3 py-3">source</th>
                            <th className="px-3 py-3">内容</th>
                            <th className="px-3 py-3">金額</th>
                            <th className="px-3 py-3">残高</th>
                          </tr>
                        </thead>
                        <tbody>
                          {explainDialog.data.events.map((event) => (
                            <tr key={event.id} className="border-b border-white/5 align-top">
                              <td className="whitespace-nowrap px-3 py-3 text-white/70">
                                {formatDateWithYear(event.date)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3">
                                <span className={getForecastTypeClassName(event.type)}>
                                  {getForecastTypeLabel(event.type)}
                                </span>
                              </td>
                              <td className="whitespace-nowrap px-3 py-3 text-white/70">
                                {getForecastSourceLabel(event.source)}
                              </td>
                              <td className="min-w-48 px-3 py-3">
                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                  <span className="break-words">{event.description}</span>
                                  {event.isAssumption ? <Badge tone="warning">仮定</Badge> : null}
                                </div>
                              </td>
                              <td className="whitespace-nowrap px-3 py-3">
                                {formatCurrency(event.amountJpy)}
                              </td>
                              <td className="whitespace-nowrap px-3 py-3">
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
        open={isOverdueDialogOpen}
        onOpenChange={(open) => {
          setDismissedOverdueSignature(open ? null : visibleOverdueSignature);
        }}
      >
        <DialogContent className="w-[min(96vw,72rem)]">
          <DialogTitle className="text-lg font-semibold">予定日超過イベントを確認</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-white/60">
            予定日を過ぎた未確定イベントです。予定額と実績額が一致するとは限らないため、実際の金額と対象口座を確認して確定してください。
          </DialogDescription>
          <div className="mt-6">
            <TableWrapper className="max-h-[55dvh] overflow-y-auto rounded-xl border border-white/10">
              <Table className="min-w-[58rem]">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.18em] text-white/45">
                    <th className="px-3 py-3">選択</th>
                    <th className="px-3 py-3">日付</th>
                    <th className="px-3 py-3">説明</th>
                    <th className="px-3 py-3">種別</th>
                    <th className="px-3 py-3">金額</th>
                    <th className="px-3 py-3">対象口座</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOverdueForecast.map((event) => {
                    const draft = overdueDrafts[event.id] ?? createOverdueConfirmDraft(event, accounts);

                    return (
                      <tr key={event.id} className="border-b border-white/5 align-top">
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            aria-label={`${event.description} を確定対象にする`}
                            checked={draft.selected}
                            onChange={(changeEvent) =>
                              updateOverdueDraft(event, {
                                selected: changeEvent.target.checked,
                              })}
                            className="h-4 w-4 rounded border-white/20 bg-black/20"
                            disabled={isBatchConfirming}
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-white/70">
                          {formatDateWithYear(event.date)}
                        </td>
                        <td className="min-w-48 px-3 py-3">
                          <div className="break-words">{event.description}</div>
                          {draft.error ? (
                            <div role="alert" className="mt-2 break-words text-xs text-pink-300">
                              {draft.error}
                            </div>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <span className={getForecastTypeClassName(event.type)}>
                            {getForecastTypeLabel(event.type)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
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
                            disabled={isBatchConfirming}
                          />
                        </td>
                        <td className="px-3 py-3">
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
                              disabled={isBatchConfirming}
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
              <div className="text-sm text-white/60">
                選択中 {selectedOverdueCount} / {visibleOverdueForecast.length} 件
              </div>
              <div className="flex flex-wrap justify-end gap-3">
                <Button
                  variant="ghost"
                  onClick={() => setDismissedOverdueSignature(visibleOverdueSignature)}
                  disabled={isBatchConfirming}
                >
                  あとで
                </Button>
                <Button onClick={handleBatchConfirm} disabled={isBatchConfirming || selectedOverdueCount === 0}>
                  選択した {selectedOverdueCount} 件を確定
                </Button>
              </div>
            </div>
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
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">予測イベントを確定</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-white/60">
            予定額と実績額が一致するとは限らないため、自動確定せず手動で確認します。必要なら金額を変更できます。
            収入・支出イベントでは口座も変更できます。
          </DialogDescription>
          <div className="mt-6 grid gap-4">
            <div className="rounded-2xl bg-black/20 p-4 text-sm">
              {selectedEvent && (
                <>
                  <div>{selectedEvent.description}</div>
                  <div className="mt-1 text-white/60">
                    {formatDateWithYear(selectedEvent.date)} /{" "}
                    {formatCurrencyWithJpy(selectedEvent.amount, selectedEvent.currencyCode, selectedEvent.amountJpy)}
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
  onClick,
}: {
  title: string;
  value: string;
  detail?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="break-words text-sm uppercase tracking-[0.18em] text-white/45">{title}</div>
      <div className="mt-3 min-w-0 break-all text-3xl font-semibold">{value}</div>
      {detail ? <div className="mt-2 break-words text-sm text-white/60">{detail}</div> : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={cn(
          "min-w-0 rounded-xl border border-white/10 bg-card/90 p-4 text-left shadow-glow backdrop-blur transition hover:border-primary/50 hover:bg-white/5 focus:outline-none focus:ring-2 focus:ring-primary/60 sm:rounded-2xl sm:p-5",
        )}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <Card>
      {content}
    </Card>
  );
}

function StateMessage({ message, tone = "default" }: { message: string; tone?: "default" | "danger" }) {
  return <div className={tone === "danger" ? "text-pink-300" : "text-white/60"}>{message}</div>;
}
