import { describe, expect, it, vi } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { createAccount, createTransaction } from "../test-helpers/fixtures";
import { testPrisma } from "../test-helpers/db";
import { refreshExchangeRatesToJpy } from "../services/exchange-rates";

const client = createTestClient();

describe("accounts routes", () => {
  it("returns an empty list when no accounts exist", async () => {
    const response = await client.get("/api/accounts");

    expect(response.status).toBe(200);
    expect(await parseJson(response)).toEqual([]);
  });

  it("returns active accounts ordered by sortOrder", async () => {
    const hidden = await createAccount(testPrisma, {
      name: "Hidden",
      balance: 100,
      sortOrder: 0,
      deletedAt: new Date("2026-03-14T00:00:00.000Z"),
    });
    const second = await createAccount(testPrisma, {
      name: "Second",
      balance: 200,
      sortOrder: 2,
    });
    const first = await createAccount(testPrisma, {
      name: "First",
      balance: 300,
      sortOrder: 1,
    });

    const response = await client.get("/api/accounts");
    const body = await parseJson<Array<{ id: string }>>(response);

    expect(response.status).toBe(200);
    expect(body.map((account) => account.id)).toEqual([first.id, second.id]);
    expect(body.some((account) => account.id === hidden.id)).toBe(false);
  });

  it("refreshes exchange rates before returning accounts", async () => {
    const account = await createAccount(testPrisma, {
      name: "USD Wallet",
      balance: 10000,
      currencyCode: "USD",
      exchangeRateToJpy: 140,
      sortOrder: 1,
    });
    vi.mocked(refreshExchangeRatesToJpy).mockImplementation(async (db) => {
      await db.account.updateMany({
        where: { deletedAt: null, currencyCode: "USD" },
        data: {
          exchangeRateToJpy: 160.25,
          exchangeRateUpdatedAt: new Date("2026-06-13T00:00:00.000Z"),
        },
      });
    });

    const response = await client.get("/api/accounts");
    const body = await parseJson<Array<{ id: string; exchangeRateToJpy: number }>>(response);

    expect(response.status).toBe(200);
    expect(refreshExchangeRatesToJpy).toHaveBeenCalledOnce();
    expect(body).toEqual([
      expect.objectContaining({
        id: account.id,
        exchangeRateToJpy: 160.25,
      }),
    ]);
  });

  it("creates an account and validates the payload", async () => {
    const success = await client.post("/api/accounts", {
      name: "Wallet",
      balance: 12345,
      balanceOffset: 678,
      sortOrder: 5,
    });
    const created = await parseJson<{ id: string }>(success);

    expect(success.status).toBe(201);

    const saved = await testPrisma.account.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(saved.name).toBe("Wallet");
    expect(saved.balance).toBe(12345);
    expect(saved.balanceOffset).toBe(678);
    expect(saved.currencyCode).toBe("JPY");
    expect(saved.exchangeRateToJpy).toBe(1);
    expect(saved.sortOrder).toBe(5);

    const invalid = await client.post("/api/accounts", {
      name: "",
      balance: 0,
      balanceOffset: 0,
      sortOrder: 0,
    });

    expect(invalid.status).toBe(400);
    expect(await parseJson(invalid)).toMatchObject({ error: "Validation failed" });
  });

  it("creates foreign-currency accounts and validates currency fields", async () => {
    const success = await client.post("/api/accounts", {
      name: "USD Wallet",
      balance: 123456,
      balanceOffset: 1000,
      currencyCode: "usd",
      exchangeRateToJpy: 150.25,
      sortOrder: 6,
    });
    const created = await parseJson<{ id: string }>(success);

    expect(success.status).toBe(201);

    const saved = await testPrisma.account.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(saved.currencyCode).toBe("USD");
    expect(saved.exchangeRateToJpy).toBeCloseTo(150.25);

    const jpy = await client.post("/api/accounts", {
      name: "JPY Wallet",
      balance: 1000,
      balanceOffset: 0,
      currencyCode: "JPY",
      exchangeRateToJpy: 150,
      sortOrder: 7,
    });
    const jpyAccount = await testPrisma.account.findUniqueOrThrow({
      where: { id: (await parseJson<{ id: string }>(jpy)).id },
    });
    expect(jpy.status).toBe(201);
    expect(jpyAccount.exchangeRateToJpy).toBe(1);

    const invalidCurrency = await client.post("/api/accounts", {
      name: "Invalid",
      balance: 1000,
      balanceOffset: 0,
      currencyCode: "AUD",
      exchangeRateToJpy: 100,
      sortOrder: 8,
    });
    const invalidRate = await client.post("/api/accounts", {
      name: "Invalid rate",
      balance: 1000,
      balanceOffset: 0,
      currencyCode: "USD",
      exchangeRateToJpy: 0,
      sortOrder: 9,
    });

    expect(invalidCurrency.status).toBe(400);
    expect(invalidRate.status).toBe(400);
  });

  it("reconciles an account with a positive difference", async () => {
    vi.setSystemTime(new Date("2026-07-04T00:00:00.000Z"));
    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 1000,
      sortOrder: 1,
    });

    const response = await client.post(`/api/accounts/${account.id}/reconcile`, {
      actualBalance: 1500,
    });
    const body = await parseJson<{
      diff: number;
      adjustment: { id: string; type: string; date: string; amount: number; description: string };
      account: { balance: number; lastReconciledAt: string | null };
    }>(response);

    expect(response.status).toBe(200);
    expect(body.diff).toBe(500);
    expect(body.adjustment).toMatchObject({
      type: "adjustment",
      date: "2026-07-04",
      amount: 500,
      description: "残高照合",
    });
    expect(body.account.balance).toBe(1500);
    expect(body.account.lastReconciledAt).not.toBeNull();

    const stored = await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(stored.balance).toBe(1500);
    expect(stored.lastReconciledAt).not.toBeNull();
  });

  it("reconciles an account with a negative difference", async () => {
    vi.setSystemTime(new Date("2026-07-04T00:00:00.000Z"));
    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 1000,
      sortOrder: 1,
    });

    const response = await client.post(`/api/accounts/${account.id}/reconcile`, {
      actualBalance: 700,
    });
    const body = await parseJson<{
      diff: number;
      adjustment: { type: string; amount: number; description: string };
      account: { balance: number; lastReconciledAt: string | null };
    }>(response);

    expect(response.status).toBe(200);
    expect(body.diff).toBe(-300);
    expect(body.adjustment).toMatchObject({
      type: "adjustment",
      amount: -300,
      description: "残高照合",
    });
    expect(body.account.balance).toBe(700);
    expect(body.account.lastReconciledAt).not.toBeNull();
  });

  it("records reconciliation without creating a transaction when the difference is zero", async () => {
    const account = await createAccount(testPrisma, {
      name: "Main",
      balance: 1000,
      sortOrder: 1,
    });

    const response = await client.post(`/api/accounts/${account.id}/reconcile`, {
      actualBalance: 1000,
    });
    const body = await parseJson<{
      diff: number;
      adjustment: null;
      account: { balance: number; lastReconciledAt: string | null };
    }>(response);
    const transactions = await testPrisma.transaction.findMany({
      where: { accountId: account.id, deletedAt: null },
    });

    expect(response.status).toBe(200);
    expect(body.diff).toBe(0);
    expect(body.adjustment).toBeNull();
    expect(body.account.balance).toBe(1000);
    expect(body.account.lastReconciledAt).not.toBeNull();
    expect(transactions).toHaveLength(0);
  });

  it("returns 404 when reconciling a missing account", async () => {
    const response = await client.post("/api/accounts/00000000-0000-0000-0000-000000000000/reconcile", {
      actualBalance: 1000,
    });

    expect(response.status).toBe(404);
    expect(await parseJson(response)).toEqual({
      error: "Account not found",
    });
  });

  it("updates an active account and returns 404 for missing or deleted ids", async () => {
    const target = await createAccount(testPrisma, {
      name: "Before",
      balance: 1000,
      sortOrder: 1,
    });
    const deleted = await createAccount(testPrisma, {
      name: "Deleted",
      balance: 1000,
      sortOrder: 2,
      deletedAt: new Date("2026-03-14T00:00:00.000Z"),
    });

    const success = await client.put(`/api/accounts/${target.id}`, {
      name: "After",
      balance: 2500,
      balanceOffset: 250,
      sortOrder: 9,
    });

    expect(success.status).toBe(200);
    expect(await parseJson(success)).toMatchObject({
      id: target.id,
      name: "After",
      balance: 2500,
      balanceOffset: 250,
      currencyCode: "JPY",
      exchangeRateToJpy: 1,
      sortOrder: 9,
    });

    const updated = await testPrisma.account.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(updated.name).toBe("After");
    expect(updated.balance).toBe(2500);
    expect(updated.balanceOffset).toBe(250);

    const missing = await client.put("/api/accounts/00000000-0000-0000-0000-000000000000", {
      name: "Missing",
      balance: 1,
      balanceOffset: 0,
      sortOrder: 1,
    });
    const deletedResponse = await client.put(`/api/accounts/${deleted.id}`, {
      name: "Deleted",
      balance: 1,
      balanceOffset: 0,
      sortOrder: 1,
    });

    expect(missing.status).toBe(404);
    expect(deletedResponse.status).toBe(404);
  });

  it("records account balance edits as adjustments without changing past balance history", async () => {
    vi.setSystemTime(new Date("2026-07-04T00:00:00.000Z"));
    const account = await createAccount(testPrisma, {
      name: "History",
      balance: 1300,
      sortOrder: 1,
    });
    await createTransaction(testPrisma, {
      accountId: account.id,
      date: new Date("2026-03-01T00:00:00.000Z"),
      description: "Salary",
      amount: 500,
      type: "income",
    });
    await createTransaction(testPrisma, {
      accountId: account.id,
      date: new Date("2026-03-05T00:00:00.000Z"),
      description: "Rent",
      amount: 200,
      type: "expense",
    });

    const historyPath =
      `/api/transactions/balance-history?accountId=${account.id}&startDate=2026-03-01&endDate=2026-03-05`;
    const before = await parseJson<{ points: unknown[] }>(await client.get(historyPath));

    const update = await client.put(`/api/accounts/${account.id}`, {
      name: "History",
      balance: 1800,
      balanceOffset: 0,
      sortOrder: 1,
    });
    const after = await parseJson<{ points: unknown[] }>(await client.get(historyPath));
    const adjustments = await testPrisma.transaction.findMany({
      where: { accountId: account.id, type: "adjustment", deletedAt: null },
    });
    const updated = await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } });

    expect(update.status).toBe(200);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({
      amount: 500,
      description: "残高調整（口座編集）",
    });
    expect(updated.balance).toBe(1800);
    expect(updated.lastReconciledAt).toBeNull();
    expect(after.points).toEqual(before.points);
  });

  it("soft deletes an account and returns 404 when the id does not exist", async () => {
    const target = await createAccount(testPrisma, {
      name: "Delete me",
      balance: 100,
      sortOrder: 1,
    });

    const success = await client.delete(`/api/accounts/${target.id}`);

    expect(success.status).toBe(204);

    const deleted = await testPrisma.account.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(deleted.deletedAt).not.toBeNull();

    const missing = await client.delete("/api/accounts/00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404);
  });
});
