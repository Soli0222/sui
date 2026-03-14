import { describe, expect, it, vi } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { createAccount, createBilling, createCreditCard } from "../test-helpers/fixtures";
import { testPrisma } from "../test-helpers/db";

const client = createTestClient();

describe("billings routes", () => {
  it("rejects requests without a valid month query", async () => {
    const missing = await client.get("/api/billings");
    const invalid = await client.get("/api/billings?month=2026/03");

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
  });

  it("returns assumption totals for a future month without billing data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const account = await createAccount(testPrisma, { name: "Main" });
    await createCreditCard(testPrisma, {
      name: "Visa",
      accountId: account.id,
      assumptionAmount: 10000,
      sortOrder: 1,
    });
    await createCreditCard(testPrisma, {
      name: "Master",
      accountId: account.id,
      assumptionAmount: 20000,
      sortOrder: 2,
    });

    const response = await client.get("/api/billings?month=2026-03");

    expect(response.status).toBe(200);
    expect(await parseJson(response)).toEqual({
      yearMonth: "2026-03",
      settlementDate: null,
      resolvedSettlementDate: null,
      items: [],
      total: 0,
      appliedTotal: 30000,
      safetyValveActive: false,
      sourceType: "assumption",
      monthOffset: 0,
    });
  });

  it("returns saved items and applies assumptions to cards without actuals", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const account = await createAccount(testPrisma, { name: "Main" });
    const actualCard = await createCreditCard(testPrisma, {
      name: "Actual",
      accountId: account.id,
      assumptionAmount: 10000,
      sortOrder: 1,
    });
    const assumptionCard = await createCreditCard(testPrisma, {
      name: "Assumption",
      accountId: account.id,
      assumptionAmount: 20000,
      sortOrder: 2,
    });

    await createBilling(testPrisma, {
      yearMonth: "2026-03",
      settlementDate: new Date("2026-03-27T00:00:00.000Z"),
      items: [{ creditCardId: actualCard.id, amount: 12345 }],
    });

    const response = await client.get("/api/billings?month=2026-03");

    expect(response.status).toBe(200);
    expect(await parseJson(response)).toEqual({
      yearMonth: "2026-03",
      settlementDate: "2026-03-27",
      resolvedSettlementDate: "2026-03-27",
      items: [{ creditCardId: actualCard.id, amount: 12345 }],
      total: 12345,
      appliedTotal: 32345,
      safetyValveActive: false,
      sourceType: "actual",
      monthOffset: 0,
    });
    expect(assumptionCard.id).toBeTruthy();
  });

  it("keeps actual values for the current and next month even when they are below assumptions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const account = await createAccount(testPrisma, { name: "Main" });
    const currentCard = await createCreditCard(testPrisma, {
      name: "Current",
      accountId: account.id,
      assumptionAmount: 10000,
      sortOrder: 1,
    });
    const nextCard = await createCreditCard(testPrisma, {
      name: "Next",
      accountId: account.id,
      assumptionAmount: 20000,
      sortOrder: 2,
    });

    await createBilling(testPrisma, {
      yearMonth: "2026-03",
      items: [{ creditCardId: currentCard.id, amount: 5000 }],
    });
    await createBilling(testPrisma, {
      yearMonth: "2026-04",
      items: [{ creditCardId: nextCard.id, amount: 6000 }],
    });

    const [currentResponse, nextResponse] = await Promise.all([
      client.get("/api/billings?month=2026-03"),
      client.get("/api/billings?month=2026-04"),
    ]);

    expect(await parseJson(currentResponse)).toMatchObject({
      total: 5000,
      appliedTotal: 25000,
      safetyValveActive: false,
      sourceType: "actual",
      monthOffset: 0,
    });
    expect(await parseJson(nextResponse)).toMatchObject({
      total: 6000,
      appliedTotal: 16000,
      safetyValveActive: false,
      sourceType: "actual",
      monthOffset: 1,
    });
  });

  it("applies the safety valve from two months ahead onward when actuals are below assumptions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const account = await createAccount(testPrisma, { name: "Main" });
    const safetyValveCard = await createCreditCard(testPrisma, {
      name: "Future",
      accountId: account.id,
      assumptionAmount: 10000,
      sortOrder: 1,
    });
    await createCreditCard(testPrisma, {
      name: "Other",
      accountId: account.id,
      assumptionAmount: 20000,
      sortOrder: 2,
    });

    await createBilling(testPrisma, {
      yearMonth: "2026-05",
      items: [{ creditCardId: safetyValveCard.id, amount: 5000 }],
    });

    const response = await client.get("/api/billings?month=2026-05");

    expect(response.status).toBe(200);
    expect(await parseJson(response)).toEqual({
      yearMonth: "2026-05",
      settlementDate: null,
      resolvedSettlementDate: null,
      items: [{ creditCardId: safetyValveCard.id, amount: 5000 }],
      total: 5000,
      appliedTotal: 30000,
      safetyValveActive: true,
      sourceType: "safety-valve",
      monthOffset: 2,
    });
  });

  it("upserts, overwrites, clears settlement dates, and validates yearMonth", async () => {
    const account = await createAccount(testPrisma, { name: "Main" });
    const firstCard = await createCreditCard(testPrisma, {
      name: "First",
      accountId: account.id,
      assumptionAmount: 10000,
      sortOrder: 1,
    });
    const secondCard = await createCreditCard(testPrisma, {
      name: "Second",
      accountId: account.id,
      assumptionAmount: 20000,
      sortOrder: 2,
    });

    const create = await client.put("/api/billings/2026-04", {
      settlementDate: "2026-04-28",
      items: [{ creditCardId: firstCard.id, amount: 11111 }],
    });

    expect(create.status).toBe(200);
    expect(await parseJson(create)).toMatchObject({
      yearMonth: "2026-04",
      settlementDate: "2026-04-28",
      total: 11111,
      items: [{ creditCardId: firstCard.id, amount: 11111 }],
    });

    const overwrite = await client.put("/api/billings/2026-04", {
      items: [{ creditCardId: secondCard.id, amount: 22222 }],
    });

    expect(overwrite.status).toBe(200);
    expect(await parseJson(overwrite)).toMatchObject({
      yearMonth: "2026-04",
      settlementDate: null,
      items: [{ creditCardId: secondCard.id, amount: 22222 }],
      total: 22222,
      appliedTotal: 32222,
      safetyValveActive: false,
      sourceType: "actual",
      monthOffset: 1,
    });

    const stored = await testPrisma.creditCardBilling.findUniqueOrThrow({
      where: { yearMonth: "2026-04" },
      include: { items: true },
    });
    expect(stored.settlementDate).toBeNull();
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0]?.creditCardId).toBe(secondCard.id);

    const invalid = await client.put("/api/billings/2026-4", {
      items: [],
    });
    expect(invalid.status).toBe(400);
  });

  it("returns safety-valve totals in the PUT response for months two or more ahead", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const account = await createAccount(testPrisma, { name: "Main" });
    const card = await createCreditCard(testPrisma, {
      name: "Future",
      accountId: account.id,
      assumptionAmount: 10000,
      sortOrder: 1,
    });

    const response = await client.put("/api/billings/2026-05", {
      items: [{ creditCardId: card.id, amount: 5000 }],
    });

    expect(response.status).toBe(200);
    expect(await parseJson(response)).toMatchObject({
      yearMonth: "2026-05",
      total: 5000,
      appliedTotal: 10000,
      safetyValveActive: true,
      sourceType: "safety-valve",
      monthOffset: 2,
    });
  });

  it("returns 400 when a billing item amount exceeds the int32 limit", async () => {
    const account = await createAccount(testPrisma, { name: "Main" });
    const card = await createCreditCard(testPrisma, {
      name: "Future",
      accountId: account.id,
      assumptionAmount: 10000,
      sortOrder: 1,
    });

    const response = await client.put("/api/billings/2026-05", {
      items: [{ creditCardId: card.id, amount: 11_111_111_111 }],
    });

    expect(response.status).toBe(400);
    expect(await parseJson(response)).toMatchObject({
      error: "Validation failed",
    });
  });
});
