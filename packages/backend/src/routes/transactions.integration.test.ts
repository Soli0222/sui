import { describe, expect, it } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { createAccount, createTransaction } from "../test-helpers/fixtures";
import { testPrisma } from "../test-helpers/db";

const client = createTestClient();

describe("transactions routes", () => {
  it("returns paginated transactions filtered by account and sorted by date desc", async () => {
    const checking = await createAccount(testPrisma, {
      name: "Checking",
      balance: 1000,
      sortOrder: 1,
    });
    const savings = await createAccount(testPrisma, {
      name: "Savings",
      balance: 1000,
      sortOrder: 2,
    });

    await createTransaction(testPrisma, {
      accountId: checking.id,
      date: new Date("2026-03-10T00:00:00.000Z"),
      description: "Older",
      amount: 100,
      type: "expense",
    });
    const latest = await createTransaction(testPrisma, {
      accountId: checking.id,
      date: new Date("2026-03-12T00:00:00.000Z"),
      description: "Latest",
      amount: 200,
      type: "income",
    });
    await createTransaction(testPrisma, {
      accountId: savings.id,
      date: new Date("2026-03-11T00:00:00.000Z"),
      description: "Other account",
      amount: 300,
      type: "income",
    });

    const response = await client.get(
      `/api/transactions?page=1&limit=1&accountId=${checking.id}`,
    );
    const body = await parseJson<{
      items: Array<{ id: string; accountName: string }>;
      page: number;
      limit: number;
      total: number;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(1);
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      id: latest.id,
      accountName: "Checking",
    });
  });

  it("creates income transactions and increments the account balance", async () => {
    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 1000,
      sortOrder: 1,
    });

    const response = await client.post("/api/transactions", {
      accountId: account.id,
      date: "2026-03-14",
      type: "income",
      description: "Salary",
      amount: 500,
    });

    expect(response.status).toBe(201);

    const updated = await testPrisma.account.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(updated.balance).toBe(1500);
  });

  it("creates expense transactions and decrements the account balance", async () => {
    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 1000,
      sortOrder: 1,
    });

    const response = await client.post("/api/transactions", {
      accountId: account.id,
      date: "2026-03-14",
      type: "expense",
      description: "Rent",
      amount: 400,
    });

    expect(response.status).toBe(201);

    const updated = await testPrisma.account.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(updated.balance).toBe(600);
  });

  it("creates transfer transactions and moves money between accounts", async () => {
    const source = await createAccount(testPrisma, {
      name: "Source",
      balance: 1000,
      sortOrder: 1,
    });
    const destination = await createAccount(testPrisma, {
      name: "Destination",
      balance: 300,
      sortOrder: 2,
    });

    const response = await client.post("/api/transactions", {
      accountId: source.id,
      transferToAccountId: destination.id,
      date: "2026-03-14",
      type: "transfer",
      description: "Move funds",
      amount: 250,
    });

    expect(response.status).toBe(201);

    const [updatedSource, updatedDestination] = await Promise.all([
      testPrisma.account.findUniqueOrThrow({ where: { id: source.id } }),
      testPrisma.account.findUniqueOrThrow({ where: { id: destination.id } }),
    ]);
    expect(updatedSource.balance).toBe(750);
    expect(updatedDestination.balance).toBe(550);
  });

  it("rejects transfers without a destination account", async () => {
    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 1000,
      sortOrder: 1,
    });

    const response = await client.post("/api/transactions", {
      accountId: account.id,
      date: "2026-03-14",
      type: "transfer",
      description: "Invalid transfer",
      amount: 100,
    });

    expect(response.status).toBe(400);
    expect(await parseJson(response)).toEqual({
      error: "transferToAccountId is required for transfer",
    });
  });

  it("updates an expense transaction and recalculates the account balance", async () => {
    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 800,
      sortOrder: 1,
    });
    const existing = await createTransaction(testPrisma, {
      accountId: account.id,
      date: new Date("2026-03-14T00:00:00.000Z"),
      description: "Lunch",
      amount: 200,
      type: "expense",
      forecastEventId: "forecast-1",
    });

    const response = await client.put(`/api/transactions/${existing.id}`, {
      accountId: account.id,
      date: "2026-03-15",
      type: "expense",
      description: "Dinner",
      amount: 350,
    });
    const body = await parseJson<{
      description: string;
      amount: number;
      forecastEventId: string | null;
    }>(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      description: "Dinner",
      amount: 350,
      forecastEventId: "forecast-1",
    });

    const updated = await testPrisma.account.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(updated.balance).toBe(650);
  });

  it("moves an expense transaction to a different account", async () => {
    const source = await createAccount(testPrisma, {
      name: "Source",
      balance: 900,
      sortOrder: 1,
    });
    const destination = await createAccount(testPrisma, {
      name: "Destination",
      balance: 500,
      sortOrder: 2,
    });
    const existing = await createTransaction(testPrisma, {
      accountId: source.id,
      date: new Date("2026-03-14T00:00:00.000Z"),
      description: "Groceries",
      amount: 100,
      type: "expense",
    });

    const response = await client.put(`/api/transactions/${existing.id}`, {
      accountId: destination.id,
      date: "2026-03-14",
      type: "expense",
      description: "Groceries",
      amount: 100,
    });

    expect(response.status).toBe(200);

    const [updatedSource, updatedDestination] = await Promise.all([
      testPrisma.account.findUniqueOrThrow({ where: { id: source.id } }),
      testPrisma.account.findUniqueOrThrow({ where: { id: destination.id } }),
    ]);
    expect(updatedSource.balance).toBe(1000);
    expect(updatedDestination.balance).toBe(400);
  });

  it("changes a transaction from income to expense and flips the balance effect", async () => {
    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 1300,
      sortOrder: 1,
    });
    const existing = await createTransaction(testPrisma, {
      accountId: account.id,
      date: new Date("2026-03-14T00:00:00.000Z"),
      description: "Bonus",
      amount: 300,
      type: "income",
    });

    const response = await client.put(`/api/transactions/${existing.id}`, {
      accountId: account.id,
      date: "2026-03-14",
      type: "expense",
      description: "Bonus correction",
      amount: 300,
    });

    expect(response.status).toBe(200);

    const updated = await testPrisma.account.findUniqueOrThrow({
      where: { id: account.id },
    });
    expect(updated.balance).toBe(700);
  });

  it("updates a transfer destination and recalculates both destination balances", async () => {
    const source = await createAccount(testPrisma, {
      name: "Source",
      balance: 700,
      sortOrder: 1,
    });
    const firstDestination = await createAccount(testPrisma, {
      name: "Destination A",
      balance: 500,
      sortOrder: 2,
    });
    const secondDestination = await createAccount(testPrisma, {
      name: "Destination B",
      balance: 400,
      sortOrder: 3,
    });
    const existing = await createTransaction(testPrisma, {
      accountId: source.id,
      transferToAccountId: firstDestination.id,
      date: new Date("2026-03-14T00:00:00.000Z"),
      description: "Move funds",
      amount: 300,
      type: "transfer",
    });

    const response = await client.put(`/api/transactions/${existing.id}`, {
      accountId: source.id,
      transferToAccountId: secondDestination.id,
      date: "2026-03-14",
      type: "transfer",
      description: "Move funds",
      amount: 300,
    });

    expect(response.status).toBe(200);

    const [updatedSource, updatedFirstDestination, updatedSecondDestination] =
      await Promise.all([
        testPrisma.account.findUniqueOrThrow({ where: { id: source.id } }),
        testPrisma.account.findUniqueOrThrow({ where: { id: firstDestination.id } }),
        testPrisma.account.findUniqueOrThrow({ where: { id: secondDestination.id } }),
      ]);
    expect(updatedSource.balance).toBe(700);
    expect(updatedFirstDestination.balance).toBe(200);
    expect(updatedSecondDestination.balance).toBe(700);
  });

  it("returns 404 when updating a missing transaction", async () => {
    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 1000,
      sortOrder: 1,
    });

    const response = await client.put("/api/transactions/00000000-0000-0000-0000-000000000000", {
      accountId: account.id,
      date: "2026-03-14",
      type: "expense",
      description: "Missing",
      amount: 100,
    });

    expect(response.status).toBe(404);
    expect(await parseJson(response)).toEqual({
      error: "Transaction not found",
    });
  });
});
