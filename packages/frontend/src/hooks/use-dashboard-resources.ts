import type { Account, BalanceHistoryResponse, DashboardEventsResponse, DashboardResponse } from "@sui/shared";
import { useState } from "react";
import { apiFetch } from "../lib/api";
import { useResource } from "./use-resource";

function dashboardPath(applyOffset: boolean) {
  return `/api/dashboard?applyOffset=${String(applyOffset)}`;
}

function eventsPath(months: number, applyOffset: boolean) {
  return `/api/dashboard/events?months=${months}&applyOffset=${String(applyOffset)}`;
}

function historyPath(params: { selectedAccountId: string | "total"; startDate: string; endDate: string; applyOffset: boolean }) {
  const searchParams = new URLSearchParams({
    startDate: params.startDate,
    endDate: params.endDate,
    applyOffset: String(params.applyOffset),
  });
  if (params.selectedAccountId !== "total") searchParams.set("accountId", params.selectedAccountId);
  return `/api/transactions/balance-history?${searchParams.toString()}`;
}

export function useDashboardResources({ reloadKey, months, applyOffset, selectedAccountId, chartDisplayStartDate, today }: {
  reloadKey: number;
  months: number;
  applyOffset: boolean;
  selectedAccountId: string | "total";
  chartDisplayStartDate: string;
  today: string;
}) {
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const { data: dashboardData, loading: dashboardLoading, error: dashboardError, setData: setDashboardData } = useResource(
    () => Promise.all([
      apiFetch<DashboardResponse>(dashboardPath(applyOffset)),
      apiFetch<Account[]>("/api/accounts"),
    ]).then(([dashboard, accounts]) => ({ dashboard, accounts })),
    [reloadKey, applyOffset],
  );
  const { data: eventsData, loading: eventsLoading, error: eventsError, setData: setEventsData } = useResource(
    () => apiFetch<DashboardEventsResponse>(eventsPath(months, applyOffset)),
    [reloadKey, months, applyOffset],
  );
  const { data: balanceHistoryData, loading: balanceHistoryLoading, error: balanceHistoryError, setData: setBalanceHistoryData } = useResource(
    () => apiFetch<BalanceHistoryResponse>(historyPath({ selectedAccountId, startDate: chartDisplayStartDate, endDate: today, applyOffset })),
    [reloadKey, selectedAccountId, chartDisplayStartDate, today, applyOffset],
  );
  const refreshForecast = async () => {
    const [nextDashboard, nextAccounts, nextEvents, nextHistory] = await Promise.all([
      apiFetch<DashboardResponse>(dashboardPath(applyOffset)),
      apiFetch<Account[]>("/api/accounts"),
      apiFetch<DashboardEventsResponse>(eventsPath(months, applyOffset)),
      apiFetch<BalanceHistoryResponse>(historyPath({ selectedAccountId, startDate: chartDisplayStartDate, endDate: today, applyOffset })),
    ]);
    setDashboardData({ dashboard: nextDashboard, accounts: nextAccounts });
    setEventsData(nextEvents);
    setBalanceHistoryData(nextHistory);
    setRefreshError(null);
  };
  return { dashboardData, dashboardLoading, dashboardError, eventsData, eventsLoading, eventsError,
    balanceHistoryData, balanceHistoryLoading, balanceHistoryError, refreshForecast, refreshError, setRefreshError };
}
