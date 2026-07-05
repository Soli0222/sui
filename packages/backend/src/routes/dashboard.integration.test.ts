import { describe, expect, it, vi } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import {
  createAccount,
  createBilling,
  createCreditCard,
  createLoan,
  createRecurringItem,
  createTransaction,
} from "../test-helpers/fixtures";
import { testPrisma } from "../test-helpers/db";

const client = createTestClient();

describe("dashboard routes", () => {
  it("returns zero balances and an empty forecast when there are no accounts", async () => {
    const response = await client.get("/api/dashboard");

    expect(response.status).toBe(200);
    expect(await parseJson(response)).toMatchObject({
      totalBalance: 0,
      minBalance: 0,
      forecast: [],
      accountForecasts: [],
      nextIncome: null,
      nextExpense: null,
    });
  });

  it("returns event-only dashboard data for the requested forecast period", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 100000,
      sortOrder: 1,
    });
    const recurring = await createRecurringItem(testPrisma, {
      name: "Salary",
      type: "income",
      amount: 300000,
      dayOfMonth: 20,
      accountId: account.id,
      sortOrder: 1,
    });

    const response = await client.get("/api/dashboard/events?months=1");
    const body = await parseJson<{
      forecast: Array<{ id: string; date: string }>;
      accountForecasts: Array<{ accountId: string; accountName: string; events: Array<{ id: string }> }>;
    }>(response);

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty("totalBalance");
    expect(body.forecast).toEqual([
      expect.objectContaining({
        id: `recurring:${recurring.id}:2026-03`,
        date: "2026-03-20",
      }),
    ]);
    expect(body.accountForecasts).toEqual([
      expect.objectContaining({
        accountId: account.id,
        accountName: "Main",
        events: [expect.objectContaining({ id: `recurring:${recurring.id}:2026-03` })],
      }),
    ]);
  });

  it("builds forecast events from recurring items, billings, assumptions, and loans while excluding confirmed events", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 100000,
      sortOrder: 1,
    });
    const salary = await createRecurringItem(testPrisma, {
      name: "Salary",
      type: "income",
      amount: 300000,
      dayOfMonth: 20,
      accountId: account.id,
      sortOrder: 1,
    });
    const rent = await createRecurringItem(testPrisma, {
      name: "Rent",
      type: "expense",
      amount: 80000,
      dayOfMonth: 15,
      accountId: account.id,
      sortOrder: 2,
    });
    const actualCard = await createCreditCard(testPrisma, {
      name: "Actual Card",
      accountId: account.id,
      settlementDay: 27,
      assumptionAmount: 15000,
      sortOrder: 1,
    });
    const assumptionCard = await createCreditCard(testPrisma, {
      name: "Assumption Card",
      accountId: account.id,
      settlementDay: 28,
      assumptionAmount: 50000,
      sortOrder: 2,
    });
    await createBilling(testPrisma, {
      yearMonth: "2026-03",
      settlementDate: new Date("2026-03-27T00:00:00.000Z"),
      items: [{ creditCardId: actualCard.id, amount: 12345 }],
    });
    const loan = await createLoan(testPrisma, {
      name: "Laptop",
      accountId: account.id,
      totalAmount: 600,
      paymentCount: 2,
      startDate: new Date("2026-03-18T00:00:00.000Z"),
    });
    await createTransaction(testPrisma, {
      accountId: account.id,
      forecastEventId: `recurring:${rent.id}:2026-03`,
      date: new Date("2026-03-15T00:00:00.000Z"),
      type: "expense",
      description: "Rent",
      amount: 80000,
    });

    const response = await client.get("/api/dashboard");
    const body = await parseJson<{
      totalBalance: number;
      nextIncome: { id: string } | null;
      nextExpense: { id: string } | null;
      forecast: Array<{ id: string; amount: number; description: string }>;
      accountForecasts: Array<{ accountId: string; events: Array<{ id: string }> }>;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.totalBalance).toBe(100000);
    expect(body.nextIncome?.id).toBe(`recurring:${salary.id}:2026-03`);
    expect(body.nextExpense?.id).toBe(`loan:${loan.id}:2026-03`);
    expect(body.forecast).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `recurring:${salary.id}:2026-03`,
          amount: 300000,
          description: "Salary",
        }),
        expect.objectContaining({
          id: `credit-card:${actualCard.id}:2026-03`,
          amount: 12345,
          description: "Actual Card 引き落とし (2026-03)",
        }),
        expect.objectContaining({
          id: `credit-card:${assumptionCard.id}:2026-03`,
          amount: 50000,
          description: "Assumption Card 仮定値 (2026-03)",
        }),
        expect.objectContaining({
          id: `loan:${loan.id}:2026-03`,
          amount: 300,
          description: "ローン: Laptop",
        }),
      ]),
    );
    expect(body.forecast.some((event) => event.id === `recurring:${rent.id}:2026-03`)).toBe(false);
    expect(body.accountForecasts[0]?.accountId).toBe(account.id);
    expect(body.accountForecasts[0]?.events.some((event) => event.id === `recurring:${salary.id}:2026-03`)).toBe(
      true,
    );
  });

  it("builds and confirms recurring transfer forecast events", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const source = await createAccount(testPrisma, {
      name: "Source",
      balance: 100000,
      sortOrder: 1,
    });
    const destination = await createAccount(testPrisma, {
      name: "Destination",
      balance: 10000,
      sortOrder: 2,
    });
    const transfer = await createRecurringItem(testPrisma, {
      name: "Monthly Move",
      type: "transfer",
      amount: 30000,
      dayOfMonth: 20,
      accountId: source.id,
      transferToAccountId: destination.id,
      sortOrder: 1,
    });
    const forecastEventId = `recurring:${transfer.id}:2026-03`;

    const dashboard = await client.get("/api/dashboard");
    const body = await parseJson<{
      totalBalance: number;
      minBalance: number;
      forecast: Array<{
        id: string;
        type: string;
        balance: number;
        accountId: string | null;
        transferToAccountId: string | null;
      }>;
      accountForecasts: Array<{
        accountId: string;
        events: Array<{ id: string; type: string; balance: number; transferToAccountId: string | null }>;
      }>;
    }>(dashboard);

    expect(dashboard.status).toBe(200);
    expect(body.totalBalance).toBe(110000);
    expect(body.minBalance).toBe(110000);
    expect(body.forecast).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: forecastEventId,
        type: "transfer",
        balance: 110000,
        accountId: source.id,
        transferToAccountId: destination.id,
      }),
    ]));
    expect(body.accountForecasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: source.id,
          events: expect.arrayContaining([
            expect.objectContaining({ id: forecastEventId, type: "transfer", balance: 70000 }),
          ]),
        }),
        expect.objectContaining({
          accountId: destination.id,
          events: expect.arrayContaining([
            expect.objectContaining({ id: forecastEventId, type: "transfer", balance: 40000 }),
          ]),
        }),
      ]),
    );

    const confirm = await client.post("/api/dashboard/confirm", {
      forecastEventId,
      amount: 30000,
      accountId: destination.id,
    });

    expect(confirm.status).toBe(201);
    const savedTransaction = await testPrisma.transaction.findFirstOrThrow({
      where: { forecastEventId },
    });
    expect(savedTransaction).toMatchObject({
      accountId: source.id,
      transferToAccountId: destination.id,
      type: "transfer",
      amount: 30000,
    });

    const [savedSource, savedDestination] = await Promise.all([
      testPrisma.account.findUniqueOrThrow({ where: { id: source.id } }),
      testPrisma.account.findUniqueOrThrow({ where: { id: destination.id } }),
    ]);
    expect(savedSource.balance).toBe(70000);
    expect(savedDestination.balance).toBe(40000);

    const afterConfirm = await parseJson<{ forecast: Array<{ id: string }> }>(await client.get("/api/dashboard"));
    expect(afterConfirm.forecast.map((event) => event.id)).not.toContain(forecastEventId);
  });

  it("applies dateShiftPolicy to recurring items and credit cards without shifting manual card settlement dates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00.000Z"));

    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 100000,
      sortOrder: 1,
    });
    const shiftedRecurring = await createRecurringItem(testPrisma, {
      name: "Shifted Rent",
      type: "expense",
      amount: 80000,
      dayOfMonth: 3,
      dateShiftPolicy: "previous",
      accountId: account.id,
      sortOrder: 1,
    });
    const previousBoundary = await createRecurringItem(testPrisma, {
      name: "Boundary Start",
      type: "expense",
      amount: 1000,
      dayOfMonth: 3,
      startDate: new Date("2026-05-03T00:00:00.000Z"),
      dateShiftPolicy: "previous",
      accountId: account.id,
      sortOrder: 2,
    });
    const nextBoundary = await createRecurringItem(testPrisma, {
      name: "Boundary End",
      type: "expense",
      amount: 1000,
      dayOfMonth: 31,
      endDate: new Date("2026-05-31T00:00:00.000Z"),
      dateShiftPolicy: "next",
      accountId: account.id,
      sortOrder: 3,
    });
    const shiftedCard = await createCreditCard(testPrisma, {
      name: "Shifted Card",
      accountId: account.id,
      settlementDay: 3,
      assumptionAmount: 12000,
      dateShiftPolicy: "previous",
      sortOrder: 1,
    });
    const manualCard = await createCreditCard(testPrisma, {
      name: "Manual Card",
      accountId: account.id,
      settlementDay: 3,
      assumptionAmount: 15000,
      dateShiftPolicy: "previous",
      sortOrder: 2,
    });
    await createBilling(testPrisma, {
      yearMonth: "2026-06",
      settlementDate: new Date("2026-06-06T00:00:00.000Z"),
      items: [{ creditCardId: manualCard.id, amount: 15000 }],
    });

    const response = await client.get("/api/dashboard/events?months=2");
    const body = await parseJson<{ forecast: Array<{ id: string; date: string }> }>(response);

    expect(response.status).toBe(200);
    expect(body.forecast).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `recurring:${shiftedRecurring.id}:2026-05`,
          date: "2026-05-01",
        }),
        expect.objectContaining({
          id: `credit-card:${shiftedCard.id}:2026-05`,
          date: "2026-05-01",
        }),
        expect.objectContaining({
          id: `credit-card:${manualCard.id}:2026-06`,
          date: "2026-06-06",
        }),
      ]),
    );
    expect(body.forecast.some((event) => event.id === `recurring:${previousBoundary.id}:2026-05`)).toBe(false);
    expect(body.forecast.some((event) => event.id === `recurring:${nextBoundary.id}:2026-05`)).toBe(false);
  });

  it("does not auto-confirm recurring events shifted outside their active period", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-02T00:00:00.000Z"));

    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 100000,
      sortOrder: 1,
    });
    const recurring = await createRecurringItem(testPrisma, {
      name: "Boundary Start",
      type: "expense",
      amount: 1000,
      dayOfMonth: 3,
      startDate: new Date("2026-05-03T00:00:00.000Z"),
      dateShiftPolicy: "previous",
      accountId: account.id,
      sortOrder: 1,
    });

    const response = await client.get("/api/dashboard");
    const body = await parseJson<{ totalBalance: number; forecast: Array<{ id: string }> }>(response);

    expect(response.status).toBe(200);
    expect(body.totalBalance).toBe(100000);
    expect(body.forecast.some((event) => event.id === `recurring:${recurring.id}:2026-05`)).toBe(false);

    const transaction = await testPrisma.transaction.findUnique({
      where: { forecastEventId: `recurring:${recurring.id}:2026-05` },
    });
    expect(transaction).toBeNull();
  });

  it("applies account balance offsets only to dashboard balances", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 100000,
      balanceOffset: 40000,
      sortOrder: 1,
    });
    const recurring = await createRecurringItem(testPrisma, {
      name: "Salary",
      type: "income",
      amount: 30000,
      dayOfMonth: 20,
      accountId: account.id,
      sortOrder: 1,
    });

    const response = await client.get("/api/dashboard");
    const body = await parseJson<{
      totalBalance: number;
      minBalance: number;
      forecast: Array<{ id: string; balance: number }>;
      accountForecasts: Array<{ accountId: string; currentBalance: number; minBalance: number }>;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.totalBalance).toBe(60000);
    expect(body.minBalance).toBe(60000);
    expect(body.forecast).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `recurring:${recurring.id}:2026-03`,
          balance: 90000,
        }),
      ]),
    );
    expect(body.accountForecasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: account.id,
          currentBalance: 60000,
          minBalance: 60000,
        }),
      ]),
    );

    const savedAccount = await testPrisma.account.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(savedAccount.balance).toBe(100000);
    expect(savedAccount.balanceOffset).toBe(40000);
  });

  it("converts foreign-currency account balances and forecast events to JPY for dashboard totals", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const jpyAccount = await createAccount(testPrisma, {
      name: "JPY Main",
      balance: 50000,
      sortOrder: 1,
    });
    const usdAccount = await createAccount(testPrisma, {
      name: "USD Wallet",
      balance: 100000,
      balanceOffset: 1000,
      currencyCode: "USD",
      exchangeRateToJpy: 150,
      sortOrder: 2,
    });
    const usdExpense = await createRecurringItem(testPrisma, {
      name: "USD Rent",
      type: "expense",
      amount: 2500,
      dayOfMonth: 20,
      startDate: new Date("2026-03-01T00:00:00.000Z"),
      endDate: new Date("2026-03-31T00:00:00.000Z"),
      accountId: usdAccount.id,
      sortOrder: 1,
    });
    const jpyIncome = await createRecurringItem(testPrisma, {
      name: "JPY Salary",
      type: "income",
      amount: 10000,
      dayOfMonth: 21,
      startDate: new Date("2026-03-01T00:00:00.000Z"),
      endDate: new Date("2026-03-31T00:00:00.000Z"),
      accountId: jpyAccount.id,
      sortOrder: 2,
    });

    const response = await client.get("/api/dashboard");
    const body = await parseJson<{
      totalBalance: number;
      minBalance: number;
      forecast: Array<{
        id: string;
        amount: number;
        amountJpy: number;
        balance: number;
        balanceJpy: number;
        currencyCode: string;
      }>;
      accountForecasts: Array<{
        accountId: string;
        currencyCode: string;
        currentBalance: number;
        currentBalanceJpy: number;
        minBalance: number;
        minBalanceJpy: number;
        events: Array<{
          id: string;
          amount: number;
          amountJpy: number;
          balance: number;
          balanceJpy: number;
          currencyCode: string;
        }>;
      }>;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.totalBalance).toBe(198500);
    expect(body.minBalance).toBe(194750);
    expect(body.forecast).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `recurring:${usdExpense.id}:2026-03`,
          amount: 2500,
          amountJpy: 3750,
          balance: 194750,
          balanceJpy: 194750,
          currencyCode: "USD",
        }),
        expect.objectContaining({
          id: `recurring:${jpyIncome.id}:2026-03`,
          amount: 10000,
          amountJpy: 10000,
          balance: 204750,
          balanceJpy: 204750,
          currencyCode: "JPY",
        }),
      ]),
    );
    expect(body.accountForecasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: usdAccount.id,
          currencyCode: "USD",
          currentBalance: 99000,
          currentBalanceJpy: 148500,
          minBalance: 96500,
          minBalanceJpy: 144750,
          events: [
            expect.objectContaining({
              id: `recurring:${usdExpense.id}:2026-03`,
              amount: 2500,
              amountJpy: 3750,
              balance: 96500,
              balanceJpy: 144750,
              currencyCode: "USD",
            }),
          ],
        }),
      ]),
    );
  });

  it("can disable account balance offsets for dashboard balances", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 100000,
      balanceOffset: 40000,
      sortOrder: 1,
    });
    const recurring = await createRecurringItem(testPrisma, {
      name: "Salary",
      type: "income",
      amount: 30000,
      dayOfMonth: 20,
      accountId: account.id,
      sortOrder: 1,
    });

    const response = await client.get("/api/dashboard?applyOffset=false");
    const body = await parseJson<{
      totalBalance: number;
      minBalance: number;
      forecast: Array<{ id: string; balance: number }>;
      accountForecasts: Array<{ accountId: string; currentBalance: number; minBalance: number }>;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.totalBalance).toBe(100000);
    expect(body.minBalance).toBe(100000);
    expect(body.forecast).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `recurring:${recurring.id}:2026-03`,
          balance: 130000,
        }),
      ]),
    );
    expect(body.accountForecasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: account.id,
          currentBalance: 100000,
          minBalance: 100000,
        }),
      ]),
    );
  });

  it("can disable account balance offsets for event-only dashboard data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 100000,
      balanceOffset: 40000,
      sortOrder: 1,
    });
    const recurring = await createRecurringItem(testPrisma, {
      name: "Salary",
      type: "income",
      amount: 30000,
      dayOfMonth: 20,
      accountId: account.id,
      sortOrder: 1,
    });

    const response = await client.get("/api/dashboard/events?months=1&applyOffset=false");
    const body = await parseJson<{
      forecast: Array<{ id: string; balance: number }>;
      accountForecasts: Array<{ accountId: string; events: Array<{ id: string; balance: number }> }>;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.forecast).toEqual([
      expect.objectContaining({
        id: `recurring:${recurring.id}:2026-03`,
        balance: 130000,
      }),
    ]);
    expect(body.accountForecasts).toEqual([
      expect.objectContaining({
        accountId: account.id,
        events: [expect.objectContaining({ id: `recurring:${recurring.id}:2026-03`, balance: 130000 })],
      }),
    ]);
  });

  it.each([
    {
      name: "none",
      balance: 500000,
      balanceOffset: 0,
      expenseAmount: 100000,
      expected: "none",
    },
    {
      name: "yellow",
      balance: 100000,
      balanceOffset: 80000,
      expenseAmount: 30000,
      expected: "yellow",
    },
    {
      name: "red",
      balance: 10000,
      balanceOffset: 0,
      expenseAmount: 50000,
      expected: "red",
    },
    {
      name: "red with offset",
      balance: 30000,
      balanceOffset: 20000,
      expenseAmount: 50000,
      expected: "red",
    },
  ])("assigns warningLevel $expected for $name forecasts", async ({
    balance,
    balanceOffset,
    expenseAmount,
    expected,
  }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const account = await createAccount(testPrisma, {
      name: `Account ${expected}`,
      balance,
      balanceOffset,
      sortOrder: 1,
    });
    await createRecurringItem(testPrisma, {
      name: "Planned Expense",
      type: "expense",
      amount: expenseAmount,
      dayOfMonth: 20,
      startDate: new Date("2026-03-01T00:00:00.000Z"),
      endDate: new Date("2026-03-31T00:00:00.000Z"),
      accountId: account.id,
      sortOrder: 1,
    });

    const response = await client.get("/api/dashboard");
    const body = await parseJson<{
      accountForecasts: Array<{ accountId: string; warningLevel: "none" | "yellow" | "red" }>;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.accountForecasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          accountId: account.id,
          warningLevel: expected,
        }),
      ]),
    );
  });

  it("uses assumptions instead of low actuals for credit card billings from next month onward", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 100000,
      sortOrder: 1,
    });
    const card = await createCreditCard(testPrisma, {
      name: "Future Card",
      accountId: account.id,
      settlementDay: 27,
      assumptionAmount: 15000,
      sortOrder: 1,
    });
    await createBilling(testPrisma, {
      yearMonth: "2026-04",
      items: [{ creditCardId: card.id, amount: 5000 }],
    });

    const response = await client.get("/api/dashboard");
    const body = await parseJson<{
      forecast: Array<{ id: string; amount: number; description: string }>;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.forecast).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `credit-card:${card.id}:2026-04`,
          amount: 15000,
          description: "Future Card 仮定値 (2026-04)",
        }),
      ]),
    );
  });

  it("explains aggregate and account forecast contributions through the target date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const main = await createAccount(testPrisma, {
      name: "Main",
      balance: 100000,
      sortOrder: 1,
    });
    const savings = await createAccount(testPrisma, {
      name: "Savings",
      balance: 50000,
      sortOrder: 2,
    });
    await createRecurringItem(testPrisma, {
      name: "Salary",
      type: "income",
      amount: 300000,
      dayOfMonth: 20,
      accountId: main.id,
      sortOrder: 1,
    });
    await createRecurringItem(testPrisma, {
      name: "Rent",
      type: "expense",
      amount: 80000,
      dayOfMonth: 21,
      accountId: main.id,
      sortOrder: 2,
    });
    await createRecurringItem(testPrisma, {
      name: "Savings Move",
      type: "transfer",
      amount: 30000,
      dayOfMonth: 22,
      accountId: main.id,
      transferToAccountId: savings.id,
      sortOrder: 3,
    });
    await createCreditCard(testPrisma, {
      name: "Card",
      accountId: main.id,
      settlementDay: 23,
      assumptionAmount: 12000,
      sortOrder: 1,
    });

    const totalResponse = await client.get("/api/dashboard/explain?date=2026-03-23");
    const total = await parseJson<{
      accountId: string | null;
      startBalance: number;
      finalBalance: number;
      assumptionEventCount: number;
      sourceTotals: {
        recurringIncomeJpy: number;
        recurringExpenseJpy: number;
        creditCardJpy: number;
        loanJpy: number;
        transferJpy: number;
      };
      events: Array<{ description: string; source: string; isAssumption: boolean; runningBalance: number }>;
    }>(totalResponse);

    expect(totalResponse.status).toBe(200);
    expect(total.accountId).toBeNull();
    expect(total.startBalance).toBe(150000);
    expect(total.sourceTotals).toEqual({
      recurringIncomeJpy: 300000,
      recurringExpenseJpy: -80000,
      creditCardJpy: -12000,
      loanJpy: 0,
      transferJpy: 0,
    });
    expect(total.finalBalance).toBe(358000);
    expect(total.assumptionEventCount).toBe(1);
    expect(total.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: "Salary", source: "recurring", runningBalance: 450000 }),
        expect.objectContaining({ description: "Rent", source: "recurring", runningBalance: 370000 }),
        expect.objectContaining({ description: "Savings Move", source: "transfer", runningBalance: 370000 }),
        expect.objectContaining({
          description: "Card 仮定値 (2026-03)",
          source: "credit-card",
          isAssumption: true,
          runningBalance: 358000,
        }),
      ]),
    );
    expect(total.events.some((event) => event.description === `Card 仮定値 (2026-03)`)).toBe(true);

    const accountResponse = await client.get(`/api/dashboard/explain?date=2026-03-23&accountId=${main.id}`);
    const accountBody = await parseJson<{
      accountId: string | null;
      startBalance: number;
      finalBalance: number;
      assumptionEventCount: number;
      sourceTotals: {
        recurringIncomeJpy: number;
        recurringExpenseJpy: number;
        creditCardJpy: number;
        transferJpy: number;
      };
      events: Array<{ description: string; source: string; runningBalance: number }>;
    }>(accountResponse);

    expect(accountResponse.status).toBe(200);
    expect(accountBody.accountId).toBe(main.id);
    expect(accountBody.startBalance).toBe(100000);
    expect(accountBody.sourceTotals).toMatchObject({
      recurringIncomeJpy: 300000,
      recurringExpenseJpy: -80000,
      creditCardJpy: -12000,
      transferJpy: -30000,
    });
    expect(accountBody.finalBalance).toBe(278000);
    expect(accountBody.assumptionEventCount).toBe(1);
    expect(accountBody.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: "Savings Move", source: "transfer", runningBalance: 290000 }),
      ]),
    );
  });

  it("returns 400 when explaining a date outside the forecast range", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const response = await client.get("/api/dashboard/explain?date=2026-03-13");

    expect(response.status).toBe(400);
    expect(await parseJson(response)).toMatchObject({ error: "date is outside forecast range" });
  });

  it("simulates exclusions and card assumption overrides without mutating stored data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 50000,
      sortOrder: 1,
    });
    const rent = await createRecurringItem(testPrisma, {
      name: "Rent",
      type: "expense",
      amount: 40000,
      dayOfMonth: 20,
      accountId: account.id,
      sortOrder: 1,
    });
    const loan = await createLoan(testPrisma, {
      name: "Loan",
      accountId: account.id,
      totalAmount: 20000,
      paymentCount: 1,
      startDate: new Date("2026-03-21T00:00:00.000Z"),
    });
    const card = await createCreditCard(testPrisma, {
      name: "Card",
      accountId: account.id,
      settlementDay: 22,
      assumptionAmount: 10000,
      sortOrder: 1,
    });

    const response = await client.post("/api/dashboard/simulate", {
      months: 1,
      exclude: {
        recurringItemIds: [rent.id],
        loanIds: [loan.id],
      },
      cardAssumptionOverrides: [{ creditCardId: card.id, assumptionAmount: 5000 }],
    });
    const body = await parseJson<{
      baseline: { minBalance: number; minBalanceDate: string | null; finalBalance: number; warningAccountCount: number };
      simulated: { minBalance: number; minBalanceDate: string | null; finalBalance: number; warningAccountCount: number };
      delta: { minBalance: number; finalBalance: number; warningAccountCount: number };
    }>(response);

    expect(response.status).toBe(200);
    expect(body.baseline).toEqual({
      minBalance: -20000,
      minBalanceDate: "2026-03-22",
      finalBalance: -20000,
      warningAccountCount: 1,
    });
    expect(body.simulated).toEqual({
      minBalance: 45000,
      minBalanceDate: "2026-03-22",
      finalBalance: 45000,
      warningAccountCount: 0,
    });
    expect(body.delta).toEqual({
      minBalance: 65000,
      finalBalance: 65000,
      warningAccountCount: -1,
    });

    const dashboard = await parseJson<{
      forecast: Array<{ id: string; amount: number }>;
    }>(await client.get("/api/dashboard/events?months=1"));
    expect(dashboard.forecast).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: `recurring:${rent.id}:2026-03`, amount: 40000 }),
        expect.objectContaining({ id: `loan:${loan.id}:2026-03`, amount: 20000 }),
        expect.objectContaining({ id: `credit-card:${card.id}:2026-03`, amount: 10000 }),
      ]),
    );

    const [savedAccount, savedCard, transactionCount] = await Promise.all([
      testPrisma.account.findUniqueOrThrow({ where: { id: account.id } }),
      testPrisma.creditCard.findUniqueOrThrow({ where: { id: card.id } }),
      testPrisma.transaction.count(),
    ]);
    expect(savedAccount.balance).toBe(50000);
    expect(savedCard.assumptionAmount).toBe(10000);
    expect(transactionCount).toBe(0);
  });

  it("returns 400 for unknown simulate IDs", async () => {
    const missingId = "99999999-9999-4999-8999-999999999999";

    const excludeResponse = await client.post("/api/dashboard/simulate", {
      exclude: { recurringItemIds: [missingId] },
    });
    expect(excludeResponse.status).toBe(400);
    expect(await parseJson(excludeResponse)).toMatchObject({
      error: `recurringItemIds not found: ${missingId}`,
    });

    const overrideResponse = await client.post("/api/dashboard/simulate", {
      cardAssumptionOverrides: [{ creditCardId: missingId, assumptionAmount: 1000 }],
    });
    expect(overrideResponse.status).toBe(400);
    expect(await parseJson(overrideResponse)).toMatchObject({
      error: `cardAssumptionOverrides.creditCardId not found: ${missingId}`,
    });
  });

  it("confirms a forecast event by creating a transaction and updating the account balance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 1000,
      sortOrder: 1,
    });
    const recurring = await createRecurringItem(testPrisma, {
      name: "Salary",
      type: "income",
      amount: 500,
      dayOfMonth: 20,
      accountId: account.id,
      sortOrder: 1,
    });

    const response = await client.post("/api/dashboard/confirm", {
      forecastEventId: `recurring:${recurring.id}:2026-03`,
      amount: 500,
    });

    expect(response.status).toBe(201);

    const savedTransaction = await testPrisma.transaction.findFirstOrThrow({
      where: { forecastEventId: `recurring:${recurring.id}:2026-03` },
    });
    expect(savedTransaction.amount).toBe(500);

    const updatedAccount = await testPrisma.account.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(updatedAccount.balance).toBe(1500);
  });

  it("returns 409 when confirming the same forecast event twice", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 1000,
      sortOrder: 1,
    });
    const recurring = await createRecurringItem(testPrisma, {
      name: "Salary",
      type: "income",
      amount: 500,
      dayOfMonth: 20,
      accountId: account.id,
      sortOrder: 1,
    });

    const payload = {
      forecastEventId: `recurring:${recurring.id}:2026-03`,
      amount: 500,
    };

    const first = await client.post("/api/dashboard/confirm", payload);
    const second = await client.post("/api/dashboard/confirm", payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(await parseJson(second)).toEqual({
      error: "Forecast event already confirmed",
    });
  });

  it("returns overdue forecast events without creating transactions or changing balances", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-20T00:00:00.000Z"));

    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 500000,
      sortOrder: 1,
    });
    // dayOfMonth=10 → date is 2026-03-10, which is past (today=03-20)
    const rent = await createRecurringItem(testPrisma, {
      name: "Rent",
      type: "expense",
      amount: 80000,
      dayOfMonth: 10,
      accountId: account.id,
      sortOrder: 1,
    });
    // dayOfMonth=15 → date is 2026-03-15, also past
    const salary = await createRecurringItem(testPrisma, {
      name: "Salary",
      type: "income",
      amount: 300000,
      dayOfMonth: 15,
      accountId: account.id,
      sortOrder: 2,
    });
    // dayOfMonth=25 → date is 2026-03-25, future
    const insurance = await createRecurringItem(testPrisma, {
      name: "Insurance",
      type: "expense",
      amount: 10000,
      dayOfMonth: 25,
      accountId: account.id,
      sortOrder: 3,
    });

    const response = await client.get("/api/dashboard");
    const body = await parseJson<{
      totalBalance: number;
      overdueForecast: Array<{ id: string; amount: number; description: string; balance: number }>;
      forecast: Array<{ id: string; amount: number; description: string }>;
    }>(response);

    expect(response.status).toBe(200);

    // Past events should NOT appear in forecast
    expect(body.forecast.some((e) => e.id === `recurring:${rent.id}:2026-03`)).toBe(false);
    expect(body.forecast.some((e) => e.id === `recurring:${salary.id}:2026-03`)).toBe(false);
    expect(body.overdueForecast).toEqual([
      expect.objectContaining({
        id: `recurring:${rent.id}:2026-03`,
        amount: 80000,
        description: "Rent",
        balance: 420000,
      }),
      expect.objectContaining({
        id: `recurring:${salary.id}:2026-03`,
        amount: 300000,
        description: "Salary",
        balance: 720000,
      }),
    ]);

    // Future event should appear
    expect(body.forecast.some((e) => e.id === `recurring:${insurance.id}:2026-03`)).toBe(true);

    // GET should not mutate the current account balance.
    expect(body.totalBalance).toBe(500000);

    const autoConfirmedTransactions = await testPrisma.transaction.findMany({
      where: {
        forecastEventId: {
          in: [`recurring:${rent.id}:2026-03`, `recurring:${salary.id}:2026-03`],
        },
      },
    });
    expect(autoConfirmedTransactions).toHaveLength(0);

    const savedAccount = await testPrisma.account.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(savedAccount.balance).toBe(500000);

    const eventsResponse = await client.get("/api/dashboard/events?months=1");
    const eventsBody = await parseJson<{ forecast: Array<{ id: string }> }>(eventsResponse);
    expect(eventsBody.forecast.some((e) => e.id === `recurring:${rent.id}:2026-03`)).toBe(false);
    expect(eventsBody.forecast.some((e) => e.id === `recurring:${salary.id}:2026-03`)).toBe(false);
  });

  it("confirms an overdue forecast event with an edited amount and account", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-20T00:00:00.000Z"));

    const sourceAccount = await createAccount(testPrisma, {
      name: "Source",
      balance: 500000,
      sortOrder: 1,
    });
    const targetAccount = await createAccount(testPrisma, {
      name: "Target",
      balance: 100000,
      sortOrder: 2,
    });
    const rent = await createRecurringItem(testPrisma, {
      name: "Rent",
      type: "expense",
      amount: 80000,
      dayOfMonth: 10,
      accountId: sourceAccount.id,
      sortOrder: 1,
    });

    const response = await client.post("/api/dashboard/confirm", {
      forecastEventId: `recurring:${rent.id}:2026-03`,
      amount: 75000,
      accountId: targetAccount.id,
    });

    expect(response.status).toBe(201);

    const savedTransaction = await testPrisma.transaction.findFirstOrThrow({
      where: { forecastEventId: `recurring:${rent.id}:2026-03` },
    });
    expect(savedTransaction.accountId).toBe(targetAccount.id);
    expect(savedTransaction.amount).toBe(75000);
    expect(savedTransaction.date.toISOString().slice(0, 10)).toBe("2026-03-10");

    const savedSourceAccount = await testPrisma.account.findUniqueOrThrow({
      where: { id: sourceAccount.id },
    });
    const savedTargetAccount = await testPrisma.account.findUniqueOrThrow({
      where: { id: targetAccount.id },
    });
    expect(savedSourceAccount.balance).toBe(500000);
    expect(savedTargetAccount.balance).toBe(25000);

    const second = await client.post("/api/dashboard/confirm", {
      forecastEventId: `recurring:${rent.id}:2026-03`,
      amount: 75000,
      accountId: targetAccount.id,
    });
    expect(second.status).toBe(409);
  });

  it("returns 404 when the forecast event does not exist", async () => {
    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 1000,
      sortOrder: 1,
    });

    const response = await client.post("/api/dashboard/confirm", {
      forecastEventId: "recurring:missing:2026-03",
      amount: 500,
      accountId: account.id,
    });

    expect(response.status).toBe(404);
  });
});
