import type { AccountForecast, DashboardResponse, ForecastEvent, ForecastEventSource } from "@sui/shared";
import type {
  Account,
  CreditCard,
  CreditCardBilling,
  CreditCardItem,
  Loan,
  RecurringItem,
  RecurringItemType,
  Transaction,
} from "@sui/db";
import {
  DEFAULT_CURRENCY_CODE,
  DEFAULT_EXCHANGE_RATE_TO_JPY,
  DEFAULT_SETTINGS,
  type SupportedCurrencyCode,
} from "@sui/shared";
import {
  addMonthsToYearMonth,
  getCurrentYearMonth,
  resolveDateFromYearMonth,
  toDateOnlyString,
} from "../lib/dates";
import { adjustToBusinessDay } from "../lib/business-day";
import { normalizeCurrencyCode, toJpy } from "../lib/currency";
import { resolveBillingAmount } from "./billings";
import { buildLoanForecastEvents } from "./loans";

export interface RawForecastEvent {
  id: string;
  date: string;
  type: "income" | "expense" | "transfer";
  source: ForecastEventSource;
  isAssumption: boolean;
  description: string;
  amount: number;
  currencyCode?: SupportedCurrencyCode;
  exchangeRateToJpy?: number;
  accountId: string | null;
  transferToAccountId?: string | null;
  sourcePriority: number;
  sortOrder: number;
}

type CurrencyAccount = {
  currencyCode: string;
  exchangeRateToJpy: number;
};

export type ForecastRecurringItem = RecurringItem & {
  account: Account | null;
  transferToAccount: Account | null;
};

export type ForecastCreditCard = CreditCard & {
  account: Account | null;
};

export type ForecastBilling = CreditCardBilling & {
  items: CreditCardItem[];
};

export type ForecastLoan = Loan & {
  account: Account | null;
};

export interface BuildDashboardCoreInput {
  accounts: Account[];
  recurringItems: ForecastRecurringItem[];
  creditCards: ForecastCreditCard[];
  billings: ForecastBilling[];
  loans: ForecastLoan[];
  confirmedTransactions: Array<Pick<Transaction, "forecastEventId" | "amount">>;
  today: string;
  forecastMonths: number;
  applyOffset: boolean;
}

function createRecurringId(id: string, yearMonth: string) {
  return `recurring:${id}:${yearMonth}`;
}

function createCreditCardCardId(cardId: string, yearMonth: string) {
  return `credit-card:${cardId}:${yearMonth}`;
}

const eventTypeOrder: Record<RawForecastEvent["type"], number> = {
  income: 0,
  transfer: 1,
  expense: 2,
};

export function sortEvents(events: RawForecastEvent[]) {
  return events.sort((left, right) => {
    if (left.date !== right.date) {
      return left.date.localeCompare(right.date);
    }

    if (left.type !== right.type) {
      return eventTypeOrder[left.type] - eventTypeOrder[right.type];
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
  if (event.type === "income") {
    return balance + event.amount;
  }

  if (event.type === "expense") {
    return balance - event.amount;
  }

  return balance;
}

function getEventAmountJpy(event: Pick<RawForecastEvent, "amount" | "currencyCode" | "exchangeRateToJpy">) {
  return toJpy(event.amount, {
    currencyCode: event.currencyCode ?? DEFAULT_CURRENCY_CODE,
    exchangeRateToJpy: event.exchangeRateToJpy ?? DEFAULT_EXCHANGE_RATE_TO_JPY,
  });
}

function getAccountCurrency(account: CurrencyAccount | null | undefined) {
  return {
    currencyCode: account ? normalizeCurrencyCode(account.currencyCode) : DEFAULT_CURRENCY_CODE,
    exchangeRateToJpy: account?.exchangeRateToJpy ?? DEFAULT_EXCHANGE_RATE_TO_JPY,
  };
}

function getDisposableBalance(account: { balance: number; balanceOffset: number }) {
  return account.balance - account.balanceOffset;
}

function getEffectiveBalance(
  account: { balance: number; balanceOffset: number },
  applyOffset: boolean,
) {
  return applyOffset ? getDisposableBalance(account) : account.balance;
}

export function buildDashboardCore({
  accounts,
  recurringItems,
  creditCards,
  billings,
  loans,
  confirmedTransactions,
  today,
  forecastMonths,
  applyOffset,
}: BuildDashboardCoreInput): DashboardResponse {
  const currentYearMonth = getCurrentYearMonth(today);
  const defaultSettlementDay = Number(DEFAULT_SETTINGS.credit_card_settlement_day);

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

      const baseDate = resolveDateFromYearMonth(yearMonth, item.dayOfMonth);
      const date = adjustToBusinessDay(baseDate, item.dateShiftPolicy);
      const startDate = toDateOnlyString(item.startDate);
      const endDate = toDateOnlyString(item.endDate);
      if (startDate && date < startDate) {
        continue;
      }

      if (endDate && date > endDate) {
        continue;
      }

      rawEvents.push({
        id: createRecurringId(item.id, yearMonth),
        date,
        type: item.type as RecurringItemType,
        source: item.type === "transfer" ? "transfer" : "recurring",
        isAssumption: false,
        description: item.name,
        amount: item.amount,
        ...getAccountCurrency(item.account),
        accountId: item.accountId,
        transferToAccountId: item.transferToAccountId,
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
        : adjustToBusinessDay(
            resolveDateFromYearMonth(yearMonth, card.settlementDay ?? defaultSettlementDay),
            card.dateShiftPolicy,
          );

      if (amount <= 0) {
        continue;
      }

      rawEvents.push({
        id: createCreditCardCardId(card.id, yearMonth),
        date,
        type: "expense",
        source: "credit-card",
        isAssumption: resolvedBilling.sourceType !== "actual",
        description: resolvedBilling.sourceType === "actual"
          ? `${card.name} 引き落とし (${yearMonth})`
          : `${card.name} 仮定値 (${yearMonth})`,
        amount,
        ...getAccountCurrency(card.account),
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
        source: "loan",
        isAssumption: false,
        description: event.description,
        amount: event.amount,
        ...getAccountCurrency(loan.account),
        accountId: loan.accountId,
        sourcePriority: 30,
        sortOrder: 0,
      });
    }
  }

  const sortedEvents = sortEvents(rawEvents).filter((event) => !confirmedEventIds.has(event.id));

  const totalBalance = accounts.reduce(
    (sum, account) => sum + toJpy(getEffectiveBalance(account, applyOffset), account),
    0,
  );
  const pastEvents = sortedEvents.filter((event) => event.date < today);
  const overdueForecast: ForecastEvent[] = [];
  let runningOverdueBalance = totalBalance;

  for (const event of pastEvents) {
    const amountJpy = getEventAmountJpy(event);
    const currencyCode = event.currencyCode ?? DEFAULT_CURRENCY_CODE;
    runningOverdueBalance = applyEvent(runningOverdueBalance, { type: event.type, amount: amountJpy });
    overdueForecast.push({
      id: event.id,
      date: event.date,
      type: event.type,
      source: event.source,
      isAssumption: event.isAssumption,
      description: event.description,
      amount: event.amount,
      amountJpy,
      balance: runningOverdueBalance,
      balanceJpy: runningOverdueBalance,
      currencyCode,
      accountId: event.accountId,
      transferToAccountId: event.transferToAccountId,
    });
  }

  const futureEvents = sortedEvents.filter((event) => event.date >= today);

  const forecast: ForecastEvent[] = [];
  let runningTotalBalance = totalBalance;
  let minBalance = totalBalance;

  const accountStates = new Map(
    accounts.map((account) => [
      account.id,
      {
        accountId: account.id,
        accountName: account.name,
        currencyCode: normalizeCurrencyCode(account.currencyCode),
        exchangeRateToJpy: account.exchangeRateToJpy,
        currentBalance: getEffectiveBalance(account, applyOffset),
        currentBalanceJpy: toJpy(getEffectiveBalance(account, applyOffset), account),
        runningBalance: getEffectiveBalance(account, applyOffset),
        runningRealBalance: account.balance,
        events: [] as ForecastEvent[],
        minBalance: getEffectiveBalance(account, applyOffset),
        minBalanceJpy: toJpy(getEffectiveBalance(account, applyOffset), account),
        minBalanceDate: today,
        willBeRealNegative: false,
      },
    ]),
  );

  const appendAccountEvent = (
    accountId: string | null | undefined,
    event: RawForecastEvent,
    balanceDelta: number,
    amountJpy: number,
    currencyCode: SupportedCurrencyCode,
  ) => {
    if (!accountId) {
      return;
    }

    const accountState = accountStates.get(accountId);
    if (!accountState) {
      return;
    }

    accountState.runningBalance += balanceDelta;
    accountState.runningRealBalance += balanceDelta;
    if (accountState.runningRealBalance < 0) {
      accountState.willBeRealNegative = true;
    }
    if (accountState.runningBalance < accountState.minBalance) {
      accountState.minBalance = accountState.runningBalance;
      accountState.minBalanceJpy = toJpy(accountState.runningBalance, accountState);
      accountState.minBalanceDate = event.date;
    }

    accountState.events.push({
      id: event.id,
      date: event.date,
      type: event.type,
      source: event.source,
      isAssumption: event.isAssumption,
      description: event.description,
      amount: event.amount,
      amountJpy,
      balance: accountState.runningBalance,
      balanceJpy: toJpy(accountState.runningBalance, accountState),
      currencyCode,
      accountId: event.accountId,
      transferToAccountId: event.transferToAccountId,
    });
  };

  for (const event of futureEvents) {
    const amountJpy = getEventAmountJpy(event);
    const currencyCode = event.currencyCode ?? DEFAULT_CURRENCY_CODE;
    runningTotalBalance = applyEvent(runningTotalBalance, { type: event.type, amount: amountJpy });
    minBalance = Math.min(minBalance, runningTotalBalance);

    forecast.push({
      id: event.id,
      date: event.date,
      type: event.type,
      source: event.source,
      isAssumption: event.isAssumption,
      description: event.description,
      amount: event.amount,
      amountJpy,
      balance: runningTotalBalance,
      balanceJpy: runningTotalBalance,
      currencyCode,
      accountId: event.accountId,
      transferToAccountId: event.transferToAccountId,
    });

    if (event.type === "transfer") {
      appendAccountEvent(event.accountId, event, -event.amount, amountJpy, currencyCode);
      appendAccountEvent(event.transferToAccountId, event, event.amount, amountJpy, currencyCode);
      continue;
    }

    appendAccountEvent(
      event.accountId,
      event,
      event.type === "income" ? event.amount : -event.amount,
      amountJpy,
      currencyCode,
    );
  }

  const accountForecasts: AccountForecast[] = Array.from(accountStates.values()).map((state) => ({
    accountId: state.accountId,
    accountName: state.accountName,
    currentBalance: state.currentBalance,
    currentBalanceJpy: state.currentBalanceJpy,
    currencyCode: state.currencyCode,
    exchangeRateToJpy: state.exchangeRateToJpy,
    events: state.events,
    minBalance: state.minBalance,
    minBalanceJpy: state.minBalanceJpy,
    minBalanceDate: state.minBalanceDate,
    warningLevel: state.willBeRealNegative
      ? "red"
      : state.events.some((event) => event.balance < 0)
        ? "yellow"
        : "none",
  }));

  return {
    totalBalance,
    minBalance,
    nextIncome: forecast.find((event) => event.type === "income") ?? null,
    nextExpense: forecast.find((event) => event.type === "expense") ?? null,
    overdueForecast,
    forecast,
    accountForecasts,
  };
}
