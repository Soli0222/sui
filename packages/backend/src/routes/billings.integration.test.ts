import { describe, expect, it, vi } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { createAccount, createBilling, createCreditCard } from "../test-helpers/fixtures";
import { testPrisma } from "../test-helpers/db";

const client = createTestClient();

describe("billings routes", () => {
  it("uses different amounts for consecutive periods on the same card", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T00:00:00.000Z"));
    const account = await createAccount(testPrisma, { name: "Main" });
    const card = await createCreditCard(testPrisma, { name: "Changing", accountId: account.id, assumptions: [
      { amount: 120000, startMonth: null, endMonth: "2026-10" },
      { amount: 80000, startMonth: "2026-12", endMonth: null },
    ] });
    expect(await parseJson(await client.get("/api/billings?month=2026-10"))).toMatchObject({ appliedTotal: 120000, sourceType: "assumption" });
    expect(await parseJson(await client.get("/api/billings?month=2026-11"))).toMatchObject({ appliedTotal: 0, sourceType: "none" });
    expect(await parseJson(await client.get("/api/billings?month=2026-12"))).toMatchObject({ appliedTotal: 80000, sourceType: "assumption" });
    const actual = await client.put("/api/billings/2026-11", { items: [{ creditCardId: card.id, amount: 30000 }] });
    expect(await parseJson(actual)).toMatchObject({ appliedTotal: 30000, sourceType: "actual", safetyValveActive: false });
  });
  it("uses only active assumptions and retains actuals for a replaced card", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T00:00:00.000Z"));
    const account = await createAccount(testPrisma, { name: "Main" });
    const oldCard = await createCreditCard(testPrisma, { name: "Old", accountId: account.id, assumptionAmount: 120000, assumptionEndMonth: "2026-10" });
    await createCreditCard(testPrisma, { name: "New", accountId: account.id, assumptionAmount: 120000, assumptionStartMonth: "2026-11" });

    const before = await client.get("/api/billings?month=2026-08");
    expect(await parseJson(before)).toMatchObject({ appliedTotal: 120000, sourceType: "assumption" });

    const october = await client.get("/api/billings?month=2026-10");
    expect(await parseJson(october)).toMatchObject({ appliedTotal: 120000, safetyValveActive: false });
    const november = await client.get("/api/billings?month=2026-11");
    expect(await parseJson(november)).toMatchObject({ appliedTotal: 120000, safetyValveActive: false });

    const saved = await client.put("/api/billings/2026-11", { items: [{ creditCardId: oldCard.id, amount: 30000 }] });
    expect(await parseJson(saved)).toMatchObject({ appliedTotal: 150000, safetyValveActive: false, sourceType: "actual" });
    const reloaded = await client.get("/api/billings?month=2026-11");
    expect(await parseJson(reloaded)).toMatchObject({ appliedTotal: 150000, safetyValveActive: false });
  });
  it("rejects requests without a valid month query", async () => {
    const missing = await client.get("/api/billings");
    const invalid = await client.get("/api/billings?month=2025/09");

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
  });

  it("returns assumption totals for a future month without billing data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-09-07T00:00:00.000Z"));

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

    const response = await client.get("/api/billings?month=2025-09");

    expect(response.status).toBe(200);
    expect(await parseJson(response)).toEqual({
      yearMonth: "2025-09",
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
    vi.setSystemTime(new Date("2025-09-07T00:00:00.000Z"));

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
      yearMonth: "2025-09",
      settlementDate: new Date("2025-09-27T00:00:00.000Z"),
      items: [{ creditCardId: actualCard.id, amount: 12345 }],
    });

    const response = await client.get("/api/billings?month=2025-09");

    expect(response.status).toBe(200);
    expect(await parseJson(response)).toEqual({
      yearMonth: "2025-09",
      settlementDate: "2025-09-27",
      resolvedSettlementDate: "2025-09-27",
      items: [{ creditCardId: actualCard.id, amount: 12345 }],
      total: 12345,
      appliedTotal: 32345,
      safetyValveActive: false,
      sourceType: "actual",
      monthOffset: 0,
    });
    expect(assumptionCard.id).toBeTruthy();
  });

  it("keeps low actual values only for the current month and applies the safety valve from next month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-09-07T00:00:00.000Z"));

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
      yearMonth: "2025-09",
      items: [{ creditCardId: currentCard.id, amount: 5000 }],
    });
    await createBilling(testPrisma, {
      yearMonth: "2025-10",
      items: [{ creditCardId: nextCard.id, amount: 6000 }],
    });

    const [currentResponse, nextResponse] = await Promise.all([
      client.get("/api/billings?month=2025-09"),
      client.get("/api/billings?month=2025-10"),
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
      appliedTotal: 30000,
      safetyValveActive: true,
      sourceType: "safety-valve",
      monthOffset: 1,
    });
  });

  it("applies the safety valve from two months ahead onward when actuals are below assumptions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-09-07T00:00:00.000Z"));

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
      yearMonth: "2025-11",
      items: [{ creditCardId: safetyValveCard.id, amount: 5000 }],
    });

    const response = await client.get("/api/billings?month=2025-11");

    expect(response.status).toBe(200);
    expect(await parseJson(response)).toEqual({
      yearMonth: "2025-11",
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-09-07T00:00:00.000Z"));

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

    const create = await client.put("/api/billings/2025-10", {
      settlementDate: "2025-10-28",
      items: [{ creditCardId: firstCard.id, amount: 11111 }],
    });

    expect(create.status).toBe(200);
    expect(await parseJson(create)).toMatchObject({
      yearMonth: "2025-10",
      settlementDate: "2025-10-28",
      total: 11111,
      items: [{ creditCardId: firstCard.id, amount: 11111 }],
    });

    const overwrite = await client.put("/api/billings/2025-10", {
      items: [{ creditCardId: secondCard.id, amount: 22222 }],
    });

    expect(overwrite.status).toBe(200);
    expect(await parseJson(overwrite)).toMatchObject({
      yearMonth: "2025-10",
      settlementDate: null,
      items: [{ creditCardId: secondCard.id, amount: 22222 }],
      total: 22222,
      appliedTotal: 32222,
      safetyValveActive: false,
      sourceType: "actual",
      monthOffset: 1,
    });

    const stored = await testPrisma.creditCardBilling.findUniqueOrThrow({
      where: { yearMonth: "2025-10" },
      include: { items: true },
    });
    expect(stored.settlementDate).toBeNull();
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0]?.creditCardId).toBe(secondCard.id);

    const invalid = await client.put("/api/billings/2025-9", {
      items: [],
    });
    expect(invalid.status).toBe(400);
  });

  it("returns safety-valve totals in the PUT response for months two or more ahead", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-09-07T00:00:00.000Z"));

    const account = await createAccount(testPrisma, { name: "Main" });
    const card = await createCreditCard(testPrisma, {
      name: "Future",
      accountId: account.id,
      assumptionAmount: 10000,
      sortOrder: 1,
    });

    const response = await client.put("/api/billings/2025-11", {
      items: [{ creditCardId: card.id, amount: 5000 }],
    });

    expect(response.status).toBe(200);
    expect(await parseJson(response)).toMatchObject({
      yearMonth: "2025-11",
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

    const response = await client.put("/api/billings/2025-11", {
      items: [{ creditCardId: card.id, amount: 11_111_111_111 }],
    });

    expect(response.status).toBe(400);
    expect(await parseJson(response)).toMatchObject({
      error: "Validation failed",
    });
  });
});
