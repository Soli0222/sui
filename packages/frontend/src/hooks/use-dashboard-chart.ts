import type { BalanceHistoryResponse, DashboardResponse, ForecastEvent, SupportedCurrencyCode } from "@sui/shared";
import { useEffect, useMemo, useState } from "react";

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
  showTrend: boolean;
};


export function useDashboardChart({ dashboard, selectedAccountForecast, chartForecast, balanceHistoryData,
  dashboardLoading, balanceHistoryLoading, eventsLoading, dashboardError, balanceHistoryError, eventsError,
  today, chartDisplayStartDate, chartDisplayEndDate, applyOffset, showTrend }: {
  dashboard: DashboardResponse | null;
  selectedAccountForecast: DashboardResponse["accountForecasts"][number] | null;
  chartForecast: ForecastEvent[];
  balanceHistoryData: BalanceHistoryResponse | null;
  dashboardLoading: boolean; balanceHistoryLoading: boolean; eventsLoading: boolean;
  dashboardError: string | null; balanceHistoryError: string | null; eventsError: string | null;
  today: string; chartDisplayStartDate: string; chartDisplayEndDate: string;
  applyOffset: boolean; showTrend: boolean;
}) {
  const [renderedChart, setRenderedChart] = useState<ChartSnapshot | null>(null);
  const currentBalance =
    selectedAccountForecast?.currentBalance ?? dashboard?.totalBalance ?? 0;
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
  const isChartLoading = dashboardLoading || balanceHistoryLoading || eventsLoading;
  const hasChartError = Boolean(dashboardError || balanceHistoryError || eventsError);

  useEffect(() => {
    if (isChartLoading || hasChartError) {
      return;
    }

    // Keep the last complete chart while its next data set is loading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      showTrend,
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
    showTrend,
  ]);

  return { renderedChart, isChartLoading, hasChartError };
}
