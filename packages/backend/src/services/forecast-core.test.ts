import type {
  Account,
  CreditCardItem,
  DateShiftPolicy,
  LoanPaymentMethod,
  RecurringItemType,
} from "@sui/db";
import { describe, expect, it } from "vitest";
import {
  buildDashboardCore,
  type BuildDashboardCoreInput,
  type ForecastBilling,
  type ForecastCreditCard,
  type ForecastLoan,
  type ForecastRecurringItem,
} from "./forecast-core";

const timestamp = new Date("2026-01-01T00:00:00.000Z");

function date(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "account-1",
    name: "Main",
    balance: 0,
    balanceOffset: 0,
    lastReconciledAt: null,
    currencyCode: "JPY",
    exchangeRateToJpy: 1,
    exchangeRateUpdatedAt: timestamp,
    sortOrder: 0,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function recurringItem(overrides: Partial<ForecastRecurringItem> = {}): ForecastRecurringItem {
  const linkedAccount = overrides.account ?? null;
  return {
    id: "recurring-1",
    name: "Recurring",
    type: "expense" as RecurringItemType,
    amount: 100,
    dayOfMonth: 1,
    accountId: linkedAccount?.id ?? null,
    enabled: true,
    startDate: null,
    endDate: null,
    dateShiftPolicy: "none" as DateShiftPolicy,
    sortOrder: 0,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    account: linkedAccount,
    ...overrides,
  };
}

function creditCard(overrides: Partial<ForecastCreditCard> = {}): ForecastCreditCard {
  const linkedAccount = overrides.account ?? null;
  return {
    id: "card-1",
    name: "Card",
    settlementDay: 27,
    accountId: linkedAccount?.id ?? null,
    assumptionAmount: 10000,
    dateShiftPolicy: "none" as DateShiftPolicy,
    sortOrder: 0,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    account: linkedAccount,
    ...overrides,
  };
}

function billingItem({
  creditCardId,
  ...overrides
}: Partial<CreditCardItem> & Pick<CreditCardItem, "creditCardId">): CreditCardItem {
  return {
    id: `item-${creditCardId}`,
    billingId: overrides.billingId ?? "billing-1",
    creditCardId,
    amount: 0,
    updatedAt: timestamp,
    ...overrides,
  };
}

function billing({
  yearMonth,
  ...overrides
}: Partial<ForecastBilling> & Pick<ForecastBilling, "yearMonth">): ForecastBilling {
  return {
    id: `billing-${yearMonth}`,
    yearMonth,
    settlementDate: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    items: [],
    ...overrides,
  };
}

function loan(overrides: Partial<ForecastLoan> = {}): ForecastLoan {
  const linkedAccount = overrides.account ?? null;
  return {
    id: "loan-1",
    name: "Loan",
    totalAmount: 1000,
    startDate: date("2026-01-01"),
    paymentCount: 1,
    dateShiftPolicy: "none" as DateShiftPolicy,
    paymentMethod: "account_withdrawal" as LoanPaymentMethod,
    accountId: linkedAccount?.id ?? null,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    account: linkedAccount,
    ...overrides,
  };
}

function buildDashboard(overrides: Partial<BuildDashboardCoreInput> = {}) {
  return buildDashboardCore({
    accounts: [],
    recurringItems: [],
    creditCards: [],
    billings: [],
    loans: [],
    confirmedTransactions: [],
    today: "2026-01-01",
    forecastMonths: 1,
    applyOffset: true,
    ...overrides,
  });
}

function forecastEvent(result: ReturnType<typeof buildDashboard>, id: string) {
  const event = [...result.overdueForecast, ...result.forecast].find((item) => item.id === id);
  if (!event) {
    throw new Error(`Forecast event not found: ${id}`);
  }
  return event;
}

describe("buildDashboardCore", () => {
  it("rounds recurring items on dayOfMonth=31 to the last day of shorter months", () => {
    const main = account({ balance: 1000 });
    const item = recurringItem({
      id: "month-end",
      name: "Month End",
      dayOfMonth: 31,
      account: main,
      accountId: main.id,
    });

    const result = buildDashboard({
      accounts: [main],
      recurringItems: [item],
      today: "2026-01-01",
      forecastMonths: 4,
    });

    expect(result.forecast).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "recurring:month-end:2026-02", date: "2026-02-28" }),
        expect.objectContaining({ id: "recurring:month-end:2026-04", date: "2026-04-30" }),
      ]),
    );
  });

  it("applies previous and next dateShiftPolicy when shifting across month boundaries", () => {
    const main = account({ balance: 1000 });
    const previous = recurringItem({
      id: "previous-boundary",
      dayOfMonth: 1,
      dateShiftPolicy: "previous",
      account: main,
      accountId: main.id,
      sortOrder: 1,
    });
    const next = recurringItem({
      id: "next-boundary",
      dayOfMonth: 31,
      dateShiftPolicy: "next",
      account: main,
      accountId: main.id,
      sortOrder: 2,
    });

    const result = buildDashboard({
      accounts: [main],
      recurringItems: [previous, next],
      today: "2026-01-01",
      forecastMonths: 2,
    });

    expect(forecastEvent(result, "recurring:previous-boundary:2026-02")).toMatchObject({
      date: "2026-01-30",
    });
    expect(forecastEvent(result, "recurring:next-boundary:2026-01")).toMatchObject({
      date: "2026-02-02",
    });
  });

  it("honors recurring item start and end date boundaries before and after business-day shifts", () => {
    const main = account({ balance: 1000 });
    const startDateBoundary = recurringItem({
      id: "start-date-boundary",
      dayOfMonth: 10,
      startDate: date("2026-03-15"),
      account: main,
      accountId: main.id,
      sortOrder: 1,
    });
    const endDateBoundary = recurringItem({
      id: "end-date-boundary",
      dayOfMonth: 20,
      endDate: date("2026-03-15"),
      account: main,
      accountId: main.id,
      sortOrder: 2,
    });
    const previousShiftOut = recurringItem({
      id: "previous-shift-out",
      dayOfMonth: 3,
      startDate: date("2026-05-03"),
      dateShiftPolicy: "previous",
      account: main,
      accountId: main.id,
      sortOrder: 3,
    });
    const nextShiftOut = recurringItem({
      id: "next-shift-out",
      dayOfMonth: 31,
      endDate: date("2026-05-31"),
      dateShiftPolicy: "next",
      account: main,
      accountId: main.id,
      sortOrder: 4,
    });

    const result = buildDashboard({
      accounts: [main],
      recurringItems: [startDateBoundary, endDateBoundary, previousShiftOut, nextShiftOut],
      today: "2026-02-01",
      forecastMonths: 5,
    });
    const ids = result.forecast.map((event) => event.id);

    expect(ids).not.toContain("recurring:start-date-boundary:2026-03");
    expect(ids).toContain("recurring:start-date-boundary:2026-04");
    expect(ids).toContain("recurring:end-date-boundary:2026-02");
    expect(ids).not.toContain("recurring:end-date-boundary:2026-03");
    expect(ids).not.toContain("recurring:previous-shift-out:2026-05");
    expect(ids).not.toContain("recurring:next-shift-out:2026-05");
  });

  it("uses actual credit card billing for monthOffset=0 and assumptions from monthOffset>=1 when actuals are lower", () => {
    const main = account({ balance: 100000 });
    const card = creditCard({
      id: "future-card",
      name: "Future Card",
      settlementDay: 10,
      assumptionAmount: 15000,
      account: main,
      accountId: main.id,
    });

    const result = buildDashboard({
      accounts: [main],
      creditCards: [card],
      billings: [
        billing({
          yearMonth: "2026-03",
          items: [billingItem({ billingId: "billing-2026-03", creditCardId: card.id, amount: 5000 })],
        }),
        billing({
          yearMonth: "2026-04",
          items: [billingItem({ billingId: "billing-2026-04", creditCardId: card.id, amount: 5000 })],
        }),
      ],
      today: "2026-03-01",
      forecastMonths: 2,
    });

    expect(forecastEvent(result, "credit-card:future-card:2026-03")).toMatchObject({
      amount: 5000,
      description: "Future Card 引き落とし (2026-03)",
    });
    expect(forecastEvent(result, "credit-card:future-card:2026-04")).toMatchObject({
      amount: 15000,
      description: "Future Card 仮定値 (2026-04)",
    });
  });

  it("excludes forecast events that already have confirmed transactions", () => {
    const main = account({ balance: 1000 });
    const item = recurringItem({
      id: "confirmed",
      dayOfMonth: 10,
      account: main,
      accountId: main.id,
    });

    const result = buildDashboard({
      accounts: [main],
      recurringItems: [item],
      confirmedTransactions: [{ forecastEventId: "recurring:confirmed:2026-03", amount: 100 }],
      today: "2026-03-01",
      forecastMonths: 1,
    });

    expect(result.forecast.map((event) => event.id)).not.toContain("recurring:confirmed:2026-03");
    expect(result.overdueForecast.map((event) => event.id)).not.toContain("recurring:confirmed:2026-03");
  });

  it("splits events before today into overdueForecast and keeps today or later in forecast", () => {
    const main = account({ balance: 1000 });
    const past = recurringItem({
      id: "past",
      dayOfMonth: 10,
      amount: 100,
      account: main,
      accountId: main.id,
      sortOrder: 1,
    });
    const today = recurringItem({
      id: "today",
      type: "income",
      dayOfMonth: 20,
      amount: 300,
      account: main,
      accountId: main.id,
      sortOrder: 2,
    });
    const future = recurringItem({
      id: "future",
      dayOfMonth: 25,
      amount: 50,
      account: main,
      accountId: main.id,
      sortOrder: 3,
    });

    const result = buildDashboard({
      accounts: [main],
      recurringItems: [past, today, future],
      today: "2026-03-20",
      forecastMonths: 1,
    });

    expect(result.overdueForecast).toEqual([
      expect.objectContaining({ id: "recurring:past:2026-03", balance: 900 }),
    ]);
    expect(result.forecast).toEqual([
      expect.objectContaining({ id: "recurring:today:2026-03", balance: 1300 }),
      expect.objectContaining({ id: "recurring:future:2026-03", balance: 1250 }),
    ]);
  });

  it("converts multi-currency balances and events to JPY with rounding", () => {
    const jpy = account({ id: "jpy", name: "JPY", balance: 1000, sortOrder: 1 });
    const usd = account({
      id: "usd",
      name: "USD",
      balance: 12345,
      currencyCode: "USD",
      exchangeRateToJpy: 149.5,
      sortOrder: 2,
    });
    const usdExpense = recurringItem({
      id: "usd-expense",
      amount: 101,
      dayOfMonth: 10,
      account: usd,
      accountId: usd.id,
    });

    const result = buildDashboard({
      accounts: [jpy, usd],
      recurringItems: [usdExpense],
      today: "2026-03-01",
      forecastMonths: 1,
    });

    expect(result.totalBalance).toBe(19456);
    expect(result.forecast).toEqual([
      expect.objectContaining({
        id: "recurring:usd-expense:2026-03",
        amountJpy: 151,
        balance: 19305,
        balanceJpy: 19305,
        currencyCode: "USD",
      }),
    ]);
    expect(result.accountForecasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: "usd",
          currentBalanceJpy: 18456,
          minBalance: 12244,
          minBalanceJpy: 18305,
        }),
      ]),
    );
  });

  it("changes totalBalance and account minBalance when applyOffset is toggled", () => {
    const main = account({ balance: 1000, balanceOffset: 400 });
    const item = recurringItem({
      id: "large-expense",
      amount: 800,
      dayOfMonth: 10,
      account: main,
      accountId: main.id,
    });

    const withOffset = buildDashboard({
      accounts: [main],
      recurringItems: [item],
      today: "2026-03-01",
      forecastMonths: 1,
      applyOffset: true,
    });
    const withoutOffset = buildDashboard({
      accounts: [main],
      recurringItems: [item],
      today: "2026-03-01",
      forecastMonths: 1,
      applyOffset: false,
    });

    expect(withOffset.totalBalance).toBe(600);
    expect(withOffset.accountForecasts[0]?.minBalance).toBe(-200);
    expect(withoutOffset.totalBalance).toBe(1000);
    expect(withoutOffset.accountForecasts[0]?.minBalance).toBe(200);
  });

  it("builds recurring forecasts that start on leap day", () => {
    const main = account({ balance: 1000 });
    const leapDayItem = recurringItem({
      id: "leap-day",
      type: "income",
      amount: 100,
      dayOfMonth: 29,
      startDate: date("2024-02-29"),
      account: main,
      accountId: main.id,
    });

    const result = buildDashboard({
      accounts: [main],
      recurringItems: [leapDayItem],
      today: "2024-02-01",
      forecastMonths: 13,
    });

    expect(forecastEvent(result, "recurring:leap-day:2024-02")).toMatchObject({
      date: "2024-02-29",
    });
    expect(forecastEvent(result, "recurring:leap-day:2025-02")).toMatchObject({
      date: "2025-02-28",
    });
  });

  it("keeps loan forecasts available through the pure core", () => {
    const main = account({ balance: 1000 });
    const item = loan({
      id: "loan-core",
      name: "Core Loan",
      totalAmount: 600,
      paymentCount: 2,
      startDate: date("2026-03-18"),
      account: main,
      accountId: main.id,
    });

    const result = buildDashboard({
      accounts: [main],
      loans: [item],
      today: "2026-03-01",
      forecastMonths: 2,
    });

    expect(result.forecast).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "loan:loan-core:2026-03",
          amount: 300,
          description: "ローン: Core Loan",
        }),
        expect.objectContaining({
          id: "loan:loan-core:2026-04",
          amount: 300,
          description: "ローン: Core Loan",
        }),
      ]),
    );
  });
});
