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
});
