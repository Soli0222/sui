import { describe, expect, it } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { createAccount, createLoan, createTransaction } from "../test-helpers/fixtures";
import { testPrisma } from "../test-helpers/db";

const client = createTestClient();

describe("loans routes", () => {
  it("returns loan snapshots with remaining balances and payments", async () => {
    const account = await createAccount(testPrisma, { name: "Main" });
    const loan = await createLoan(testPrisma, {
      name: "Car",
      accountId: account.id,
      totalAmount: 1000,
      paymentCount: 3,
      startDate: new Date("2026-01-15T00:00:00.000Z"),
    });
    await createTransaction(testPrisma, {
      accountId: account.id,
      forecastEventId: `loan:${loan.id}:2026-01`,
      amount: 334,
    });

    const response = await client.get("/api/loans");
    const body = await parseJson<Array<{ id: string; remainingBalance: number; remainingPayments: number }>>(response);

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: loan.id,
      remainingBalance: 666,
      remainingPayments: 2,
    });
  });

  it("creates, updates, and soft deletes loans", async () => {
    const account = await createAccount(testPrisma, { name: "Main" });

    const create = await client.post("/api/loans", {
      name: "Laptop",
      totalAmount: 240000,
      paymentCount: 12,
      startDate: "2026-04-10",
      accountId: account.id,
    });
    const created = await parseJson<{ id: string }>(create);

    expect(create.status).toBe(201);

    const update = await client.put(`/api/loans/${created.id}`, {
      name: "Laptop Updated",
      totalAmount: 120000,
      paymentCount: 6,
      startDate: "2026-05-15",
      accountId: account.id,
    });

    expect(update.status).toBe(200);
    expect(await parseJson(update)).toMatchObject({
      id: created.id,
      name: "Laptop Updated",
      paymentCount: 6,
    });

    const remove = await client.delete(`/api/loans/${created.id}`);
    expect(remove.status).toBe(204);

    const deleted = await testPrisma.loan.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(deleted.deletedAt).not.toBeNull();
  });
});
