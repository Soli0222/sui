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

  it("uses assumptions instead of low actuals for credit card billings from two months ahead onward", async () => {
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
      yearMonth: "2026-05",
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
          id: `credit-card:${card.id}:2026-05`,
          amount: 15000,
          description: "Future Card 仮定値 (2026-05)",
        }),
      ]),
    );
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

  it("auto-confirms past forecast events and reflects them in account balances", async () => {
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
      forecast: Array<{ id: string; amount: number; description: string }>;
    }>(response);

    expect(response.status).toBe(200);

    // Past events should NOT appear in forecast
    expect(body.forecast.some((e) => e.id === `recurring:${rent.id}:2026-03`)).toBe(false);
    expect(body.forecast.some((e) => e.id === `recurring:${salary.id}:2026-03`)).toBe(false);

    // Future event should appear
    expect(body.forecast.some((e) => e.id === `recurring:${insurance.id}:2026-03`)).toBe(true);

    // Account balance should reflect auto-confirmed events: 500000 - 80000 + 300000 = 720000
    expect(body.totalBalance).toBe(720000);

    // Transactions should have been created
    const autoConfirmedTransactions = await testPrisma.transaction.findMany({
      where: {
        forecastEventId: {
          in: [`recurring:${rent.id}:2026-03`, `recurring:${salary.id}:2026-03`],
        },
      },
    });
    expect(autoConfirmedTransactions).toHaveLength(2);

    // Account balance in DB should be updated
    const updatedAccount = await testPrisma.account.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(updatedAccount.balance).toBe(720000);

    // Calling again should be idempotent
    const response2 = await client.get("/api/dashboard");
    const body2 = await parseJson<{ totalBalance: number }>(response2);
    expect(body2.totalBalance).toBe(720000);
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
