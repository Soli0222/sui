import type { AccountForecast, DashboardResponse, ForecastEvent } from "@sui/shared";
import type { PrismaClient, RecurringItemType } from "@sui/db";
import { DEFAULT_SETTINGS } from "@sui/shared";
import {
  addMonthsToYearMonth,
  getCurrentYearMonth,
  getJstToday,
  resolveDateFromYearMonth,
  toDateOnlyString,
} from "../lib/dates";
import { resolveBillingAmount } from "./billings";
import { buildLoanForecastEvents } from "./loans";

interface RawForecastEvent {
  id: string;
  date: string;
  type: "income" | "expense";
  description: string;
  amount: number;
  accountId: string | null;
  sourcePriority: number;
  sortOrder: number;
}

function createRecurringId(id: string, yearMonth: string) {
  return `recurring:${id}:${yearMonth}`;
}

function createCreditCardCardId(cardId: string, yearMonth: string) {
  return `credit-card:${cardId}:${yearMonth}`;
}

export function sortEvents(events: RawForecastEvent[]) {
  return events.sort((left, right) => {
    if (left.date !== right.date) {
      return left.date.localeCompare(right.date);
    }

    if (left.type !== right.type) {
      return left.type === "income" ? -1 : 1;
    }

    if (left.sourcePriority !== right.sourcePriority) {
      return left.sourcePriority - right.sourcePriority;
    }

    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    return left.description.localeCompare(right.description);
  });
}

export function applyEvent(balance: number, event: Pick<RawForecastEvent, "type" | "amount">) {
  return balance + (event.type === "income" ? event.amount : -event.amount);
}

export async function buildDashboard(prisma: PrismaClient): Promise<DashboardResponse> {
  const today = getJstToday();
  const currentYearMonth = getCurrentYearMonth(today);

  const [accounts, recurringItems, creditCards, billings, loans, confirmedTransactions] =
    await Promise.all([
      prisma.account.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      prisma.recurringItem.findMany({
        where: { deletedAt: null, enabled: true },
        include: { account: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      prisma.creditCard.findMany({
        where: { deletedAt: null },
        include: { account: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      prisma.creditCardBilling.findMany({
        include: { items: true },
      }),
      prisma.loan.findMany({
        where: { deletedAt: null },
        include: { account: true },
        orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
      }),
      prisma.transaction.findMany({
        where: { forecastEventId: { not: null } },
        select: { forecastEventId: true, amount: true },
      }),
    ]);

  const totalBalance = accounts.reduce((sum, account) => sum + account.balance, 0);
  const defaultSettlementDay = Number(DEFAULT_SETTINGS.credit_card_settlement_day);
  const forecastMonths = Number(DEFAULT_SETTINGS.forecast_months);

  const billingMap = new Map(
    billings.map((billing) => [
      billing.yearMonth,
      {
        ...billing,
        itemMap: new Map(billing.items.map((item) => [item.creditCardId, item])),
      },
    ]),
  );
  const confirmedEventIds = new Set(
    confirmedTransactions
      .map((transaction) => transaction.forecastEventId)
      .filter((value): value is string => Boolean(value)),
  );

  const rawEvents: RawForecastEvent[] = [];

  for (let offset = 0; offset < forecastMonths; offset += 1) {
    const yearMonth = addMonthsToYearMonth(currentYearMonth, offset);

    for (const item of recurringItems) {
      const startYearMonth = toDateOnlyString(item.startDate)?.slice(0, 7) ?? null;
      const endYearMonth = toDateOnlyString(item.endDate)?.slice(0, 7) ?? null;
      if (startYearMonth && yearMonth < startYearMonth) {
        continue;
      }

      if (endYearMonth && yearMonth > endYearMonth) {
        continue;
      }

      const date = resolveDateFromYearMonth(yearMonth, item.dayOfMonth);
      if (date < today) {
        continue;
      }

      rawEvents.push({
        id: createRecurringId(item.id, yearMonth),
        date,
        type: item.type as RecurringItemType,
        description: item.name,
        amount: item.amount,
        accountId: item.accountId,
        sourcePriority: 10,
        sortOrder: item.sortOrder,
      });
    }

    const billing = billingMap.get(yearMonth);
    for (const card of creditCards) {
      const billingItem = billing?.itemMap.get(card.id);
      const resolvedBilling = resolveBillingAmount({
        actualAmount: billingItem?.amount ?? null,
        assumptionAmount: card.assumptionAmount,
        monthOffset: offset,
      });
      const amount = resolvedBilling.amount;
      const date = billing?.settlementDate
        ? billing.settlementDate.toISOString().slice(0, 10)
        : resolveDateFromYearMonth(yearMonth, card.settlementDay ?? defaultSettlementDay);

      if (date < today || amount <= 0) {
        continue;
      }

      rawEvents.push({
        id: createCreditCardCardId(card.id, yearMonth),
        date,
        type: "expense",
        description: resolvedBilling.sourceType === "actual"
          ? `${card.name} 引き落とし (${yearMonth})`
          : `${card.name} 仮定値 (${yearMonth})`,
        amount,
        accountId: card.accountId,
        sourcePriority: 20,
        sortOrder: card.sortOrder,
      });
    }
  }

  for (const loan of loans) {
    for (const event of buildLoanForecastEvents(loan, confirmedTransactions, today, forecastMonths)) {
      rawEvents.push({
        id: event.id,
        date: event.date,
        type: "expense",
        description: event.description,
        amount: event.amount,
        accountId: loan.accountId,
        sourcePriority: 30,
        sortOrder: 0,
      });
    }
  }

  const sortedEvents = sortEvents(rawEvents).filter((event) => !confirmedEventIds.has(event.id));
  const forecast: ForecastEvent[] = [];
  let runningTotalBalance = totalBalance;
  let minBalance = totalBalance;

  const accountStates = new Map(
    accounts.map((account) => [
      account.id,
      {
        accountId: account.id,
        accountName: account.name,
        currentBalance: account.balance,
        runningBalance: account.balance,
        events: [] as ForecastEvent[],
        minBalance: account.balance,
        minBalanceDate: today,
      },
    ]),
  );

  for (const event of sortedEvents) {
    runningTotalBalance = applyEvent(runningTotalBalance, event);
    minBalance = Math.min(minBalance, runningTotalBalance);

    forecast.push({
      id: event.id,
      date: event.date,
      type: event.type,
      description: event.description,
      amount: event.amount,
      balance: runningTotalBalance,
      accountId: event.accountId,
    });

    if (!event.accountId) {
      continue;
    }

    const accountState = accountStates.get(event.accountId);
    if (!accountState) {
      continue;
    }

    accountState.runningBalance = applyEvent(accountState.runningBalance, event);
    if (accountState.runningBalance < accountState.minBalance) {
      accountState.minBalance = accountState.runningBalance;
      accountState.minBalanceDate = event.date;
    }

    accountState.events.push({
      id: event.id,
      date: event.date,
      type: event.type,
      description: event.description,
      amount: event.amount,
      balance: accountState.runningBalance,
      accountId: event.accountId,
    });
  }

  const accountForecasts: AccountForecast[] = Array.from(accountStates.values()).map((state) => ({
    accountId: state.accountId,
    accountName: state.accountName,
    currentBalance: state.currentBalance,
    events: state.events,
    minBalance: state.minBalance,
    minBalanceDate: state.minBalanceDate,
    willBeNegative: state.events.some((event) => event.balance < 0),
  }));

  return {
    totalBalance,
    minBalance,
    nextIncome: forecast.find((event) => event.type === "income") ?? null,
    nextExpense: forecast.find((event) => event.type === "expense") ?? null,
    forecast,
    accountForecasts,
  };
}
