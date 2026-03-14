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
