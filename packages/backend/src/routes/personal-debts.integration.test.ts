import { describe, expect, it, vi } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { createAccount } from "../test-helpers/fixtures";
import { testPrisma } from "../test-helpers/db";

const client = createTestClient();

describe("personal debt and split bill routes", () => {
  it("creates a lent cash loan as an expense and records repayment as income", async () => {
    const account = await createAccount(testPrisma, {
      name: "Wallet",
      balance: 10000,
      sortOrder: 1,
    });

    const createResponse = await client.post("/api/personal-debts", {
      direction: "lent",
      counterpartyName: "A",
      title: "Lunch loan",
      principalAmount: 3000,
      openedDate: "2026-03-10",
      dueDate: "2026-03-20",
      accountId: account.id,
    });
    const debt = await parseJson<{
      id: string;
      openingTransactionId: string;
      remainingAmount: number;
    }>(createResponse);

    expect(createResponse.status).toBe(201);
    expect(debt.remainingAmount).toBe(3000);

    const afterCreate = await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(afterCreate.balance).toBe(7000);

    const opening = await testPrisma.transaction.findUniqueOrThrow({
      where: { id: debt.openingTransactionId },
    });
    expect(opening.type).toBe("expense");
    expect(opening.amount).toBe(3000);

    const settlementResponse = await client.post(`/api/personal-debts/${debt.id}/settlements`, {
      date: "2026-03-15",
      amount: 1000,
      accountId: account.id,
    });
    const settledDebt = await parseJson<{
      remainingAmount: number;
      settledAmount: number;
      settlements: Array<{ transactionId: string }>;
    }>(settlementResponse);

    expect(settlementResponse.status).toBe(201);
    expect(settledDebt.settledAmount).toBe(1000);
    expect(settledDebt.remainingAmount).toBe(2000);

    const afterSettlement = await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(afterSettlement.balance).toBe(8000);

    const settlementTransaction = await testPrisma.transaction.findUniqueOrThrow({
      where: { id: settledDebt.settlements[0].transactionId },
    });
    expect(settlementTransaction.type).toBe("income");
    expect(settlementTransaction.amount).toBe(1000);

    const blockedEdit = await client.put(`/api/transactions/${settlementTransaction.id}`, {
      accountId: account.id,
      date: "2026-03-16",
      type: "income",
      description: "Manual edit",
      amount: 1000,
    });
    const blockedDelete = await client.delete(`/api/transactions/${settlementTransaction.id}`);

    expect(blockedEdit.status).toBe(403);
    expect(blockedDelete.status).toBe(403);
  });

  it("creates borrowed cash loans as income and repayments as expenses", async () => {
    const account = await createAccount(testPrisma, {
      name: "Wallet",
      balance: 10000,
      sortOrder: 1,
    });

    const createResponse = await client.post("/api/personal-debts", {
      direction: "borrowed",
      counterpartyName: "B",
      title: "Cash help",
      principalAmount: 5000,
      openedDate: "2026-03-10",
      accountId: account.id,
    });
    const debt = await parseJson<{ id: string; openingTransactionId: string }>(createResponse);

    expect(createResponse.status).toBe(201);
    expect((await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance).toBe(15000);
    expect((await testPrisma.transaction.findUniqueOrThrow({ where: { id: debt.openingTransactionId } })).type).toBe(
      "income",
    );

    const settlementResponse = await client.post(`/api/personal-debts/${debt.id}/settlements`, {
      date: "2026-03-15",
      amount: 5000,
      accountId: account.id,
    });
    const settledDebt = await parseJson<{ status: string; remainingAmount: number }>(settlementResponse);

    expect(settlementResponse.status).toBe(201);
    expect(settledDebt.status).toBe("settled");
    expect(settledDebt.remainingAmount).toBe(0);
    expect((await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance).toBe(10000);
  });

  it("previews equal split remainders by sort order", async () => {
    const response = await client.post("/api/split-bills/preview", {
      totalAmount: 10000,
      splitMethod: "equal",
      participants: [
        { name: "自分", isSelf: true, sortOrder: 0 },
        { name: "A", sortOrder: 1 },
        { name: "B", sortOrder: 2 },
      ],
    });
    const body = await parseJson<{ participants: Array<{ name: string; shareAmount: number }> }>(response);

    expect(response.status).toBe(200);
    expect(body.participants.map((participant) => [participant.name, participant.shareAmount])).toEqual([
      ["自分", 3334],
      ["A", 3333],
      ["B", 3333],
    ]);
  });

  it("creates self-paid split bills with one payment transaction and participant debts", async () => {
    const account = await createAccount(testPrisma, {
      name: "Wallet",
      balance: 20000,
      sortOrder: 1,
    });

    const response = await client.post("/api/split-bills", {
      title: "Dinner",
      totalAmount: 12000,
      paidDate: "2026-03-10",
      payerType: "self",
      accountId: account.id,
      splitMethod: "equal",
      dueDate: "2026-03-20",
      participants: [
        { name: "自分", isSelf: true, sortOrder: 0 },
        { name: "A", sortOrder: 1 },
        { name: "B", sortOrder: 2 },
      ],
    });
    const splitBill = await parseJson<{
      id: string;
      paymentTransactionId: string;
      participants: Array<{ name: string; shareAmount: number; personalDebt: { id: string; direction: string; remainingAmount: number } | null }>;
    }>(response);

    expect(response.status).toBe(201);
    expect((await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance).toBe(8000);
    expect((await testPrisma.transaction.findUniqueOrThrow({ where: { id: splitBill.paymentTransactionId } })).amount).toBe(12000);
    expect(splitBill.participants.map((participant) => [participant.name, participant.shareAmount])).toEqual([
      ["自分", 4000],
      ["A", 4000],
      ["B", 4000],
    ]);
    expect(splitBill.participants.filter((participant) => participant.personalDebt)).toHaveLength(2);
    expect(splitBill.participants.find((participant) => participant.name === "A")?.personalDebt).toMatchObject({
      direction: "lent",
      remainingAmount: 4000,
    });

    const generatedDebts = splitBill.participants.flatMap((participant) =>
      participant.personalDebt ? [participant.personalDebt] : [],
    );
    for (const debt of generatedDebts) {
      const settlement = await client.post(`/api/personal-debts/${debt.id}/settlements`, {
        date: "2026-03-15",
        amount: 4000,
        accountId: account.id,
      });
      expect(settlement.status).toBe(201);
    }

    const refreshed = await client.get(`/api/split-bills/${splitBill.id}`);
    expect(await parseJson<{ status: string; outstandingAmount: number }>(refreshed)).toMatchObject({
      status: "settled",
      outstandingAmount: 0,
    });
    expect((await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance).toBe(16000);
  });

  it("creates other-paid split bills without an opening transaction and tracks only self debt", async () => {
    const account = await createAccount(testPrisma, {
      name: "Wallet",
      balance: 9000,
      sortOrder: 1,
    });

    const response = await client.post("/api/split-bills", {
      title: "Taxi",
      totalAmount: 9000,
      paidDate: "2026-03-10",
      payerType: "other",
      payerName: "Mika",
      accountId: account.id,
      participants: [
        { name: "自分", isSelf: true, sortOrder: 0 },
        { name: "A", sortOrder: 1 },
        { name: "B", sortOrder: 2 },
      ],
    });
    const splitBill = await parseJson<{
      paymentTransactionId: string | null;
      participants: Array<{ name: string; personalDebt: { id: string; direction: string; remainingAmount: number } | null }>;
    }>(response);

    expect(response.status).toBe(201);
    expect(splitBill.paymentTransactionId).toBeNull();
    expect((await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance).toBe(9000);

    const generatedDebts = splitBill.participants.filter((participant) => participant.personalDebt);
    expect(generatedDebts).toHaveLength(1);
    expect(generatedDebts[0]?.personalDebt).toMatchObject({
      direction: "borrowed",
      remainingAmount: 3000,
    });

    const settlement = await client.post(`/api/personal-debts/${generatedDebts[0]!.personalDebt!.id}/settlements`, {
      date: "2026-03-15",
      amount: 3000,
      accountId: account.id,
    });

    expect(settlement.status).toBe(201);
    expect((await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance).toBe(6000);
  });

  it("projects due debts into the dashboard and confirms them as settlements", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T00:00:00.000Z"));

    const account = await createAccount(testPrisma, {
      name: "Wallet",
      balance: 10000,
      sortOrder: 1,
    });
    const createResponse = await client.post("/api/personal-debts", {
      direction: "lent",
      counterpartyName: "A",
      title: "Due loan",
      principalAmount: 5000,
      openedDate: "2026-03-10",
      dueDate: "2026-03-20",
      accountId: account.id,
    });
    const debt = await parseJson<{ id: string }>(createResponse);

    const dashboard = await client.get("/api/dashboard");
    const body = await parseJson<{
      forecast: Array<{ id: string; type: string; amount: number; description: string }>;
    }>(dashboard);
    const event = body.forecast.find((item) => item.id.startsWith(`personal-debt:${debt.id}:`));

    expect(event).toMatchObject({
      type: "income",
      amount: 5000,
      description: "精算予定: Due loan (A)",
    });

    const confirm = await client.post("/api/dashboard/confirm", {
      forecastEventId: event!.id,
      amount: 5000,
      accountId: account.id,
    });
    expect(confirm.status).toBe(201);

    const settledDebt = await client.get(`/api/personal-debts/${debt.id}`);
    expect(await parseJson<{ status: string; remainingAmount: number }>(settledDebt)).toMatchObject({
      status: "settled",
      remainingAmount: 0,
    });
    expect((await testPrisma.account.findUniqueOrThrow({ where: { id: account.id } })).balance).toBe(10000);

    const duplicate = await client.post("/api/dashboard/confirm", {
      forecastEventId: event!.id,
      amount: 5000,
      accountId: account.id,
    });
    expect(duplicate.status).toBe(409);
  });

  it("rejects changing split bill core fields after a settlement exists", async () => {
    const account = await createAccount(testPrisma, {
      name: "Wallet",
      balance: 12000,
      sortOrder: 1,
    });
    const response = await client.post("/api/split-bills", {
      title: "Dinner",
      totalAmount: 6000,
      paidDate: "2026-03-10",
      payerType: "self",
      accountId: account.id,
      participants: [
        { name: "自分", isSelf: true, sortOrder: 0 },
        { name: "A", sortOrder: 1 },
      ],
    });
    const splitBill = await parseJson<{
      id: string;
      participants: Array<{ personalDebt: { id: string } | null }>;
    }>(response);
    const generatedDebt = splitBill.participants.find((participant) => participant.personalDebt)?.personalDebt;
    await client.post(`/api/personal-debts/${generatedDebt!.id}/settlements`, {
      date: "2026-03-15",
      amount: 3000,
      accountId: account.id,
    });

    const update = await client.put(`/api/split-bills/${splitBill.id}`, {
      title: "Changed",
      totalAmount: 6000,
      paidDate: "2026-03-10",
      payerType: "self",
      accountId: account.id,
      participants: [
        { name: "自分", isSelf: true, sortOrder: 0 },
        { name: "A", sortOrder: 1 },
      ],
    });

    expect(update.status).toBe(400);
  });
});
