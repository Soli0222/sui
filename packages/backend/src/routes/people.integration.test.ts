import { describe, expect, it } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { testPrisma } from "../test-helpers/db";
import type { Person, PersonSummaryResponse } from "@sui/shared";

const client = createTestClient();

describe("people routes", () => {
  it("returns an empty list when no people exist", async () => {
    const response = await client.get("/api/people");

    expect(response.status).toBe(200);
    expect(await parseJson(response)).toEqual([]);
  });

  it("returns active people ordered by sortOrder", async () => {
    const hidden = await testPrisma.person.create({
      data: {
        name: "Hidden",
        sortOrder: 0,
        deletedAt: new Date("2026-03-14T00:00:00.000Z"),
      },
    });
    const second = await testPrisma.person.create({
      data: { name: "Second", sortOrder: 2 },
    });
    const first = await testPrisma.person.create({
      data: { name: "First", sortOrder: 1 },
    });

    const response = await client.get("/api/people");
    const body = await parseJson<Array<{ id: string }>>(response);

    expect(response.status).toBe(200);
    expect(body.map((person) => person.id)).toEqual([first.id, second.id]);
    expect(body.some((person) => person.id === hidden.id)).toBe(false);
  });

  it("includes deleted people when includeDeleted=true", async () => {
    await testPrisma.person.create({
      data: { name: "Deleted", sortOrder: 0, deletedAt: new Date() },
    });

    const response = await client.get("/api/people?includeDeleted=true");
    const body = await parseJson<Array<{ name: string }>>(response);

    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Deleted");
  });

  it("creates a person and validates the payload", async () => {
    const success = await client.post("/api/people", {
      name: "Taro",
      memo: "Memo",
      sortOrder: 5,
    });
    const created = await parseJson<Person>(success);

    expect(success.status).toBe(201);
    expect(created).toMatchObject({
      name: "Taro",
      memo: "Memo",
      sortOrder: 5,
      outstandingAmount: {},
    });

    const saved = await testPrisma.person.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(saved.name).toBe("Taro");
    expect(saved.memo).toBe("Memo");
    expect(saved.sortOrder).toBe(5);

    const invalid = await client.post("/api/people", { name: "" });

    expect(invalid.status).toBe(400);
    expect(await parseJson(invalid)).toMatchObject({ error: "Validation failed" });
  });

  it("updates an active person and returns 404 for missing or deleted ids", async () => {
    const target = await testPrisma.person.create({
      data: { name: "Before", sortOrder: 1 },
    });
    const deleted = await testPrisma.person.create({
      data: { name: "Deleted", sortOrder: 2, deletedAt: new Date() },
    });

    const success = await client.put(`/api/people/${target.id}`, {
      name: "After",
      memo: null,
      sortOrder: 9,
    });

    expect(success.status).toBe(200);
    expect(await parseJson(success)).toMatchObject({
      id: target.id,
      name: "After",
      memo: null,
      sortOrder: 9,
    });

    const missing = await client.put("/api/people/00000000-0000-0000-0000-000000000000", {
      name: "Missing",
    });
    const deletedResponse = await client.put(`/api/people/${deleted.id}`, {
      name: "Deleted",
    });

    expect(missing.status).toBe(404);
    expect(deletedResponse.status).toBe(404);
  });

  it("soft deletes a person and returns 404 when the id does not exist", async () => {
    const target = await testPrisma.person.create({
      data: { name: "Delete me", sortOrder: 1 },
    });

    const success = await client.delete(`/api/people/${target.id}`);

    expect(success.status).toBe(204);

    const deleted = await testPrisma.person.findUniqueOrThrow({
      where: { id: target.id },
    });
    expect(deleted.deletedAt).not.toBeNull();

    const missing = await client.delete("/api/people/00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404);
  });

  it("returns summary with unsettled shares sorted by split date", async () => {
    const person = await testPrisma.person.create({
      data: { name: "Taro", sortOrder: 1 },
    });
    const split = await testPrisma.transactionSplit.create({
      data: {
        date: new Date("2026-07-25"),
        description: "Lunch",
        memo: null,
        amount: 3000,
        method: "equal",
        ownRatio: 1,
        shares: {
          create: {
            personId: person.id,
            amount: 1500,
          },
        },
      },
      include: { shares: true },
    });

    const response = await client.get(`/api/people/${person.id}/summary`);
    const body = await parseJson<PersonSummaryResponse>(response);

    expect(response.status).toBe(200);
    expect(body.shares).toHaveLength(1);
    expect(body.shares[0]).toMatchObject({
      splitId: split.id,
      personId: person.id,
      amount: 1500,
      remainingAmount: 1500,
      status: "unsettled",
    });
    expect(body.outstandingAmount).toEqual({ JPY: 1500 });
  });
});
