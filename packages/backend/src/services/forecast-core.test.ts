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
  const linkedTransferToAccount = overrides.transferToAccount ?? null;
  return {
    id: "recurring-1",
    name: "Recurring",
    type: "expense" as RecurringItemType,
    amount: 100,
    recurrence: "monthly",
    interval: 1,
    dayOfMonth: 1,
    dayOfWeek: null,
    accountId: linkedAccount?.id ?? null,
    transferToAccountId: linkedTransferToAccount?.id ?? null,
    enabled: true,
    startDate: null,
    endDate: null,
    dateShiftPolicy: "none" as DateShiftPolicy,
    sortOrder: 0,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    account: linkedAccount,
    transferToAccount: linkedTransferToAccount,
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
      source: "credit-card",
      isAssumption: false,
      description: "Future Card 引き落とし (2026-03)",
    });
    expect(forecastEvent(result, "credit-card:future-card:2026-04")).toMatchObject({
      amount: 15000,
      source: "credit-card",
      isAssumption: true,
      description: "Future Card 仮定値 (2026-04)",
    });
  });

  it("assigns forecast event sources without parsing descriptions", () => {
    const source = account({ id: "source", name: "Source", balance: 1000, sortOrder: 1 });
    const destination = account({ id: "destination", name: "Destination", balance: 1000, sortOrder: 2 });
    const recurring = recurringItem({
      id: "plain-recurring",
      name: "Card-like text but recurring",
      dayOfMonth: 10,
      account: source,
      accountId: source.id,
      sortOrder: 1,
    });
    const transfer = recurringItem({
      id: "transfer-recurring",
      name: "Monthly Move",
      type: "transfer" as RecurringItemType,
      dayOfMonth: 11,
      account: source,
      accountId: source.id,
      transferToAccount: destination,
      transferToAccountId: destination.id,
      sortOrder: 2,
    });
    const card = creditCard({
      id: "assumption-card",
      name: "Assumption Card",
      settlementDay: 12,
      assumptionAmount: 500,
      account: source,
      accountId: source.id,
      sortOrder: 3,
    });
    const loanItem = loan({
      id: "loan-source",
      startDate: date("2026-03-13"),
      totalAmount: 600,
      paymentCount: 1,
      account: source,
      accountId: source.id,
    });

    const result = buildDashboard({
      accounts: [source, destination],
      recurringItems: [recurring, transfer],
      creditCards: [card],
      loans: [loanItem],
      today: "2026-03-01",
      forecastMonths: 1,
    });

    expect(forecastEvent(result, "recurring:plain-recurring:2026-03")).toMatchObject({
      source: "recurring",
      isAssumption: false,
    });
    expect(forecastEvent(result, "recurring:transfer-recurring:2026-03")).toMatchObject({
      source: "transfer",
      isAssumption: false,
    });
    expect(forecastEvent(result, "credit-card:assumption-card:2026-03")).toMatchObject({
      source: "credit-card",
      isAssumption: true,
    });
    expect(forecastEvent(result, "loan:loan-source:2026-03")).toMatchObject({
      source: "loan",
      isAssumption: false,
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

  it("keeps recurring transfers neutral in total forecast and applies them to account forecasts", () => {
    const source = account({ id: "source", name: "Source", balance: 500, sortOrder: 1 });
    const destination = account({ id: "destination", name: "Destination", balance: 100, sortOrder: 2 });
    const transfer = recurringItem({
      id: "monthly-transfer",
      name: "Monthly Transfer",
      type: "transfer" as RecurringItemType,
      amount: 200,
      dayOfMonth: 10,
      account: source,
      accountId: source.id,
      transferToAccount: destination,
      transferToAccountId: destination.id,
    });

    const result = buildDashboard({
      accounts: [source, destination],
      recurringItems: [transfer],
      today: "2026-03-01",
      forecastMonths: 1,
    });

    expect(result.totalBalance).toBe(600);
    expect(result.minBalance).toBe(600);
    expect(result.nextIncome).toBeNull();
    expect(result.nextExpense).toBeNull();
    expect(result.forecast).toEqual([
      expect.objectContaining({
        id: "recurring:monthly-transfer:2026-03",
        type: "transfer",
        balance: 600,
        accountId: source.id,
        transferToAccountId: destination.id,
      }),
    ]);
    expect(result.accountForecasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: source.id,
          minBalance: 300,
          events: [
            expect.objectContaining({
              id: "recurring:monthly-transfer:2026-03",
              type: "transfer",
              balance: 300,
              accountId: source.id,
              transferToAccountId: destination.id,
            }),
          ],
        }),
        expect.objectContaining({
          accountId: destination.id,
          minBalance: 100,
          events: [
            expect.objectContaining({
              id: "recurring:monthly-transfer:2026-03",
              type: "transfer",
              balance: 300,
              accountId: source.id,
              transferToAccountId: destination.id,
            }),
          ],
        }),
      ]),
    );
  });

  it("treats source-only transfers as external outflows", () => {
    const source = account({ id: "source", name: "Source", balance: 500, sortOrder: 1 });
    const transfer = recurringItem({
      id: "source-only-transfer",
      name: "External Out",
      type: "transfer" as RecurringItemType,
      amount: 200,
      dayOfMonth: 10,
      account: source,
      accountId: source.id,
      transferToAccount: null,
      transferToAccountId: null,
    });

    const result = buildDashboard({
      accounts: [source],
      recurringItems: [transfer],
      today: "2026-03-01",
      forecastMonths: 1,
    });

    expect(result.totalBalance).toBe(500);
    expect(result.minBalance).toBe(300);
    expect(result.forecast).toEqual([
      expect.objectContaining({
        id: "recurring:source-only-transfer:2026-03",
        type: "transfer",
        balance: 300,
        accountId: source.id,
        transferToAccountId: null,
      }),
    ]);
    expect(result.accountForecasts).toEqual([
      expect.objectContaining({
        accountId: source.id,
        minBalance: 300,
        events: [
          expect.objectContaining({
            id: "recurring:source-only-transfer:2026-03",
            balance: 300,
          }),
        ],
      }),
    ]);
  });

  it("treats destination-only transfers as external inflows", () => {
    const destination = account({ id: "destination", name: "Destination", balance: 100, sortOrder: 1 });
    const transfer = recurringItem({
      id: "destination-only-transfer",
      name: "External In",
      type: "transfer" as RecurringItemType,
      amount: 200,
      dayOfMonth: 10,
      account: null,
      accountId: null,
      transferToAccount: destination,
      transferToAccountId: destination.id,
    });

    const result = buildDashboard({
      accounts: [destination],
      recurringItems: [transfer],
      today: "2026-03-01",
      forecastMonths: 1,
    });

    expect(result.totalBalance).toBe(100);
    expect(result.minBalance).toBe(100);
    expect(result.forecast).toEqual([
      expect.objectContaining({
        id: "recurring:destination-only-transfer:2026-03",
        type: "transfer",
        balance: 300,
        accountId: null,
        transferToAccountId: destination.id,
      }),
    ]);
    expect(result.accountForecasts).toEqual([
      expect.objectContaining({
        accountId: destination.id,
        minBalance: 100,
        events: [
          expect.objectContaining({
            id: "recurring:destination-only-transfer:2026-03",
            balance: 300,
          }),
        ],
      }),
    ]);
  });

  it("handles one-sided transfer overdue forecast events", () => {
    const source = account({ id: "source", name: "Source", balance: 500, sortOrder: 1 });
    const destination = account({ id: "destination", name: "Destination", balance: 100, sortOrder: 2 });
    const sourceOnly = recurringItem({
      id: "overdue-source-only",
      name: "Overdue Out",
      type: "transfer" as RecurringItemType,
      amount: 50,
      dayOfMonth: 10,
      account: source,
      accountId: source.id,
      transferToAccount: null,
      transferToAccountId: null,
    });
    const destinationOnly = recurringItem({
      id: "overdue-destination-only",
      name: "Overdue In",
      type: "transfer" as RecurringItemType,
      amount: 30,
      dayOfMonth: 15,
      account: null,
      accountId: null,
      transferToAccount: destination,
      transferToAccountId: destination.id,
    });

    const result = buildDashboard({
      accounts: [source, destination],
      recurringItems: [sourceOnly, destinationOnly],
      today: "2026-03-20",
      forecastMonths: 1,
    });

    expect(result.overdueForecast).toEqual([
      expect.objectContaining({
        id: "recurring:overdue-source-only:2026-03",
        balance: 550,
      }),
      expect.objectContaining({
        id: "recurring:overdue-destination-only:2026-03",
        balance: 580,
      }),
    ]);
    expect(result.forecast).toHaveLength(0);
  });

  it("excludes recurring transfer forecast events that already have confirmed transactions", () => {
    const source = account({ id: "source", name: "Source", balance: 500, sortOrder: 1 });
    const destination = account({ id: "destination", name: "Destination", balance: 100, sortOrder: 2 });
    const transfer = recurringItem({
      id: "confirmed-transfer",
      type: "transfer" as RecurringItemType,
      amount: 200,
      dayOfMonth: 10,
      account: source,
      accountId: source.id,
      transferToAccount: destination,
      transferToAccountId: destination.id,
    });

    const result = buildDashboard({
      accounts: [source, destination],
      recurringItems: [transfer],
      confirmedTransactions: [{ forecastEventId: "recurring:confirmed-transfer:2026-03", amount: 200 }],
      today: "2026-03-01",
      forecastMonths: 1,
    });

    expect(result.forecast.map((event) => event.id)).not.toContain("recurring:confirmed-transfer:2026-03");
    expect(result.accountForecasts.flatMap((forecast) => forecast.events.map((event) => event.id))).not.toContain(
      "recurring:confirmed-transfer:2026-03",
    );
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

  it("creates weekly recurring events for each matching weekday in the month", () => {
    const main = account({ balance: 1000 });
    const item = recurringItem({
      id: "weekly",
      name: "Weekly",
      recurrence: "weekly",
      dayOfMonth: null,
      dayOfWeek: 5,
      account: main,
      accountId: main.id,
    });

    const result = buildDashboard({
      accounts: [main],
      recurringItems: [item],
      today: "2026-01-01",
      forecastMonths: 1,
    });

    const ids = result.forecast.map((event) => event.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "recurring:weekly:2026-01-02",
        "recurring:weekly:2026-01-09",
        "recurring:weekly:2026-01-16",
        "recurring:weekly:2026-01-23",
        "recurring:weekly:2026-01-30",
      ]),
    );
  });

  it("honors start/end dates for weekly recurring items", () => {
    const main = account({ balance: 1000 });
    const item = recurringItem({
      id: "weekly-range",
      name: "Weekly Range",
      recurrence: "weekly",
      dayOfMonth: null,
      dayOfWeek: 0,
      startDate: date("2026-02-15"),
      endDate: date("2026-02-22"),
      account: main,
      accountId: main.id,
    });

    const result = buildDashboard({
      accounts: [main],
      recurringItems: [item],
      today: "2026-02-01",
      forecastMonths: 1,
    });

    const ids = result.forecast.map((event) => event.id);
    expect(ids).toContain("recurring:weekly-range:2026-02-15");
    expect(ids).toContain("recurring:weekly-range:2026-02-22");
    expect(ids).not.toContain("recurring:weekly-range:2026-02-08");
    expect(ids).not.toContain("recurring:weekly-range:2026-03-01");
  });

  it("creates 4 or 5 weekly events depending on the month", () => {
    const main = account({ balance: 1000 });
    const item = recurringItem({
      id: "weekly-count",
      name: "Weekly Count",
      recurrence: "weekly",
      dayOfMonth: null,
      dayOfWeek: 5,
      account: main,
      accountId: main.id,
    });

    const january = buildDashboard({
      accounts: [main],
      recurringItems: [item],
      today: "2026-01-01",
      forecastMonths: 1,
    });
    const february = buildDashboard({
      accounts: [main],
      recurringItems: [item],
      today: "2026-02-01",
      forecastMonths: 1,
    });

    expect(january.forecast).toHaveLength(5);
    expect(february.forecast).toHaveLength(4);
    expect(january.forecast.every((event) => event.id.startsWith("recurring:weekly-count:"))).toBe(true);
  });

  it("supports weekly income, expense, and transfer recurring items", () => {
    const source = account({ id: "source", name: "Source", balance: 1000, sortOrder: 1 });
    const destination = account({ id: "destination", name: "Destination", balance: 0, sortOrder: 2 });
    const income = recurringItem({
      id: "weekly-income",
      name: "Weekly Income",
      type: "income",
      recurrence: "weekly",
      dayOfMonth: null,
      dayOfWeek: 5,
      amount: 100,
      account: source,
      accountId: source.id,
      sortOrder: 1,
    });
    const expense = recurringItem({
      id: "weekly-expense",
      name: "Weekly Expense",
      type: "expense",
      recurrence: "weekly",
      dayOfMonth: null,
      dayOfWeek: 5,
      amount: 200,
      account: source,
      accountId: source.id,
      sortOrder: 2,
    });
    const transfer = recurringItem({
      id: "weekly-transfer",
      name: "Weekly Transfer",
      type: "transfer",
      recurrence: "weekly",
      dayOfMonth: null,
      dayOfWeek: 5,
      amount: 50,
      account: source,
      accountId: source.id,
      transferToAccount: destination,
      transferToAccountId: destination.id,
      sortOrder: 3,
    });

    const result = buildDashboard({
      accounts: [source, destination],
      recurringItems: [income, expense, transfer],
      today: "2026-01-01",
      forecastMonths: 1,
    });

    expect(result.totalBalance).toBe(1000);
    expect(result.minBalance).toBe(500);
    expect(result.forecast.map((event) => event.id)).toEqual(
      expect.arrayContaining([
        "recurring:weekly-income:2026-01-02",
        "recurring:weekly-expense:2026-01-02",
        "recurring:weekly-transfer:2026-01-02",
        "recurring:weekly-income:2026-01-30",
        "recurring:weekly-expense:2026-01-30",
        "recurring:weekly-transfer:2026-01-30",
      ]),
    );
  });

  it("uses base date as the unique event id for weekly events and excludes one confirmed instance", () => {
    const main = account({ balance: 1000 });
    const item = recurringItem({
      id: "weekly-confirm",
      name: "Weekly Confirm",
      recurrence: "weekly",
      dayOfMonth: null,
      dayOfWeek: 5,
      account: main,
      accountId: main.id,
    });

    const result = buildDashboard({
      accounts: [main],
      recurringItems: [item],
      confirmedTransactions: [{ forecastEventId: "recurring:weekly-confirm:2026-01-09", amount: 100 }],
      today: "2026-01-01",
      forecastMonths: 1,
    });

    const ids = result.forecast.map((event) => event.id);
    expect(ids).not.toContain("recurring:weekly-confirm:2026-01-09");
    expect(ids).toContain("recurring:weekly-confirm:2026-01-02");
    expect(ids).toContain("recurring:weekly-confirm:2026-01-16");
    expect(ids).toContain("recurring:weekly-confirm:2026-01-23");
    expect(ids).toContain("recurring:weekly-confirm:2026-01-30");
  });

  it("honors start and end dates for weekly events after business-day shifts", () => {
    const main = account({ balance: 1000 });
    const item = recurringItem({
      id: "weekly-shift-range",
      name: "Weekly Shift Range",
      recurrence: "weekly",
      dayOfMonth: null,
      dayOfWeek: 0,
      dateShiftPolicy: "previous",
      startDate: date("2026-05-03"),
      endDate: date("2026-05-31"),
      account: main,
      accountId: main.id,
    });

    const result = buildDashboard({
      accounts: [main],
      recurringItems: [item],
      today: "2026-05-01",
      forecastMonths: 1,
    });

    const ids = result.forecast.map((event) => event.id);
    expect(ids).not.toContain("recurring:weekly-shift-range:2026-05-03");
    expect(ids).toContain("recurring:weekly-shift-range:2026-05-10");
    expect(ids).toContain("recurring:weekly-shift-range:2026-05-17");
    expect(ids).toContain("recurring:weekly-shift-range:2026-05-24");
    expect(ids).toContain("recurring:weekly-shift-range:2026-05-31");
  });

  it("includes weekly events shifted from the next month into the current month", () => {
    const main = account({ balance: 1000 });
    const item = recurringItem({
      id: "weekly-prev-boundary",
      name: "Weekly Previous Boundary",
      recurrence: "weekly",
      dayOfMonth: null,
      dayOfWeek: 0,
      dateShiftPolicy: "previous",
      account: main,
      accountId: main.id,
    });

    const result = buildDashboard({
      accounts: [main],
      recurringItems: [item],
      today: "2026-10-01",
      forecastMonths: 2,
    });

    const event = forecastEvent(result, "recurring:weekly-prev-boundary:2026-11-01");
    expect(event.date).toBe("2026-10-30");
    const ids = result.forecast.map((e) => e.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "recurring:weekly-prev-boundary:2026-10-04",
        "recurring:weekly-prev-boundary:2026-10-11",
        "recurring:weekly-prev-boundary:2026-10-18",
        "recurring:weekly-prev-boundary:2026-10-25",
        "recurring:weekly-prev-boundary:2026-11-01",
      ]),
    );
    expect(ids).toHaveLength(9);
  });

  it("includes weekly events shifted from the current month into the next month", () => {
    const main = account({ balance: 1000 });
    const item = recurringItem({
      id: "weekly-next-boundary",
      name: "Weekly Next Boundary",
      recurrence: "weekly",
      dayOfMonth: null,
      dayOfWeek: 0,
      dateShiftPolicy: "next",
      account: main,
      accountId: main.id,
    });

    const result = buildDashboard({
      accounts: [main],
      recurringItems: [item],
      today: "2026-05-01",
      forecastMonths: 2,
    });

    const event = forecastEvent(result, "recurring:weekly-next-boundary:2026-05-31");
    expect(event.date).toBe("2026-06-01");
    const ids = result.forecast.map((e) => e.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "recurring:weekly-next-boundary:2026-05-03",
        "recurring:weekly-next-boundary:2026-05-10",
        "recurring:weekly-next-boundary:2026-05-17",
        "recurring:weekly-next-boundary:2026-05-24",
        "recurring:weekly-next-boundary:2026-05-31",
        "recurring:weekly-next-boundary:2026-06-07",
      ]),
    );
    expect(ids).toHaveLength(9);
  });

  it("handles USD transfer source-only as external outflow in raw currency and JPY", () => {
    const usd = account({
      id: "usd",
      name: "USD",
      balance: 100000,
      currencyCode: "USD",
      exchangeRateToJpy: 150,
      sortOrder: 1,
    });
    const transfer = recurringItem({
      id: "usd-source-only-transfer",
      name: "External Out",
      type: "transfer" as RecurringItemType,
      amount: 50000,
      dayOfMonth: 10,
      account: usd,
      accountId: usd.id,
      transferToAccount: null,
      transferToAccountId: null,
    });

    const result = buildDashboard({
      accounts: [usd],
      recurringItems: [transfer],
      today: "2026-03-01",
      forecastMonths: 1,
    });

    expect(result.totalBalance).toBe(150000);
    expect(result.minBalance).toBe(75000);
    expect(result.forecast).toEqual([
      expect.objectContaining({
        id: "recurring:usd-source-only-transfer:2026-03",
        type: "transfer",
        amount: 50000,
        amountJpy: 75000,
        balance: 75000,
        currencyCode: "USD",
        accountId: usd.id,
        transferToAccountId: null,
      }),
    ]);
    expect(result.accountForecasts).toEqual([
      expect.objectContaining({
        accountId: usd.id,
        currentBalance: 100000,
        currentBalanceJpy: 150000,
        minBalance: 50000,
        minBalanceJpy: 75000,
        events: [
          expect.objectContaining({
            id: "recurring:usd-source-only-transfer:2026-03",
            amount: 50000,
            amountJpy: 75000,
            balance: 50000,
            balanceJpy: 75000,
            currencyCode: "USD",
          }),
        ],
      }),
    ]);
  });

  it("handles USD transfer destination-only as external inflow in raw currency and JPY", () => {
    const usd = account({
      id: "usd",
      name: "USD",
      balance: 100000,
      currencyCode: "USD",
      exchangeRateToJpy: 150,
      sortOrder: 1,
    });
    const transfer = recurringItem({
      id: "usd-destination-only-transfer",
      name: "External In",
      type: "transfer" as RecurringItemType,
      amount: 50000,
      dayOfMonth: 10,
      account: null,
      accountId: null,
      transferToAccount: usd,
      transferToAccountId: usd.id,
    });

    const result = buildDashboard({
      accounts: [usd],
      recurringItems: [transfer],
      today: "2026-03-01",
      forecastMonths: 1,
    });

    expect(result.totalBalance).toBe(150000);
    expect(result.minBalance).toBe(150000);
    expect(result.forecast).toEqual([
      expect.objectContaining({
        id: "recurring:usd-destination-only-transfer:2026-03",
        type: "transfer",
        amount: 50000,
        amountJpy: 75000,
        balance: 225000,
        currencyCode: "USD",
        accountId: null,
        transferToAccountId: usd.id,
      }),
    ]);
    expect(result.accountForecasts).toEqual([
      expect.objectContaining({
        accountId: usd.id,
        currentBalance: 100000,
        currentBalanceJpy: 150000,
        minBalance: 100000,
        minBalanceJpy: 150000,
        events: [
          expect.objectContaining({
            id: "recurring:usd-destination-only-transfer:2026-03",
            amount: 50000,
            amountJpy: 75000,
            balance: 150000,
            balanceJpy: 225000,
            currencyCode: "USD",
          }),
        ],
      }),
    ]);
  });

  it("handles USD two-sided transfer as neutral total and currency-matched account balances", () => {
    const usdSource = account({
      id: "usd-source",
      name: "USD Source",
      balance: 100000,
      currencyCode: "USD",
      exchangeRateToJpy: 150,
      sortOrder: 1,
    });
    const usdDestination = account({
      id: "usd-destination",
      name: "USD Destination",
      balance: 50000,
      currencyCode: "USD",
      exchangeRateToJpy: 150,
      sortOrder: 2,
    });
    const transfer = recurringItem({
      id: "usd-two-sided-transfer",
      name: "USD Move",
      type: "transfer" as RecurringItemType,
      amount: 30000,
      dayOfMonth: 10,
      account: usdSource,
      accountId: usdSource.id,
      transferToAccount: usdDestination,
      transferToAccountId: usdDestination.id,
    });

    const result = buildDashboard({
      accounts: [usdSource, usdDestination],
      recurringItems: [transfer],
      today: "2026-03-01",
      forecastMonths: 1,
    });

    expect(result.totalBalance).toBe(225000);
    expect(result.minBalance).toBe(225000);
    expect(result.forecast).toEqual([
      expect.objectContaining({
        id: "recurring:usd-two-sided-transfer:2026-03",
        type: "transfer",
        amount: 30000,
        amountJpy: 45000,
        balance: 225000,
        currencyCode: "USD",
        accountId: usdSource.id,
        transferToAccountId: usdDestination.id,
      }),
    ]);
    expect(result.accountForecasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: usdSource.id,
          currentBalance: 100000,
          currentBalanceJpy: 150000,
          minBalance: 70000,
          minBalanceJpy: 105000,
          events: [
            expect.objectContaining({
              id: "recurring:usd-two-sided-transfer:2026-03",
              amount: 30000,
              amountJpy: 45000,
              balance: 70000,
              balanceJpy: 105000,
              currencyCode: "USD",
            }),
          ],
        }),
        expect.objectContaining({
          accountId: usdDestination.id,
          currentBalance: 50000,
          currentBalanceJpy: 75000,
          minBalance: 50000,
          minBalanceJpy: 75000,
          events: [
            expect.objectContaining({
              id: "recurring:usd-two-sided-transfer:2026-03",
              amount: 30000,
              amountJpy: 45000,
              balance: 80000,
              balanceJpy: 120000,
              currencyCode: "USD",
            }),
          ],
        }),
      ]),
    );
  });

  it("handles USD normal recurring expense with amount and amountJpy separated", () => {
    const usd = account({
      id: "usd",
      name: "USD",
      balance: 100000,
      currencyCode: "USD",
      exchangeRateToJpy: 150,
      sortOrder: 1,
    });
    const expense = recurringItem({
      id: "usd-normal-expense",
      name: "USD Rent",
      amount: 25000,
      dayOfMonth: 10,
      account: usd,
      accountId: usd.id,
    });

    const result = buildDashboard({
      accounts: [usd],
      recurringItems: [expense],
      today: "2026-03-01",
      forecastMonths: 1,
    });

    expect(result.totalBalance).toBe(150000);
    expect(result.minBalance).toBe(112500);
    expect(result.forecast).toEqual([
      expect.objectContaining({
        id: "recurring:usd-normal-expense:2026-03",
        amount: 25000,
        amountJpy: 37500,
        balance: 112500,
        balanceJpy: 112500,
        currencyCode: "USD",
      }),
    ]);
    expect(result.accountForecasts).toEqual([
      expect.objectContaining({
        accountId: usd.id,
        currentBalance: 100000,
        currentBalanceJpy: 150000,
        minBalance: 75000,
        minBalanceJpy: 112500,
        events: [
          expect.objectContaining({
            id: "recurring:usd-normal-expense:2026-03",
            amount: 25000,
            amountJpy: 37500,
            balance: 75000,
            balanceJpy: 112500,
            currencyCode: "USD",
          }),
        ],
      }),
    ]);
  });
});
