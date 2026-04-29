import { describe, expect, it } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { createAccount, createRecurringItem } from "../test-helpers/fixtures";
import { testPrisma } from "../test-helpers/db";

const client = createTestClient();

describe("recurring items routes", () => {
  it("returns non-deleted items ordered by sortOrder", async () => {
    const account = await createAccount(testPrisma, { name: "Main" });
    const deleted = await createRecurringItem(testPrisma, {
      name: "Deleted",
      accountId: account.id,
      sortOrder: 0,
      deletedAt: new Date("2026-03-14T00:00:00.000Z"),
    });
    const second = await createRecurringItem(testPrisma, {
      name: "Second",
      accountId: account.id,
      sortOrder: 2,
      enabled: false,
    });
    const first = await createRecurringItem(testPrisma, {
      name: "First",
      accountId: account.id,
      sortOrder: 1,
    });

    const response = await client.get("/api/recurring-items");
    const body = await parseJson<Array<{ id: string }>>(response);

    expect(response.status).toBe(200);
    expect(body.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(body.some((item) => item.id === deleted.id)).toBe(false);
  });

  it("creates income and expense items and stores the account relation", async () => {
    const account = await createAccount(testPrisma, { name: "Main" });

    const income = await client.post("/api/recurring-items", {
      name: "Salary",
      type: "income",
      amount: 300000,
      dayOfMonth: 25,
      startDate: "2026-03-01",
      endDate: null,
      accountId: account.id,
      enabled: true,
      sortOrder: 1,
    });
    const expense = await client.post("/api/recurring-items", {
      name: "Rent",
      type: "expense",
      amount: 80000,
      dayOfMonth: 27,
      startDate: null,
      endDate: "2026-12-31",
      accountId: account.id,
      enabled: true,
      sortOrder: 2,
    });

    expect(income.status).toBe(201);
    expect(expense.status).toBe(201);

    const createdIncome = await parseJson<{ id: string }>(income);
    const saved = await testPrisma.recurringItem.findUniqueOrThrow({
      where: { id: createdIncome.id },
    });
    expect(saved.accountId).toBe(account.id);
    expect(saved.type).toBe("income");
  });

  it("round-trips dateShiftPolicy and preserves it when omitted on update", async () => {
    const account = await createAccount(testPrisma, { name: "Main" });

    const create = await client.post("/api/recurring-items", {
      name: "Rent",
      type: "expense",
      amount: 80000,
      dayOfMonth: 31,
      startDate: null,
      endDate: null,
      dateShiftPolicy: "next",
      accountId: account.id,
      enabled: true,
      sortOrder: 1,
    });
    const created = await parseJson<{ id: string; dateShiftPolicy: string }>(create);
    expect(created.dateShiftPolicy).toBe("next");

    const update = await client.put(`/api/recurring-items/${created.id}`, {
      name: "Rent Updated",
      type: "expense",
      amount: 81000,
      dayOfMonth: 31,
      startDate: null,
      endDate: null,
      accountId: account.id,
      enabled: true,
      sortOrder: 2,
    });
    const updated = await parseJson<{ dateShiftPolicy: string }>(update);
    expect(updated.dateShiftPolicy).toBe("next");

    const list = await parseJson<Array<{ id: string; dateShiftPolicy: string }>>(await client.get("/api/recurring-items"));
    expect(list.find((item) => item.id === created.id)?.dateShiftPolicy).toBe("next");
  });

  it("rejects periods where startDate is after endDate", async () => {
    const account = await createAccount(testPrisma, { name: "Main" });

    const response = await client.post("/api/recurring-items", {
      name: "Invalid",
      type: "expense",
      amount: 1000,
      dayOfMonth: 10,
      startDate: "2026-04-01",
      endDate: "2026-03-01",
      accountId: account.id,
      enabled: true,
      sortOrder: 1,
    });

    expect(response.status).toBe(400);
    expect(await parseJson(response)).toEqual({
      error: "startDate must be less than or equal to endDate",
    });
  });

  it("updates and soft deletes recurring items", async () => {
    const account = await createAccount(testPrisma, { name: "Main" });
    const item = await createRecurringItem(testPrisma, {
      name: "Before",
      accountId: account.id,
      amount: 1000,
      dayOfMonth: 10,
      sortOrder: 1,
    });

    const update = await client.put(`/api/recurring-items/${item.id}`, {
      name: "After",
      type: "income",
      amount: 2500,
      dayOfMonth: 28,
      startDate: "2026-03-01",
      endDate: null,
      accountId: account.id,
      enabled: false,
      sortOrder: 9,
    });

    expect(update.status).toBe(200);
    expect(await parseJson(update)).toMatchObject({
      id: item.id,
      name: "After",
      type: "income",
      amount: 2500,
      enabled: false,
    });

    const remove = await client.delete(`/api/recurring-items/${item.id}`);
    expect(remove.status).toBe(204);

    const deleted = await testPrisma.recurringItem.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(deleted.deletedAt).not.toBeNull();
  });
});
