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

  it("filters transactions by an inclusive date range", async () => {
    const account = await createAccount(testPrisma, {
      name: "Checking",
      balance: 1000,
      sortOrder: 1,
    });

    await createTransaction(testPrisma, {
      accountId: account.id,
      date: new Date("2026-01-31T00:00:00.000Z"),
      description: "Outside",
      amount: 100,
      type: "expense",
    });
    const firstMatch = await createTransaction(testPrisma, {
      accountId: account.id,
      date: new Date("2026-02-01T00:00:00.000Z"),
      description: "Range start",
      amount: 200,
      type: "expense",
    });
    const secondMatch = await createTransaction(testPrisma, {
      accountId: account.id,
      date: new Date("2026-02-28T00:00:00.000Z"),
      description: "Range end",
      amount: 300,
      type: "income",
    });
    await createTransaction(testPrisma, {
      accountId: account.id,
      date: new Date("2026-03-01T00:00:00.000Z"),
      description: "After range",
      amount: 400,
      type: "income",
    });

    const response = await client.get(
      `/api/transactions?accountId=${account.id}&startDate=2026-02-01&endDate=2026-02-28`,
    );
    const body = await parseJson<{
      items: Array<{ id: string }>;
      total: number;
      limit: number;
      page: number;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.total).toBe(2);
    expect(body.items.map((item) => item.id)).toEqual([secondMatch.id, firstMatch.id]);
  });

  it("includes inbound transfers when filtering by account", async () => {
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

    const incomingTransfer = await createTransaction(testPrisma, {
      accountId: savings.id,
      transferToAccountId: checking.id,
      date: new Date("2026-03-11T00:00:00.000Z"),
      description: "入金移動",
      amount: 300,
      type: "transfer",
    });

    const response = await client.get(`/api/transactions?accountId=${checking.id}`);
    const body = await parseJson<{
      items: Array<{ id: string; transferToAccountName: string | null }>;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: incomingTransfer.id,
        transferToAccountName: "Checking",
      }),
    ]));
  });

  it("rejects invalid transaction list queries", async () => {
    const invalidDate = await client.get("/api/transactions?startDate=2026-02-30");
    const invalidLimit = await client.get("/api/transactions?limit=101");
    const invalidRange = await client.get(
      "/api/transactions?startDate=2026-03-02&endDate=2026-03-01",
    );

    expect(invalidDate.status).toBe(400);
    expect(await parseJson(invalidDate)).toEqual({
      error: "Validation failed",
      details: {
        formErrors: [],
        fieldErrors: {
          startDate: ["startDate must be YYYY-MM-DD"],
        },
      },
    });

    expect(invalidLimit.status).toBe(400);
    expect(await parseJson(invalidLimit)).toEqual({
      error: "Validation failed",
      details: {
        formErrors: [],
        fieldErrors: {
          limit: ["limit must be less than or equal to 100"],
        },
      },
    });

    expect(invalidRange.status).toBe(400);
    expect(await parseJson(invalidRange)).toEqual({
      error: "Validation failed",
      details: {
        formErrors: [],
        fieldErrors: {
          startDate: ["startDate must be less than or equal to endDate"],
        },
      },
    });
  });

  it("returns balance history for a selected account including incoming and outgoing transfers", async () => {
    const checking = await createAccount(testPrisma, {
      name: "Checking",
      balance: 1250,
      sortOrder: 1,
    });
    const savings = await createAccount(testPrisma, {
      name: "Savings",
      balance: 500,
      sortOrder: 2,
    });

    await createTransaction(testPrisma, {
      accountId: checking.id,
      date: new Date("2026-03-01T00:00:00.000Z"),
      description: "給与",
      amount: 500,
      type: "income",
    });
    await createTransaction(testPrisma, {
      accountId: checking.id,
      date: new Date("2026-03-05T00:00:00.000Z"),
      description: "家賃",
      amount: 200,
      type: "expense",
    });
    await createTransaction(testPrisma, {
      accountId: checking.id,
      transferToAccountId: savings.id,
      date: new Date("2026-03-10T00:00:00.000Z"),
      description: "貯金へ移動",
      amount: 100,
      type: "transfer",
    });
    await createTransaction(testPrisma, {
      accountId: savings.id,
      transferToAccountId: checking.id,
      date: new Date("2026-03-12T00:00:00.000Z"),
      description: "戻し入れ",
      amount: 300,
      type: "transfer",
    });
    await createTransaction(testPrisma, {
      accountId: checking.id,
      date: new Date("2026-03-15T00:00:00.000Z"),
      description: "昼食",
      amount: 50,
      type: "expense",
    });

    const response = await client.get(
      `/api/transactions/balance-history?accountId=${checking.id}&startDate=2026-03-01&endDate=2026-03-12`,
    );
    const body = await parseJson<{
      points: Array<{ date: string; balance: number; description: string }>;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.points).toEqual([
      { date: "2026-03-01", balance: 1300, description: "給与" },
      { date: "2026-03-05", balance: 1100, description: "家賃" },
      { date: "2026-03-10", balance: 1000, description: "貯金へ移動" },
      { date: "2026-03-12", balance: 1300, description: "戻し入れ" },
    ]);
  });

  it("returns total balance history and keeps transfers neutral", async () => {
    const checking = await createAccount(testPrisma, {
      name: "Checking",
      balance: 1150,
      sortOrder: 1,
    });
    const savings = await createAccount(testPrisma, {
      name: "Savings",
      balance: 800,
      sortOrder: 2,
    });

    await createTransaction(testPrisma, {
      accountId: checking.id,
      date: new Date("2026-03-01T00:00:00.000Z"),
      description: "給与",
      amount: 500,
      type: "income",
    });
    await createTransaction(testPrisma, {
      accountId: checking.id,
      date: new Date("2026-03-05T00:00:00.000Z"),
      description: "家賃",
      amount: 200,
      type: "expense",
    });
    await createTransaction(testPrisma, {
      accountId: checking.id,
      transferToAccountId: savings.id,
      date: new Date("2026-03-10T00:00:00.000Z"),
      description: "口座間移動",
      amount: 100,
      type: "transfer",
    });
    await createTransaction(testPrisma, {
      accountId: savings.id,
      date: new Date("2026-03-12T00:00:00.000Z"),
      description: "旅行",
      amount: 50,
      type: "expense",
    });
    await createTransaction(testPrisma, {
      accountId: savings.id,
      date: new Date("2026-03-15T00:00:00.000Z"),
      description: "ボーナス",
      amount: 200,
      type: "income",
    });

    const response = await client.get(
      "/api/transactions/balance-history?startDate=2026-03-01&endDate=2026-03-12",
    );
    const body = await parseJson<{
      points: Array<{ date: string; balance: number; description: string }>;
    }>(response);

    expect(response.status).toBe(200);
    expect(body.points).toEqual([
      { date: "2026-03-01", balance: 2000, description: "給与" },
      { date: "2026-03-05", balance: 1800, description: "家賃" },
      { date: "2026-03-10", balance: 1800, description: "口座間移動" },
      { date: "2026-03-12", balance: 1750, description: "旅行" },
    ]);
  });

  it("rejects invalid balance history queries", async () => {
    const invalidDate = await client.get("/api/transactions/balance-history?startDate=2026-02-30");
    const invalidRange = await client.get(
      "/api/transactions/balance-history?startDate=2026-03-02&endDate=2026-03-01",
    );

    expect(invalidDate.status).toBe(400);
    expect(await parseJson(invalidDate)).toEqual({
      error: "Validation failed",
      details: {
        formErrors: [],
        fieldErrors: {
          startDate: ["startDate must be YYYY-MM-DD"],
        },
      },
    });

    expect(invalidRange.status).toBe(400);
    expect(await parseJson(invalidRange)).toEqual({
      error: "Validation failed",
      details: {
        formErrors: [],
        fieldErrors: {
          startDate: ["startDate must be less than or equal to endDate"],
        },
      },
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
