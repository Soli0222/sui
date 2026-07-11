import type { DataExportResponse } from "@sui/shared";
import { describe, expect, it, vi } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import {
  createAccount,
  createBilling,
  createCreditCard,
  createLoan,
  createRecurringItem,
  createSubscription,
  createTransaction,
} from "../test-helpers/fixtures";
import { testPrisma } from "../test-helpers/db";

const client = createTestClient();

async function exportData() {
  const response = await client.get("/api/export");
  expect(response.status).toBe(200);
  return parseJson<DataExportResponse>(response);
}

async function seedBackupDataset() {
  const main = await createAccount(testPrisma, {
    name: "Main",
    balance: 250000,
    balanceOffset: 30000,
    lastReconciledAt: new Date("2026-06-30T10:00:00.000Z"),
    sortOrder: 1,
  });
  const savings = await createAccount(testPrisma, {
    name: "Savings",
    balance: 800000,
    sortOrder: 2,
  });
  const deletedAccount = await createAccount(testPrisma, {
    name: "Deleted",
    balance: 100,
    sortOrder: 99,
    deletedAt: new Date("2026-07-01T00:00:00.000Z"),
  });

  const activeCard = await createCreditCard(testPrisma, {
    name: "Main Card",
    accountId: main.id,
    settlementDay: 27,
    assumptionAmount: 120000,
    sortOrder: 1,
  });
  const deletedCard = await createCreditCard(testPrisma, {
    name: "Deleted Card",
    accountId: deletedAccount.id,
    assumptionAmount: 1000,
    sortOrder: 2,
    deletedAt: new Date("2026-07-02T00:00:00.000Z"),
  });

  await createRecurringItem(testPrisma, {
    name: "Salary",
    type: "income",
    amount: 350000,
    dayOfMonth: 25,
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    endDate: null,
    accountId: main.id,
    sortOrder: 1,
  });
  await createRecurringItem(testPrisma, {
    name: "Savings transfer",
    type: "transfer",
    amount: 50000,
    dayOfMonth: 1,
    accountId: main.id,
    transferToAccountId: savings.id,
    sortOrder: 2,
  });
  await createRecurringItem(testPrisma, {
    name: "External out",
    type: "transfer",
    amount: 10000,
    dayOfMonth: 2,
    accountId: main.id,
    transferToAccountId: null,
    sortOrder: 4,
  });
  await createRecurringItem(testPrisma, {
    name: "External in",
    type: "transfer",
    amount: 20000,
    dayOfMonth: 3,
    accountId: null,
    transferToAccountId: savings.id,
    sortOrder: 5,
  });
  await createRecurringItem(testPrisma, {
    name: "Deleted recurring",
    type: "expense",
    amount: 1000,
    dayOfMonth: 5,
    accountId: deletedAccount.id,
    sortOrder: 3,
    deletedAt: new Date("2026-07-03T00:00:00.000Z"),
  });

  await createSubscription(testPrisma, {
    name: "Cloud",
    amount: 1200,
    intervalMonths: 1,
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    dayOfMonth: 10,
    paymentSource: "Main Card",
  });
  await createSubscription(testPrisma, {
    name: "Deleted subscription",
    amount: 500,
    startDate: new Date("2026-01-01T00:00:00.000Z"),
    dayOfMonth: 11,
    deletedAt: new Date("2026-07-03T00:00:00.000Z"),
  });

  await createLoan(testPrisma, {
    name: "Car loan",
    totalAmount: 600000,
    paymentCount: 24,
    startDate: new Date("2026-04-01T00:00:00.000Z"),
    accountId: main.id,
  });
  await createLoan(testPrisma, {
    name: "Card installment",
    totalAmount: 120000,
    paymentCount: 6,
    startDate: new Date("2026-05-01T00:00:00.000Z"),
    paymentMethod: "credit_card",
    accountId: null,
    deletedAt: new Date("2026-07-03T00:00:00.000Z"),
  });

  await createBilling(testPrisma, {
    yearMonth: "2026-06",
    settlementDate: new Date("2026-07-27T00:00:00.000Z"),
    items: [
      { creditCardId: activeCard.id, amount: 123456 },
      { creditCardId: deletedCard.id, amount: 7890 },
    ],
  });

  await createTransaction(testPrisma, {
    accountId: main.id,
    date: new Date("2026-06-15T00:00:00.000Z"),
    type: "expense",
    description: "Groceries",
    amount: 5400,
  });
  await createTransaction(testPrisma, {
    accountId: main.id,
    transferToAccountId: savings.id,
    date: new Date("2026-06-20T00:00:00.000Z"),
    type: "transfer",
    description: "Move money",
    amount: 20000,
  });
  await createTransaction(testPrisma, {
    accountId: deletedAccount.id,
    date: new Date("2026-06-21T00:00:00.000Z"),
    type: "adjustment",
    description: "Deleted adjustment",
    amount: 100,
    deletedAt: new Date("2026-07-03T00:00:00.000Z"),
  });

  await testPrisma.setting.update({
    where: { key: "forecast_months" },
    data: { value: "18" },
  });
}

describe("data transfer routes", () => {
  it("exports all data and restores it with a replace import", async () => {
    vi.setSystemTime(new Date("2026-07-03T15:00:00.000Z"));
    await seedBackupDataset();

    const exportResponse = await client.get("/api/export");
    const firstExport = await parseJson<DataExportResponse>(exportResponse);

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("Content-Disposition")).toBe(
      'attachment; filename="sui-export-20260704.json"',
    );
    expect(firstExport.formatVersion).toBe(1);
    expect(firstExport.exportedAt).toBe("2026-07-03T15:00:00.000Z");
    expect(firstExport.data.accounts.some((account) => account.deletedAt !== null)).toBe(true);
    expect(firstExport.data.creditCardBillings[0]?.items).toHaveLength(2);

    await createAccount(testPrisma, {
      name: "Should be removed",
      balance: 999,
      sortOrder: 999,
    });

    const importResponse = await client.post("/api/import", {
      formatVersion: 1,
      mode: "replace",
      data: firstExport.data,
    });

    expect(importResponse.status).toBe(200);
    expect(await parseJson(importResponse)).toEqual({
      counts: {
        accounts: firstExport.data.accounts.length,
        recurringItems: firstExport.data.recurringItems.length,
        creditCards: firstExport.data.creditCards.length,
        creditCardBillings: firstExport.data.creditCardBillings.length,
        creditCardItems: firstExport.data.creditCardBillings.reduce((sum, billing) => sum + billing.items.length, 0),
        subscriptions: firstExport.data.subscriptions.length,
        loans: firstExport.data.loans.length,
        transactions: firstExport.data.transactions.length,
        settings: firstExport.data.settings.length,
      },
    });

    const secondExport = await exportData();
    expect(secondExport).toEqual(firstExport);
  });

  it.each([
    ["missing mode", { formatVersion: 1 }],
    ["wrong mode", { formatVersion: 1, mode: "merge" }],
  ])("returns 400 when import mode is invalid: %s", async (_name, body) => {
    const response = await client.post("/api/import", {
      ...body,
      data: {
        accounts: [],
        recurringItems: [],
        creditCards: [],
        creditCardBillings: [],
        subscriptions: [],
        loans: [],
        transactions: [],
        settings: [],
      },
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 when import formatVersion is unsupported", async () => {
    const response = await client.post("/api/import", {
      formatVersion: 2,
      mode: "replace",
      data: {
        accounts: [],
        recurringItems: [],
        creditCards: [],
        creditCardBillings: [],
        subscriptions: [],
        loans: [],
        transactions: [],
        settings: [],
      },
    });

    expect(response.status).toBe(400);
  });

  it("returns 400 and keeps existing data when import mode is missing or not replace", async () => {
    vi.setSystemTime(new Date("2026-07-03T15:00:00.000Z"));
    await createAccount(testPrisma, {
      name: "Existing",
      balance: 1234,
      sortOrder: 1,
    });
    const before = await exportData();
    const emptyData = {
      accounts: [],
      recurringItems: [],
      creditCards: [],
      creditCardBillings: [],
      subscriptions: [],
      loans: [],
      transactions: [],
      settings: [],
    };

    const missingMode = await client.post("/api/import", {
      formatVersion: 1,
      data: emptyData,
    });
    const wrongMode = await client.post("/api/import", {
      formatVersion: 1,
      mode: "merge",
      data: emptyData,
    });

    expect(missingMode.status).toBe(400);
    expect(wrongMode.status).toBe(400);
    expect((await exportData()).data).toEqual(before.data);
  });

  it("keeps existing data when import data validation fails", async () => {
    vi.setSystemTime(new Date("2026-07-03T15:00:00.000Z"));
    await createAccount(testPrisma, {
      name: "Existing",
      balance: 1234,
      sortOrder: 1,
    });
    const before = await exportData();

    const response = await client.post("/api/import", {
      formatVersion: 1,
      mode: "replace",
      data: {
        accounts: "not-an-array",
        recurringItems: [],
        creditCards: [],
        creditCardBillings: [],
        subscriptions: [],
        loans: [],
        transactions: [],
        settings: [],
      },
    });

    expect(response.status).toBe(400);
    expect((await exportData()).data).toEqual(before.data);
  });

  it("exports and imports weekly recurrence fields", async () => {
    vi.setSystemTime(new Date("2026-07-03T15:00:00.000Z"));
    const main = await createAccount(testPrisma, {
      name: "Main",
      balance: 250000,
      sortOrder: 1,
    });
    const weeklyRecurring = await createRecurringItem(testPrisma, {
      name: "Weekly",
      type: "expense",
      amount: 1000,
      recurrence: "weekly",
      dayOfWeek: 5,
      dayOfMonth: null,
      accountId: main.id,
      sortOrder: 1,
    });
    const weeklySubscription = await createSubscription(testPrisma, {
      name: "Weekly Sub",
      amount: 500,
      recurrence: "weekly",
      dayOfWeek: 0,
      dayOfMonth: null,
      intervalMonths: null,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
    });

    const firstExport = await exportData();
    const recurring = firstExport.data.recurringItems.find((item) => item.id === weeklyRecurring.id);
    const subscription = firstExport.data.subscriptions.find((item) => item.id === weeklySubscription.id);
    expect(recurring?.recurrence).toBe("weekly");
    expect(recurring?.dayOfWeek).toBe(5);
    expect(recurring?.dayOfMonth).toBeNull();
    expect(subscription?.recurrence).toBe("weekly");
    expect(subscription?.dayOfWeek).toBe(0);
    expect(subscription?.dayOfMonth).toBeNull();
    expect(subscription?.intervalMonths).toBeNull();

    await client.post("/api/import", {
      formatVersion: 1,
      mode: "replace",
      data: firstExport.data,
    });

    const secondExport = await exportData();
    expect(secondExport.data.recurringItems).toEqual(firstExport.data.recurringItems);
    expect(secondExport.data.subscriptions).toEqual(firstExport.data.subscriptions);
  });

  it("rejects import with inconsistent weekly fields", async () => {
    vi.setSystemTime(new Date("2026-07-03T15:00:00.000Z"));
    const before = await exportData();

    const response = await client.post("/api/import", {
      formatVersion: 1,
      mode: "replace",
      data: {
        ...before.data,
        recurringItems: [
          {
            id: "11111111-1111-4111-a111-111111111111",
            name: "Bad Weekly",
            type: "expense",
            amount: 1000,
            recurrence: "weekly",
            dayOfWeek: 5,
            dayOfMonth: 10,
            accountId: null,
            transferToAccountId: null,
            enabled: true,
            startDate: null,
            endDate: null,
            dateShiftPolicy: "none",
            sortOrder: 1,
            deletedAt: null,
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
          },
        ],
      },
    });

    expect(response.status).toBe(400);
    expect((await exportData()).data).toEqual(before.data);
  });

  it("imports pre-weekly formatVersion 1 data as monthly", async () => {
    vi.setSystemTime(new Date("2026-07-03T15:00:00.000Z"));
    const before = await exportData();

    const response = await client.post("/api/import", {
      formatVersion: 1,
      mode: "replace",
      data: {
        ...before.data,
        accounts: [
          {
            id: "11111111-1111-1111-a111-111111111111",
            name: "Main",
            balance: 100000,
            balanceOffset: 0,
            lastReconciledAt: null,
            currencyCode: "JPY",
            exchangeRateToJpy: 1,
            exchangeRateUpdatedAt: "2026-01-01T00:00:00.000Z",
            sortOrder: 1,
            deletedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        recurringItems: [
          {
            id: "22222222-2222-4222-a222-222222222222",
            name: "Rent",
            type: "expense",
            amount: 80000,
            dayOfMonth: 27,
            accountId: "11111111-1111-1111-a111-111111111111",
            transferToAccountId: null,
            enabled: true,
            startDate: null,
            endDate: null,
            dateShiftPolicy: "none",
            sortOrder: 1,
            deletedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        subscriptions: [
          {
            id: "33333333-3333-4333-a333-333333333333",
            name: "Cloud",
            amount: 1200,
            intervalMonths: 1,
            startDate: "2026-01-01T00:00:00.000Z",
            dayOfMonth: 10,
            endDate: null,
            paymentSource: "Card",
            deletedAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    });

    expect(response.status).toBe(200);

    const after = await exportData();
    const recurring = after.data.recurringItems.find((item) => item.id === "22222222-2222-4222-a222-222222222222");
    const subscription = after.data.subscriptions.find((item) => item.id === "33333333-3333-4333-a333-333333333333");

    expect(recurring).toMatchObject({
      recurrence: "monthly",
      dayOfMonth: 27,
      dayOfWeek: null,
    });
    expect(subscription).toMatchObject({
      recurrence: "monthly",
      intervalMonths: 1,
      dayOfMonth: 10,
      dayOfWeek: null,
    });
  });
});
