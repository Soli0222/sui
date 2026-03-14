import { describe, expect, it } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { createAccount } from "../test-helpers/fixtures";
import { testPrisma } from "../test-helpers/db";

const client = createTestClient();

describe("accounts routes", () => {
  it("returns an empty list when no accounts exist", async () => {
    const response = await client.get("/api/accounts");

    expect(response.status).toBe(200);
    expect(await parseJson(response)).toEqual([]);
  });

  it("returns active accounts ordered by sortOrder", async () => {
    const hidden = await createAccount(testPrisma, {
      name: "Hidden",
      balance: 100,
      sortOrder: 0,
      deletedAt: new Date("2026-03-14T00:00:00.000Z"),
    });
    const second = await createAccount(testPrisma, {
      name: "Second",
      balance: 200,
      sortOrder: 2,
    });
    const first = await createAccount(testPrisma, {
      name: "First",
      balance: 300,
      sortOrder: 1,
    });

    const response = await client.get("/api/accounts");
    const body = await parseJson<Array<{ id: string }>>(response);

    expect(response.status).toBe(200);
    expect(body.map((account) => account.id)).toEqual([first.id, second.id]);
    expect(body.some((account) => account.id === hidden.id)).toBe(false);
  });

  it("creates an account and validates the payload", async () => {
    const success = await client.post("/api/accounts", {
      name: "Wallet",
      balance: 12345,
      sortOrder: 5,
    });
    const created = await parseJson<{ id: string }>(success);

    expect(success.status).toBe(201);

    const saved = await testPrisma.account.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(saved.name).toBe("Wallet");
    expect(saved.balance).toBe(12345);
    expect(saved.sortOrder).toBe(5);

    const invalid = await client.post("/api/accounts", {
      name: "",
      balance: 0,
      sortOrder: 0,
    });

    expect(invalid.status).toBe(400);
    expect(await parseJson(invalid)).toMatchObject({ error: "Validation failed" });
  });

  it("updates an active account and returns 404 for missing or deleted ids", async () => {
    const target = await createAccount(testPrisma, {
      name: "Before",
      balance: 1000,
      sortOrder: 1,
    });
    const deleted = await createAccount(testPrisma, {
      name: "Deleted",
      balance: 1000,
      sortOrder: 2,
      deletedAt: new Date("2026-03-14T00:00:00.000Z"),
    });

    const success = await client.put(`/api/accounts/${target.id}`, {
      name: "After",
      balance: 2500,
      sortOrder: 9,
    });

    expect(success.status).toBe(200);
    expect(await parseJson(success)).toMatchObject({
      id: target.id,
      name: "After",
      balance: 2500,
      sortOrder: 9,
    });

    const updated = await testPrisma.account.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(updated.name).toBe("After");
    expect(updated.balance).toBe(2500);

    const missing = await client.put("/api/accounts/00000000-0000-0000-0000-000000000000", {
      name: "Missing",
      balance: 1,
      sortOrder: 1,
    });
    const deletedResponse = await client.put(`/api/accounts/${deleted.id}`, {
      name: "Deleted",
      balance: 1,
      sortOrder: 1,
    });

    expect(missing.status).toBe(404);
    expect(deletedResponse.status).toBe(404);
  });

  it("soft deletes an account and returns 404 when the id does not exist", async () => {
    const target = await createAccount(testPrisma, {
      name: "Delete me",
      balance: 100,
      sortOrder: 1,
    });

    const success = await client.delete(`/api/accounts/${target.id}`);

    expect(success.status).toBe(204);

    const deleted = await testPrisma.account.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(deleted.deletedAt).not.toBeNull();

    const missing = await client.delete("/api/accounts/00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404);
  });
});
