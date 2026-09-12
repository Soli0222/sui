import { describe, expect, it } from "vitest";
import { createTestClient } from "../test-helpers/app";
import { createAccount, createTransaction } from "../test-helpers/fixtures";
import { testPrisma } from "../test-helpers/db";

const client = createTestClient();
const date = "2026-09-12";

describe("ledger concurrency", () => {
  it.each(["income", "expense", "transfer"] as const)("reverses a deleted %s exactly once", async (type) => {
    const account = await createAccount(testPrisma, { name: "Source", balance: 1000 });
    const destination = await createAccount(testPrisma, { name: "Destination", balance: 1000 });
    const entry = await createTransaction(testPrisma, {
      accountId: account.id, type, amount: 200,
      transferToAccountId: type === "transfer" ? destination.id : null,
    });
    const responses = await Promise.all(Array.from({ length: 6 }, () => client.delete(`/api/transactions/${entry.id}`)));
    expect(responses.map(r => r.status).sort()).toEqual([204, 404, 404, 404, 404, 404]);
    expect((await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance)
      .toBe(type === "income" ? 800 : 1200);
    expect((await testPrisma.account.findUniqueOrThrow({ where: { id: destination.id } })).balance)
      .toBe(type === "transfer" ? 800 : 1000);
  });

  it("keeps balances consistent when edits and deletion overlap", async () => {
    const account = await createAccount(testPrisma, { name: "Source", balance: 900 });
    const entry = await createTransaction(testPrisma, { accountId: account.id, type: "expense", amount: 100 });
    const responses = await Promise.all([
      ...Array.from({ length: 5 }, (_, i) => client.put(`/api/transactions/${entry.id}`, {
        accountId: account.id, type: "expense", amount: 200 + i, date, description: "Edited",
      })),
      client.delete(`/api/transactions/${entry.id}`),
    ]);
    expect(responses.every(r => [200, 204, 404].includes(r.status))).toBe(true);
    expect((await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance).toBe(1000);
  });

  it("reverses the latest committed amount on overlapping edits", async () => {
    const account = await createAccount(testPrisma, { name: "Source", balance: 900 });
    const entry = await createTransaction(testPrisma, { accountId: account.id, type: "expense", amount: 100 });
    const responses = await Promise.all(Array.from({ length: 6 }, (_, i) => client.put(`/api/transactions/${entry.id}`, {
      accountId: account.id, type: "expense", amount: 200 + i, date, description: "Edited",
    })));
    expect(responses.every(r => r.status === 200)).toBe(true);
    const saved = await testPrisma.transaction.findUniqueOrThrow({ where: { id: entry.id } });
    expect((await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance).toBe(1000 - saved.amount);
  });

  it("creates only the adjustment represented by the final balance", async () => {
    const account = await createAccount(testPrisma, { name: "Source", balance: 1000 });
    const responses = await Promise.all(Array.from({ length: 6 }, () => client.post(`/api/accounts/${account.id}/reconcile`, { actualBalance: 1500 })));
    expect(responses.every(r => r.status === 200)).toBe(true);
    const adjustments = await testPrisma.transaction.findMany({ where: { accountId: account.id, type: "adjustment" } });
    expect(adjustments.map(entry => entry.amount)).toEqual([500]);
    expect((await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance).toBe(1500);
  });

  it("preserves the ledger invariant across reconciliation, account edits and ordinary transactions", async () => {
    const account = await createAccount(testPrisma, { name: "Source", balance: 1000 });
    const responses = await Promise.all([
      client.post(`/api/accounts/${account.id}/reconcile`, { actualBalance: 1500 }),
      client.put(`/api/accounts/${account.id}`, { name: "Source", balance: 1700, sortOrder: 0 }),
      ...Array.from({ length: 4 }, () => client.post("/api/transactions", {
        accountId: account.id, date, type: "income", description: "Income", amount: 100,
      })),
    ]);
    expect(responses.every(r => [200, 201].includes(r.status))).toBe(true);
    const entries = await testPrisma.transaction.findMany({ where: { accountId: account.id } });
    const saved = await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(saved.balance).toBe(1000 + entries.reduce((sum, entry) => sum + entry.amount, 0));
  });
});
