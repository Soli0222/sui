import { describe, expect, it } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { createAccount, createCreditCard } from "../test-helpers/fixtures";
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
});
