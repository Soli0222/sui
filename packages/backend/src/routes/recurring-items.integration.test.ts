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

  it("creates transfer items and stores the destination account relation", async () => {
    const source = await createAccount(testPrisma, { name: "Source" });
    const destination = await createAccount(testPrisma, { name: "Destination" });

    const response = await client.post("/api/recurring-items", {
      name: "Monthly Move",
      type: "transfer",
      amount: 50000,
      dayOfMonth: 20,
      startDate: null,
      endDate: null,
      accountId: source.id,
      transferToAccountId: destination.id,
      enabled: true,
      sortOrder: 3,
    });

    expect(response.status).toBe(201);
    const created = await parseJson<{
      id: string;
      type: string;
      accountId: string;
      transferToAccountId: string;
      transferToAccount: { name: string };
    }>(response);
    expect(created).toMatchObject({
      type: "transfer",
      accountId: source.id,
      transferToAccountId: destination.id,
      transferToAccount: { name: "Destination" },
    });

    const saved = await testPrisma.recurringItem.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(saved.transferToAccountId).toBe(destination.id);
  });

  it("validates transfer account rules", async () => {
    const source = await createAccount(testPrisma, { name: "Source" });
    const destination = await createAccount(testPrisma, { name: "Destination" });
    const usdDestination = await createAccount(testPrisma, {
      name: "USD Destination",
      currencyCode: "USD",
      exchangeRateToJpy: 150,
    });

    const sameAccount = await client.post("/api/recurring-items", {
      name: "Same Account",
      type: "transfer",
      amount: 1000,
      dayOfMonth: 10,
      startDate: null,
      endDate: null,
      accountId: source.id,
      transferToAccountId: source.id,
      enabled: true,
      sortOrder: 1,
    });
    const crossCurrency = await client.post("/api/recurring-items", {
      name: "Cross Currency",
      type: "transfer",
      amount: 1000,
      dayOfMonth: 10,
      startDate: null,
      endDate: null,
      accountId: source.id,
      transferToAccountId: usdDestination.id,
      enabled: true,
      sortOrder: 1,
    });
    const incomeWithTransferTo = await client.post("/api/recurring-items", {
      name: "Invalid Income",
      type: "income",
      amount: 1000,
      dayOfMonth: 10,
      startDate: null,
      endDate: null,
      accountId: source.id,
      transferToAccountId: destination.id,
      enabled: true,
      sortOrder: 1,
    });

    expect(sameAccount.status).toBe(400);
    expect(await parseJson(sameAccount)).toEqual({ error: "transfer accounts must be different" });
    expect(crossCurrency.status).toBe(400);
    expect(await parseJson(crossCurrency)).toEqual({ error: "Cross-currency transfers are not supported" });
    expect(incomeWithTransferTo.status).toBe(400);
    expect(await parseJson(incomeWithTransferTo)).toEqual({
      error: "transferToAccountId is only allowed for transfer",
    });
  });

  it("allows one-sided transfer recurring items and rejects both accounts missing", async () => {
    const source = await createAccount(testPrisma, { name: "Source" });
    const destination = await createAccount(testPrisma, { name: "Destination" });

    const sourceOnly = await client.post("/api/recurring-items", {
      name: "External Out",
      type: "transfer",
      amount: 10000,
      dayOfMonth: 10,
      startDate: null,
      endDate: null,
      accountId: source.id,
      transferToAccountId: null,
      enabled: true,
      sortOrder: 1,
    });

    const destinationOnly = await client.post("/api/recurring-items", {
      name: "External In",
      type: "transfer",
      amount: 10000,
      dayOfMonth: 10,
      startDate: null,
      endDate: null,
      accountId: null,
      transferToAccountId: destination.id,
      enabled: true,
      sortOrder: 2,
    });

    const bothNull = await client.post("/api/recurring-items", {
      name: "No Accounts",
      type: "transfer",
      amount: 10000,
      dayOfMonth: 10,
      startDate: null,
      endDate: null,
      accountId: null,
      transferToAccountId: null,
      enabled: true,
      sortOrder: 3,
    });

    expect(sourceOnly.status).toBe(201);
    const sourceOnlyBody = await parseJson<{ accountId: string | null; transferToAccountId: string | null }>(sourceOnly);
    expect(sourceOnlyBody.accountId).toBe(source.id);
    expect(sourceOnlyBody.transferToAccountId).toBeNull();

    expect(destinationOnly.status).toBe(201);
    const destinationOnlyBody = await parseJson<{ accountId: string | null; transferToAccountId: string | null }>(destinationOnly);
    expect(destinationOnlyBody.accountId).toBeNull();
    expect(destinationOnlyBody.transferToAccountId).toBe(destination.id);

    expect(bothNull.status).toBe(400);
    expect(await parseJson(bothNull)).toEqual({
      error: "accountId or transferToAccountId is required for transfer",
    });
  });

  it("rejects non-transfer recurring items without accountId", async () => {
    const missingAccount = await client.post("/api/recurring-items", {
      name: "Missing Account",
      type: "expense",
      amount: 1000,
      dayOfMonth: 10,
      startDate: null,
      endDate: null,
      accountId: null,
      enabled: true,
      sortOrder: 1,
    });

    expect(missingAccount.status).toBe(400);
    expect(await parseJson(missingAccount)).toEqual({ error: "accountId is required" });
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

  it("creates and updates a weekly recurring item", async () => {
    const account = await createAccount(testPrisma, { name: "Main" });

    const create = await client.post("/api/recurring-items", {
      name: "Weekly",
      type: "expense",
      amount: 1000,
      recurrence: "weekly",
      dayOfWeek: 5,
      dayOfMonth: null,
      startDate: null,
      endDate: null,
      accountId: account.id,
      enabled: true,
      sortOrder: 1,
    });
    const created = await parseJson<{ id: string; recurrence: string; dayOfWeek: number | null; dayOfMonth: number | null }>(create);

    expect(create.status).toBe(201);
    expect(created.recurrence).toBe("weekly");
    expect(created.dayOfWeek).toBe(5);
    expect(created.dayOfMonth).toBeNull();

    const update = await client.put(`/api/recurring-items/${created.id}`, {
      name: "Weekly",
      type: "expense",
      amount: 1000,
      recurrence: "weekly",
      dayOfWeek: 6,
      dayOfMonth: null,
      startDate: null,
      endDate: null,
      accountId: account.id,
      enabled: true,
      sortOrder: 1,
    });
    const updated = await parseJson<{ dayOfWeek: number | null }>(update);
    expect(updated.dayOfWeek).toBe(6);

    const list = await parseJson<Array<{ id: string; recurrence: string }>>(await client.get("/api/recurring-items"));
    expect(list.find((item) => item.id === created.id)?.recurrence).toBe("weekly");
  });

  it("infers monthly recurrence when dayOfMonth is given and rejects weekly with dayOfMonth", async () => {
    const account = await createAccount(testPrisma, { name: "Main" });

    const inferredMonthly = await client.post("/api/recurring-items", {
      name: "Inferred Monthly",
      type: "expense",
      amount: 1000,
      dayOfMonth: 10,
      startDate: null,
      endDate: null,
      accountId: account.id,
      enabled: true,
      sortOrder: 1,
    });
    expect(inferredMonthly.status).toBe(201);
    const inferred = await parseJson<{ recurrence: string }>(inferredMonthly);
    expect(inferred.recurrence).toBe("monthly");

    const conflicting = await client.post("/api/recurring-items", {
      name: "Conflicting",
      type: "expense",
      amount: 1000,
      recurrence: "weekly",
      dayOfWeek: 5,
      dayOfMonth: 10,
      startDate: null,
      endDate: null,
      accountId: account.id,
      enabled: true,
      sortOrder: 1,
    });
    expect(conflicting.status).toBe(400);
  });
});
