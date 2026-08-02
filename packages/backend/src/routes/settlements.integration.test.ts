import { describe, expect, it } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { createAccount, createTransaction } from "../test-helpers/fixtures";
import { testPrisma } from "../test-helpers/db";
import type { CreateSettlementPayload, SettlementListItem } from "@sui/shared";

const client = createTestClient();

type JsonBody = Record<string, unknown>;

function postSettlement(payload: CreateSettlementPayload | JsonBody) {
  return client.post("/api/settlements", payload as JsonBody);
}

async function createPerson(name: string) {
  return testPrisma.person.create({ data: { name, sortOrder: 0 } });
}

async function createSplitWithShare(personId: string, total: number, shareAmount: number) {
  const split = await testPrisma.transactionSplit.create({
    data: {
      date: new Date("2026-07-25"),
      description: "Test split",
      memo: null,
      amount: total,
      method: "amount",
      ownRatio: null,
      shares: {
        create: {
          personId,
          amount: shareAmount,
        },
      },
    },
    include: { shares: true },
  });
  return split.shares[0];
}

function settlementPayload(personId: string, shareId: string, amount: number, overrides: Partial<CreateSettlementPayload> = {}): CreateSettlementPayload {
  return {
    kind: "offset",
    personId,
    date: "2026-07-26",
    allocations: [{ shareId, amount }],
    ...overrides,
  };
}

describe("settlements routes", () => {
  it("creates an offset settlement within the remaining share amount", async () => {
    const person = await createPerson("Taro");
    const share = await createSplitWithShare(person.id, 3000, 1500);

    const response = await postSettlement(settlementPayload(person.id, share.id, 1000));
    const body = await parseJson<SettlementListItem>(response);

    expect(response.status).toBe(201);
    expect(body.allocations[0]).toMatchObject({ shareId: share.id, amount: 1000 });
  });

  it("creates a transaction settlement linked to a JPY transfer", async () => {
    const person = await createPerson("Taro");
    const share = await createSplitWithShare(person.id, 3000, 1500);
    const from = await createAccount(testPrisma, { name: "From", balance: 0, sortOrder: 1 });
    const to = await createAccount(testPrisma, { name: "To", balance: 0, sortOrder: 2 });
    const transaction = await createTransaction(testPrisma, {
      accountId: from.id,
      transferToAccountId: to.id,
      type: "transfer",
      amount: 1000,
    });

    const response = await postSettlement({
      kind: "transaction",
      personId: person.id,
      transactionId: transaction.id,
      allocations: [{ shareId: share.id, amount: 1000 }],
    });

    expect(response.status).toBe(201);
  });

  it("rejects a settlement that exceeds the remaining share amount", async () => {
    const person = await createPerson("Taro");
    const share = await createSplitWithShare(person.id, 3000, 1000);

    const response = await postSettlement(settlementPayload(person.id, share.id, 1001));

    expect(response.status).toBe(400);
  });

  it("rejects a transaction settlement that exceeds the transfer amount", async () => {
    const person = await createPerson("Taro");
    const share = await createSplitWithShare(person.id, 3000, 1500);
    const from = await createAccount(testPrisma, { name: "From", balance: 0, sortOrder: 1 });
    const to = await createAccount(testPrisma, { name: "To", balance: 0, sortOrder: 2 });
    const transaction = await createTransaction(testPrisma, {
      accountId: from.id,
      transferToAccountId: to.id,
      type: "transfer",
      amount: 1000,
    });

    const response = await postSettlement({
      kind: "transaction",
      personId: person.id,
      transactionId: transaction.id,
      allocations: [{ shareId: share.id, amount: 1001 }],
    });

    expect(response.status).toBe(400);
  });

  it("rejects allocations for a share that belongs to another person", async () => {
    const taro = await createPerson("Taro");
    const jiro = await createPerson("Jiro");
    const share = await createSplitWithShare(jiro.id, 3000, 1500);

    const response = await postSettlement(settlementPayload(taro.id, share.id, 1000));

    expect(response.status).toBe(400);
  });

  it("rejects settlements linked to non-transfer transactions", async () => {
    const person = await createPerson("Taro");
    const share = await createSplitWithShare(person.id, 3000, 1500);
    const account = await createAccount(testPrisma, { name: "Cash", balance: 0, sortOrder: 1 });
    const transaction = await createTransaction(testPrisma, { accountId: account.id, type: "expense", amount: 1000 });

    const response = await postSettlement({
      kind: "transaction",
      personId: person.id,
      transactionId: transaction.id,
      allocations: [{ shareId: share.id, amount: 1000 }],
    });

    expect(response.status).toBe(400);
  });

  it("rejects settlements linked to non-JPY transfers", async () => {
    const person = await createPerson("Taro");
    const share = await createSplitWithShare(person.id, 3000, 1500);
    const from = await createAccount(testPrisma, { name: "USD From", balance: 0, currencyCode: "USD", exchangeRateToJpy: 150, sortOrder: 1 });
    const to = await createAccount(testPrisma, { name: "USD To", balance: 0, currencyCode: "USD", exchangeRateToJpy: 150, sortOrder: 2 });
    const transaction = await createTransaction(testPrisma, {
      accountId: from.id,
      transferToAccountId: to.id,
      type: "transfer",
      amount: 1000,
    });

    const response = await postSettlement({
      kind: "transaction",
      personId: person.id,
      transactionId: transaction.id,
      allocations: [{ shareId: share.id, amount: 1000 }],
    });

    expect(response.status).toBe(400);
  });

  it("creates two transaction settlements against the same transfer within the transfer amount", async () => {
    const person = await createPerson("Taro");
    const firstShare = await createSplitWithShare(person.id, 9000, 4000);
    const secondShare = await createSplitWithShare(person.id, 11000, 6000);
    const from = await createAccount(testPrisma, { name: "From", balance: 0, sortOrder: 1 });
    const to = await createAccount(testPrisma, { name: "To", balance: 0, sortOrder: 2 });
    const transaction = await createTransaction(testPrisma, {
      accountId: from.id,
      transferToAccountId: to.id,
      type: "transfer",
      amount: 10000,
    });

    const firstResponse = await postSettlement({
      kind: "transaction",
      personId: person.id,
      transactionId: transaction.id,
      allocations: [{ shareId: firstShare.id, amount: 4000 }],
    });
    expect(firstResponse.status).toBe(201);

    const secondResponse = await postSettlement({
      kind: "transaction",
      personId: person.id,
      transactionId: transaction.id,
      allocations: [{ shareId: secondShare.id, amount: 6000 }],
    });
    expect(secondResponse.status).toBe(201);

    const listResponse = await client.get(`/api/transactions?type=transfer&limit=1`);
    const body = await parseJson<{
      items: Array<{ settlementRemainingAmount: number; settlementAllocatedAmount: number }>;
    }>(listResponse);
    expect(listResponse.status).toBe(200);
    expect(body.items[0]).toMatchObject({
      settlementAllocatedAmount: 10000,
      settlementRemainingAmount: 0,
    });
  });

  it("rejects a transaction settlement that exceeds the remaining transfer amount", async () => {
    const person = await createPerson("Taro");
    const settledShare = await createSplitWithShare(person.id, 10000, 10000);
    const extraShare = await createSplitWithShare(person.id, 2000, 2000);
    const from = await createAccount(testPrisma, { name: "From", balance: 0, sortOrder: 1 });
    const to = await createAccount(testPrisma, { name: "To", balance: 0, sortOrder: 2 });
    const transaction = await createTransaction(testPrisma, {
      accountId: from.id,
      transferToAccountId: to.id,
      type: "transfer",
      amount: 10000,
    });

    const firstResponse = await postSettlement({
      kind: "transaction",
      personId: person.id,
      transactionId: transaction.id,
      allocations: [{ shareId: settledShare.id, amount: 10000 }],
    });
    expect(firstResponse.status).toBe(201);

    const overResponse = await postSettlement({
      kind: "transaction",
      personId: person.id,
      transactionId: transaction.id,
      allocations: [{ shareId: extraShare.id, amount: 1 }],
    });
    expect(overResponse.status).toBe(400);

    const extraShareAfter = await testPrisma.splitShare.findUniqueOrThrow({
      where: { id: extraShare.id },
      include: { allocations: true },
    });
    expect(extraShareAfter.allocations).toHaveLength(0);
  });

  it("recalculates transaction remaining amount after deleting a settlement", async () => {
    const person = await createPerson("Taro");
    const share = await createSplitWithShare(person.id, 9000, 4000);
    const from = await createAccount(testPrisma, { name: "From", balance: 0, sortOrder: 1 });
    const to = await createAccount(testPrisma, { name: "To", balance: 0, sortOrder: 2 });
    const transaction = await createTransaction(testPrisma, {
      accountId: from.id,
      transferToAccountId: to.id,
      type: "transfer",
      amount: 10000,
    });

    const createResponse = await postSettlement({
      kind: "transaction",
      personId: person.id,
      transactionId: transaction.id,
      allocations: [{ shareId: share.id, amount: 4000 }],
    });
    const settlement = await parseJson<SettlementListItem>(createResponse);
    expect(createResponse.status).toBe(201);

    const beforeDelete = await client.get(`/api/transactions?type=transfer&limit=1`);
    const beforeBody = await parseJson<{
      items: Array<{ settlementRemainingAmount: number }>;
    }>(beforeDelete);
    expect(beforeDelete.status).toBe(200);
    expect(beforeBody.items[0].settlementRemainingAmount).toBe(6000);

    const deleteResponse = await client.delete(`/api/settlements/${settlement.id}`);
    expect(deleteResponse.status).toBe(204);

    const afterDelete = await client.get(`/api/transactions?type=transfer&limit=1`);
    const afterBody = await parseJson<{
      items: Array<{ settlementRemainingAmount: number }>;
    }>(afterDelete);
    expect(afterDelete.status).toBe(200);
    expect(afterBody.items[0].settlementRemainingAmount).toBe(10000);
  });
});
