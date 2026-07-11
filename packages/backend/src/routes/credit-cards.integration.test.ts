import { describe, expect, it, vi } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { createAccount, createBilling, createCreditCard } from "../test-helpers/fixtures";
import { testPrisma } from "../test-helpers/db";

const client = createTestClient();

describe("credit cards routes", () => {
  it("returns active cards ordered by sortOrder with the account relation", async () => {
    const account = await createAccount(testPrisma, { name: "Settlement" });
    const deleted = await createCreditCard(testPrisma, {
      name: "Deleted",
      accountId: account.id,
      sortOrder: 0,
      deletedAt: new Date("2026-03-14T00:00:00.000Z"),
    });
    const second = await createCreditCard(testPrisma, {
      name: "Second",
      accountId: account.id,
      sortOrder: 2,
    });
    const first = await createCreditCard(testPrisma, {
      name: "First",
      accountId: account.id,
      sortOrder: 1,
    });

    const response = await client.get("/api/credit-cards");
    const body = await parseJson<Array<{ id: string; account: { id: string } | null }>>(response);

    expect(response.status).toBe(200);
    expect(body.map((card) => card.id)).toEqual([first.id, second.id]);
    expect(body.every((card) => card.account?.id === account.id)).toBe(true);
    expect(body.some((card) => card.id === deleted.id)).toBe(false);
  });

  it("creates a card with assumptionAmount, updates it, and soft deletes it", async () => {
    const account = await createAccount(testPrisma, { name: "Settlement" });

    const create = await client.post("/api/credit-cards", {
      name: "Visa",
      settlementDay: 27,
      accountId: account.id,
      assumptionAmount: 42000,
      sortOrder: 3,
    });
    const created = await parseJson<{ id: string }>(create);

    expect(create.status).toBe(201);

    const saved = await testPrisma.creditCard.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(saved.assumptionAmount).toBe(42000);

    const update = await client.put(`/api/credit-cards/${created.id}`, {
      name: "Visa Gold",
      settlementDay: 15,
      accountId: account.id,
      assumptionAmount: 43000,
      sortOrder: 4,
    });

    expect(update.status).toBe(200);
    expect(await parseJson(update)).toMatchObject({
      id: created.id,
      settlementDay: 15,
      assumptionAmount: 43000,
    });

    const remove = await client.delete(`/api/credit-cards/${created.id}`);
    expect(remove.status).toBe(204);

    const deleted = await testPrisma.creditCard.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(deleted.deletedAt).not.toBeNull();
  });

  it("round-trips dateShiftPolicy and preserves it when omitted on update", async () => {
    const account = await createAccount(testPrisma, { name: "Settlement" });

    const create = await client.post("/api/credit-cards", {
      name: "Visa",
      settlementDay: 31,
      dateShiftPolicy: "next",
      accountId: account.id,
      assumptionAmount: 42000,
      sortOrder: 3,
    });
    const created = await parseJson<{ id: string; dateShiftPolicy: string }>(create);
    expect(created.dateShiftPolicy).toBe("next");

    const update = await client.put(`/api/credit-cards/${created.id}`, {
      name: "Visa Gold",
      settlementDay: 31,
      accountId: account.id,
      assumptionAmount: 43000,
      sortOrder: 4,
    });
    const updated = await parseJson<{ dateShiftPolicy: string }>(update);
    expect(updated.dateShiftPolicy).toBe("next");
  });

  it("suggests the average actual amount from the past six months", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T00:00:00.000Z"));

    const account = await createAccount(testPrisma, { name: "Settlement" });
    const card = await createCreditCard(testPrisma, {
      name: "Visa",
      accountId: account.id,
    });
    await createBilling(testPrisma, {
      yearMonth: "2026-01",
      items: [{ creditCardId: card.id, amount: 10000 }],
    });
    await createBilling(testPrisma, {
      yearMonth: "2026-02",
      items: [{ creditCardId: card.id, amount: 30000 }],
    });
    await createBilling(testPrisma, {
      yearMonth: "2026-03",
      items: [{ creditCardId: card.id, amount: 20000 }],
    });

    const response = await client.get(`/api/credit-cards/${card.id}/assumption-suggestion?months=6`);

    expect(response.status).toBe(200);
    expect(await parseJson(response)).toEqual({
      creditCardId: card.id,
      method: "average",
      months: 6,
      sampleCount: 3,
      sourceYearMonths: ["2026-01", "2026-02", "2026-03"],
      suggestedAmount: 20000,
    });
  });

  it("ceils the fractional average and excludes zero, current, future, and older months", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T00:00:00.000Z"));

    const account = await createAccount(testPrisma, { name: "Settlement" });
    const card = await createCreditCard(testPrisma, {
      name: "Visa",
      accountId: account.id,
    });
    await createBilling(testPrisma, {
      yearMonth: "2025-11",
      items: [{ creditCardId: card.id, amount: 999999 }],
    });
    await createBilling(testPrisma, {
      yearMonth: "2026-02",
      items: [{ creditCardId: card.id, amount: 10000 }],
    });
    await createBilling(testPrisma, {
      yearMonth: "2026-03",
      items: [{ creditCardId: card.id, amount: 0 }],
    });
    await createBilling(testPrisma, {
      yearMonth: "2026-04",
      items: [{ creditCardId: card.id, amount: 20000 }],
    });
    await createBilling(testPrisma, {
      yearMonth: "2026-05",
      items: [{ creditCardId: card.id, amount: 30001 }],
    });
    await createBilling(testPrisma, {
      yearMonth: "2026-06",
      items: [{ creditCardId: card.id, amount: 30000 }],
    });
    await createBilling(testPrisma, {
      yearMonth: "2026-07",
      items: [{ creditCardId: card.id, amount: 40000 }],
    });

    const response = await client.get(`/api/credit-cards/${card.id}/assumption-suggestion?months=6`);

    expect(response.status).toBe(200);
    expect(await parseJson(response)).toMatchObject({
      method: "average",
      sampleCount: 3,
      sourceYearMonths: ["2026-02", "2026-04", "2026-05"],
      suggestedAmount: 20001,
    });
  });

  it("returns the single positive sample as the suggested amount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T00:00:00.000Z"));

    const account = await createAccount(testPrisma, { name: "Settlement" });
    const card = await createCreditCard(testPrisma, {
      name: "Visa",
      accountId: account.id,
    });
    await createBilling(testPrisma, {
      yearMonth: "2026-04",
      items: [{ creditCardId: card.id, amount: 15000 }],
    });

    const response = await client.get(`/api/credit-cards/${card.id}/assumption-suggestion?months=6`);

    expect(response.status).toBe(200);
    expect(await parseJson(response)).toEqual({
      creditCardId: card.id,
      method: "average",
      months: 6,
      sampleCount: 1,
      sourceYearMonths: ["2026-04"],
      suggestedAmount: 15000,
    });
  });

  it("returns null when there are no suggestion samples", async () => {
    const account = await createAccount(testPrisma, { name: "Settlement" });
    const card = await createCreditCard(testPrisma, {
      name: "Visa",
      accountId: account.id,
    });

    const response = await client.get(`/api/credit-cards/${card.id}/assumption-suggestion`);

    expect(response.status).toBe(200);
    expect(await parseJson(response)).toMatchObject({
      creditCardId: card.id,
      method: "average",
      sampleCount: 0,
      sourceYearMonths: [],
      suggestedAmount: null,
    });
  });

  it("returns 404 for deleted cards when suggesting an assumption amount", async () => {
    const account = await createAccount(testPrisma, { name: "Settlement" });
    const deleted = await createCreditCard(testPrisma, {
      name: "Deleted",
      accountId: account.id,
      deletedAt: new Date("2026-03-14T00:00:00.000Z"),
    });

    const response = await client.get(`/api/credit-cards/${deleted.id}/assumption-suggestion`);

    expect(response.status).toBe(404);
  });
});
