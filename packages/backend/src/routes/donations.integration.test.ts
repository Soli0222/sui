import type { Donation } from "@sui/shared";
import { describe, expect, it } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { createDonation } from "../test-helpers/fixtures";
import { testPrisma } from "../test-helpers/db";

const client = createTestClient();

describe("donations routes", () => {
  it("returns non-deleted donations ordered by donatedOn desc", async () => {
    const active = await createDonation(testPrisma, {
      recipient: "Active City",
      amount: 10000,
      donatedOn: new Date("2026-03-15T00:00:00.000Z"),
    });
    const deleted = await createDonation(testPrisma, {
      recipient: "Deleted City",
      amount: 5000,
      donatedOn: new Date("2026-02-15T00:00:00.000Z"),
      deletedAt: new Date("2026-04-01T00:00:00.000Z"),
    });
    const recent = await createDonation(testPrisma, {
      recipient: "Recent City",
      amount: 20000,
      donatedOn: new Date("2026-04-01T00:00:00.000Z"),
    });

    const response = await client.get("/api/donations");
    const body = await parseJson<Donation[]>(response);

    expect(response.status).toBe(200);
    expect(body.map((donation) => donation.id)).toEqual([recent.id, active.id]);
    expect(body.some((donation) => donation.id === deleted.id)).toBe(false);
    expect(body[0]?.donatedOn).toBe("2026-04-01");
  });

  it("filters donations by calendar year", async () => {
    await createDonation(testPrisma, {
      recipient: "Previous Year",
      amount: 10000,
      donatedOn: new Date("2025-12-31T00:00:00.000Z"),
    });
    const current = await createDonation(testPrisma, {
      recipient: "Current Year",
      amount: 20000,
      donatedOn: new Date("2026-01-01T00:00:00.000Z"),
    });

    const response = await client.get("/api/donations?year=2026");
    const body = await parseJson<Donation[]>(response);

    expect(response.status).toBe(200);
    expect(body.map((donation) => donation.id)).toEqual([current.id]);
  });

  it("rejects invalid or out-of-range year queries", async () => {
    const wrongFormat = await client.get("/api/donations?year=2026-01");
    const zeroYear = await client.get("/api/donations?year=0000");
    const maxBoundary = await client.get("/api/donations?year=9999");

    expect(wrongFormat.status).toBe(400);
    expect(zeroYear.status).toBe(400);
    expect(maxBoundary.status).toBe(400);
    expect(await parseJson(wrongFormat)).toEqual({
      error: "year must be a supported 4-digit year",
    });
  });

  it("creates a donation", async () => {
    const response = await client.post("/api/donations", {
      recipient: "  Test City  ",
      amount: 12345,
      memo: " memo ",
      donatedOn: "2026-05-10",
    });

    const created = await parseJson<Donation>(response);
    expect(response.status).toBe(201);
    expect(created.recipient).toBe("Test City");
    expect(created.amount).toBe(12345);
    expect(created.memo).toBe("memo");
    expect(created.donatedOn).toBe("2026-05-10");

    const saved = await testPrisma.donation.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(saved.recipient).toBe("Test City");
    expect(saved.amount).toBe(12345);
    expect(saved.memo).toBe("memo");
    expect(saved.donatedOn.toISOString().slice(0, 10)).toBe("2026-05-10");
  });

  it("rejects invalid date and invalid or out-of-range amounts", async () => {
    const invalidDate = await client.post("/api/donations", {
      recipient: "City",
      amount: 1000,
      donatedOn: "2026-5-1",
    });
    const zeroAmount = await client.post("/api/donations", {
      recipient: "City",
      amount: 0,
      donatedOn: "2026-05-01",
    });
    const negativeAmount = await client.post("/api/donations", {
      recipient: "City",
      amount: -100,
      donatedOn: "2026-05-01",
    });
    const fractionalAmount = await client.post("/api/donations", {
      recipient: "City",
      amount: 100.5,
      donatedOn: "2026-05-01",
    });
    const tooLarge = await client.post("/api/donations", {
      recipient: "City",
      amount: 2147483648,
      donatedOn: "2026-05-01",
    });
    const emptyRecipient = await client.post("/api/donations", {
      recipient: "   ",
      amount: 1000,
      donatedOn: "2026-05-01",
    });

    expect(invalidDate.status).toBe(400);
    expect(zeroAmount.status).toBe(400);
    expect(negativeAmount.status).toBe(400);
    expect(fractionalAmount.status).toBe(400);
    expect(tooLarge.status).toBe(400);
    expect(emptyRecipient.status).toBe(400);
  });

  it("rejects unknown fields in create payload", async () => {
    const response = await client.post("/api/donations", {
      recipient: "City",
      amount: 1000,
      donatedOn: "2026-05-01",
      extra: 1,
    });
    expect(response.status).toBe(400);
  });

  it("partially updates a donation", async () => {
    const donation = await createDonation(testPrisma, {
      recipient: "Before",
      amount: 10000,
      donatedOn: new Date("2026-04-15T00:00:00.000Z"),
    });

    const response = await client.patch(`/api/donations/${donation.id}`, {
      amount: 20000,
      memo: "updated",
    });

    const updated = await parseJson<Donation>(response);
    expect(response.status).toBe(200);
    expect(updated.recipient).toBe("Before");
    expect(updated.amount).toBe(20000);
    expect(updated.memo).toBe("updated");
    expect(updated.donatedOn).toBe("2026-04-15");

    const saved = await testPrisma.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(saved.amount).toBe(20000);
    expect(saved.memo).toBe("updated");
  });

  it("rejects empty patch body", async () => {
    const donation = await createDonation(testPrisma, {
      recipient: "City",
      amount: 10000,
      donatedOn: new Date("2026-04-15T00:00:00.000Z"),
    });

    const response = await client.patch(`/api/donations/${donation.id}`, {});
    expect(response.status).toBe(400);
  });

  it("returns 404 when updating or deleting a missing donation", async () => {
    const missingUpdate = await client.patch("/api/donations/11111111-1111-4111-a111-111111111111", {
      amount: 1000,
    });
    const missingDelete = await client.delete("/api/donations/11111111-1111-4111-a111-111111111111");

    expect(missingUpdate.status).toBe(404);
    expect(missingDelete.status).toBe(404);
  });

  it("logically deletes a donation", async () => {
    const donation = await createDonation(testPrisma, {
      recipient: "City",
      amount: 10000,
      donatedOn: new Date("2026-04-15T00:00:00.000Z"),
    });

    const response = await client.delete(`/api/donations/${donation.id}`);
    expect(response.status).toBe(204);

    const saved = await testPrisma.donation.findUniqueOrThrow({
      where: { id: donation.id },
    });
    expect(saved.deletedAt).not.toBeNull();

    const list = await client.get("/api/donations");
    const body = await parseJson<Donation[]>(list);
    expect(body.some((item) => item.id === donation.id)).toBe(false);
  });
});
