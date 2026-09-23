import { describe, expect, it } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { createSubscription } from "../test-helpers/fixtures";
import { testPrisma } from "../test-helpers/db";

const client = createTestClient();

describe("subscriptions routes", () => {
  it("manages price history with parent ownership, validation, and effective amounts", async () => {
    const parent = await createSubscription(testPrisma, { name: "Primary", amount: 1000, startDate: new Date("2026-01-01T00:00:00.000Z"), dayOfMonth: 1 });
    const other = await createSubscription(testPrisma, { name: "Other", amount: 900, startDate: new Date("2026-01-01T00:00:00.000Z"), dayOfMonth: 1 });
    const path = `/api/subscriptions/${parent.id}/amount-changes`;
    const createdResponse = await client.post(path, { effectiveFrom: "2026-07-01", amount: 1200 });
    expect(createdResponse.status).toBe(201);
    const created = await parseJson<{ id: string; subscriptionId: string; effectiveFrom: string; amount: number }>(createdResponse);
    expect(created).toMatchObject({ subscriptionId: parent.id, effectiveFrom: "2026-07-01", amount: 1200 });
    expect(await parseJson(await client.get(`/api/subscriptions/${parent.id}`))).toMatchObject({ id: parent.id, amount: 1000, amountChanges: [created] });
    const june = await parseJson<{ total: number; items: Array<{ subscription: { id: string }; amount: number }> }>(await client.get("/api/subscriptions/monthly/2026-06"));
    const july = await parseJson<{ total: number; items: Array<{ subscription: { id: string }; amount: number }> }>(await client.get("/api/subscriptions/monthly/2026-07"));
    expect(june.total).toBe(1900);
    expect(july.total).toBe(2100);
    expect(june.items.find((item) => item.subscription.id === parent.id)?.amount).toBe(1000);
    expect(july.items.find((item) => item.subscription.id === parent.id)?.amount).toBe(1200);
    expect((await client.get("/api/subscriptions/monthly/2026-13")).status).toBe(400);
    expect((await parseJson<Array<{ amountChanges: unknown[] }>>(await client.get("/api/subscriptions")))[0].amountChanges).toHaveLength(1);
    expect(await parseJson(await client.get(path))).toMatchObject([created]);

    expect((await client.post(path, { effectiveFrom: "2026-07-01", amount: 1300 })).status).toBe(409);
    expect((await client.post(path, { effectiveFrom: "2026-02-30", amount: 1300 })).status).toBe(400);
    expect((await client.post(path, { effectiveFrom: "2026-08-01", amount: 2147483648 })).status).toBe(400);
    expect((await client.put(`/api/subscriptions/${other.id}/amount-changes/${created.id}`, { effectiveFrom: "2026-08-01", amount: 1400 })).status).toBe(404);
    expect((await client.delete(`/api/subscriptions/${other.id}/amount-changes/${created.id}`)).status).toBe(404);

    const updated = await client.put(`${path}/${created.id}`, { effectiveFrom: "2026-08-01", amount: 1400 });
    expect(updated.status).toBe(200);
    expect(await parseJson(updated)).toMatchObject({ id: created.id, effectiveFrom: "2026-08-01", amount: 1400 });
    expect((await client.delete(`${path}/${created.id}`)).status).toBe(204);
    expect(await parseJson(await client.get(path))).toEqual([]);

    await client.delete(`/api/subscriptions/${parent.id}`);
    expect((await client.post(path, { effectiveFrom: "2026-09-01", amount: 1500 })).status).toBe(404);
    expect((await client.get(path)).status).toBe(404);
  });
  it("returns non-deleted subscriptions", async () => {
    const active = await createSubscription(testPrisma, {
      name: "Active",
      amount: 1200,
      interval: 1,
      startDate: new Date("2026-01-05T00:00:00.000Z"),
      dayOfMonth: 5,
    });
    const deleted = await createSubscription(testPrisma, {
      name: "Deleted",
      amount: 999,
      interval: 1,
      startDate: new Date("2026-01-10T00:00:00.000Z"),
      dayOfMonth: 10,
      deletedAt: new Date("2026-03-14T00:00:00.000Z"),
    });

    const response = await client.get("/api/subscriptions");
    const body = await parseJson<Array<{ id: string }>>(response);

    expect(response.status).toBe(200);
    expect(body.map((item) => item.id)).toEqual([active.id]);
    expect(body.some((item) => item.id === deleted.id)).toBe(false);
  });

  it("creates a subscription and normalizes nullable fields", async () => {
    const response = await client.post("/api/subscriptions", {
      name: "Netflix",
      amount: 1490,
      interval: 1,
      startDate: "2026-03-05",
      dayOfMonth: 5,
      endDate: null,
      paymentSource: "  Visa Gold  ",
    });

    const created = await parseJson<{ id: string; paymentSource: string | null }>(response);
    expect(response.status).toBe(201);
    expect(created.paymentSource).toBe("Visa Gold");

    const saved = await testPrisma.subscription.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(saved.startDate.toISOString().slice(0, 10)).toBe("2026-03-05");
    expect(saved.paymentSource).toBe("Visa Gold");
  });

  it("rejects invalid date strings and inverted periods", async () => {
    const invalidStart = await client.post("/api/subscriptions", {
      name: "Bad Start",
      amount: 1000,
      interval: 1,
      startDate: "2026-3-1",
      dayOfMonth: 1,
      endDate: null,
      paymentSource: null,
    });
    const invalidPeriod = await client.post("/api/subscriptions", {
      name: "Bad Period",
      amount: 1000,
      interval: 1,
      startDate: "2026-04-01",
      dayOfMonth: 1,
      endDate: "2026-03-01",
      paymentSource: null,
    });

    expect(invalidStart.status).toBe(400);
    expect(await parseJson(invalidStart)).toEqual({ error: "startDate must be YYYY-MM-DD" });
    expect(invalidPeriod.status).toBe(400);
    expect(await parseJson(invalidPeriod)).toEqual({
      error: "startDate must be less than or equal to endDate",
    });
  });

  it("updates and soft deletes subscriptions", async () => {
    const subscription = await createSubscription(testPrisma, {
      name: "Before",
      amount: 1000,
      interval: 1,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      dayOfMonth: 1,
    });

    const update = await client.put(`/api/subscriptions/${subscription.id}`, {
      name: "After",
      amount: 2400,
      interval: 3,
      startDate: "2026-02-15",
      dayOfMonth: 15,
      endDate: "2026-12-31",
      paymentSource: "Main Account",
    });

    expect(update.status).toBe(200);
    expect(await parseJson(update)).toMatchObject({
      id: subscription.id,
      name: "After",
      interval: 3,
      paymentSource: "Main Account",
    });

    const missingUpdate = await client.put("/api/subscriptions/11111111-1111-4111-a111-111111111111", {
      name: "Missing",
      amount: 1000,
      interval: 1,
      startDate: "2026-01-01",
      dayOfMonth: 1,
      endDate: null,
      paymentSource: null,
    });
    expect(missingUpdate.status).toBe(404);

    const remove = await client.delete(`/api/subscriptions/${subscription.id}`);
    expect(remove.status).toBe(204);

    const deleted = await testPrisma.subscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    expect(deleted.deletedAt).not.toBeNull();
  });

  it("creates and updates a weekly subscription", async () => {
    const create = await client.post("/api/subscriptions", {
      name: "Weekly Sub",
      amount: 500,
      recurrence: "weekly",
      dayOfWeek: 5,
      dayOfMonth: null,
      interval: 1,
      startDate: "2026-01-01",
      endDate: null,
      paymentSource: null,
    });
    const created = await parseJson<{ id: string; recurrence: string; dayOfWeek: number | null; dayOfMonth: number | null; interval: number }>(create);

    expect(create.status).toBe(201);
    expect(created.recurrence).toBe("weekly");
    expect(created.dayOfWeek).toBe(5);
    expect(created.dayOfMonth).toBeNull();
    expect(created.interval).toBe(1);

    const update = await client.put(`/api/subscriptions/${created.id}`, {
      name: "Weekly Sub",
      amount: 500,
      recurrence: "weekly",
      dayOfWeek: 6,
      dayOfMonth: null,
      interval: 1,
      startDate: "2026-01-01",
      endDate: null,
      paymentSource: null,
    });
    const updated = await parseJson<{ dayOfWeek: number | null }>(update);
    expect(updated.dayOfWeek).toBe(6);

    const list = await parseJson<Array<{ id: string; recurrence: string }>>(await client.get("/api/subscriptions"));
    expect(list.find((item) => item.id === created.id)?.recurrence).toBe("weekly");
  });

  it("creates and updates a subscription with a foreign currency", async () => {
    const create = await client.post("/api/subscriptions", {
      name: "USD Subscription",
      amount: 1099,
      currencyCode: "USD",
      exchangeRateToJpy: 150,
      interval: 1,
      startDate: "2026-01-05",
      dayOfMonth: 5,
      endDate: null,
      paymentSource: null,
    });

    const created = await parseJson<{
      id: string;
      currencyCode: string;
      exchangeRateToJpy: number;
      exchangeRateUpdatedAt: string;
    }>(create);
    expect(create.status).toBe(201);
    expect(created.currencyCode).toBe("USD");
    expect(created.exchangeRateToJpy).toBe(150);
    expect(created.exchangeRateUpdatedAt).toBeDefined();

    const update = await client.put(`/api/subscriptions/${created.id}`, {
      name: "USD Subscription",
      amount: 1099,
      currencyCode: "USD",
      exchangeRateToJpy: 155,
      interval: 1,
      startDate: "2026-01-05",
      dayOfMonth: 5,
      endDate: null,
      paymentSource: null,
    });
    const updated = await parseJson<{ exchangeRateToJpy: number }>(update);
    expect(update.status).toBe(200);
    expect(updated.exchangeRateToJpy).toBe(155);
  });

  it("infers monthly subscription and rejects weekly with dayOfMonth or extra fields", async () => {
    const inferredMonthly = await client.post("/api/subscriptions", {
      name: "Inferred Monthly",
      amount: 1000,
      interval: 1,
      startDate: "2026-01-01",
      dayOfMonth: 10,
      endDate: null,
      paymentSource: null,
    });
    expect(inferredMonthly.status).toBe(201);
    const inferred = await parseJson<{ recurrence: string }>(inferredMonthly);
    expect(inferred.recurrence).toBe("monthly");

    const withDayOfMonth = await client.post("/api/subscriptions", {
      name: "Bad Weekly",
      amount: 1000,
      recurrence: "weekly",
      dayOfWeek: 5,
      dayOfMonth: 10,
      interval: 1,
      startDate: "2026-01-01",
      endDate: null,
      paymentSource: null,
    });
    expect(withDayOfMonth.status).toBe(400);

    const withExtra = await client.post("/api/subscriptions", {
      name: "Bad Weekly",
      amount: 1000,
      recurrence: "weekly",
      dayOfWeek: 5,
      dayOfMonth: null,
      interval: 1,
      extra: 1,
      startDate: "2026-01-01",
      endDate: null,
      paymentSource: null,
    });
    expect(withExtra.status).toBe(400);
  });
});
