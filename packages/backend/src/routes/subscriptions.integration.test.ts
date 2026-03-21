import { describe, expect, it } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { createSubscription } from "../test-helpers/fixtures";
import { testPrisma } from "../test-helpers/db";

const client = createTestClient();

describe("subscriptions routes", () => {
  it("returns non-deleted subscriptions", async () => {
    const active = await createSubscription(testPrisma, {
      name: "Active",
      amount: 1200,
      intervalMonths: 1,
      startDate: new Date("2026-01-05T00:00:00.000Z"),
      dayOfMonth: 5,
    });
    const deleted = await createSubscription(testPrisma, {
      name: "Deleted",
      amount: 999,
      intervalMonths: 1,
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
      intervalMonths: 1,
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
      intervalMonths: 1,
      startDate: "2026-3-1",
      dayOfMonth: 1,
      endDate: null,
      paymentSource: null,
    });
    const invalidPeriod = await client.post("/api/subscriptions", {
      name: "Bad Period",
      amount: 1000,
      intervalMonths: 1,
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
      intervalMonths: 1,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      dayOfMonth: 1,
    });

    const update = await client.put(`/api/subscriptions/${subscription.id}`, {
      name: "After",
      amount: 2400,
      intervalMonths: 3,
      startDate: "2026-02-15",
      dayOfMonth: 15,
      endDate: "2026-12-31",
      paymentSource: "Main Account",
    });

    expect(update.status).toBe(200);
    expect(await parseJson(update)).toMatchObject({
      id: subscription.id,
      name: "After",
      intervalMonths: 3,
      paymentSource: "Main Account",
    });

    const missingUpdate = await client.put("/api/subscriptions/11111111-1111-4111-a111-111111111111", {
      name: "Missing",
      amount: 1000,
      intervalMonths: 1,
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
});
