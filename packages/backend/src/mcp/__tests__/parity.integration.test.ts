import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { SplitResponse, SubscriptionMonthlyResponse } from "@sui/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app";
import { createApiTokenRecord } from "../../lib/auth";
import { testPrisma } from "../../test-helpers/db";
import { InProcessSuiApiClient } from "../client";
import { buildServer } from "../server";

type ToolResult = Record<string, unknown> & { status: string; amountUnit: string };

describe("MCP and API parity", () => {
  const app = createApp({ authMode: "enabled", enableStaticFallback: false });
  let client: Client;
  let server: ReturnType<typeof buildServer>;
  let api: InProcessSuiApiClient;

  async function connect(readOnly = false) {
    const { token } = await createApiTokenRecord(`parity-${readOnly ? "readonly" : "write"}`, readOnly);
    api = new InProcessSuiApiClient(app, token);
    server = buildServer({ apiClient: api });
    client = new Client({ name: "parity-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  }

  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ text: string }>;
    const output = content.at(-1)!.text;
    if (!output.startsWith("{")) throw new Error(`${name}: ${output}`);
    const data = JSON.parse(output) as ToolResult;
    expect(data).toEqual(result.structuredContent);
    return { result, data };
  }

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-24T03:00:00Z"));
    await connect();
  });
  afterEach(async () => {
    await client.close();
    await server.close();
    vi.useRealTimers();
  });

  it("keeps the current balance after another transaction and exposes supplemental budget selection", async () => {
    const created = (await call("create_account", {
      name: "生活口座", balance: 100000, balanceOffset: 0, currencyCode: "JPY",
      exchangeRateToJpy: 1, sortOrder: 0, supplementalBudgetEnabled: false,
    })).data.account as { id: string };
    await call("create_transaction", {
      accountId: created.id, date: "2026-09-20", type: "expense", description: "食料品", amount: 10000,
    });
    const before = await testPrisma.transaction.count({ where: { accountId: created.id } });
    const update = await call("update_account", {
      id: created.id, name: "生活費", balanceOffset: 0, currencyCode: "JPY",
      exchangeRateToJpy: 1, sortOrder: 0, supplementalBudgetEnabled: true,
    });
    expect(update.data.account).toMatchObject({ id: created.id, balance: 90000, supplementalBudgetEnabled: true });
    expect(await testPrisma.transaction.count({ where: { accountId: created.id } })).toBe(before);
    expect(await api.get(`/api/accounts`)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.id, balance: 90000, supplementalBudgetEnabled: true }),
    ]));
  });

  it("matches API people, split, settlement, recurring and monthly subscription results", async () => {
    const person = (await call("create_person", { name: "共同購入者", memo: "メモ", sortOrder: 1 })).data.person as { id: string };
    expect(person).toMatchObject({ name: "共同購入者" });
    const updated = (await call("update_person", { id: person.id, name: "友人", memo: null, sortOrder: 2 })).data.person;
    expect(updated).toMatchObject({ id: person.id, name: "友人", memo: null, sortOrder: 2 });
    expect((await api.get(`/api/people/${person.id}/summary`) as { person: { name: string } }).person.name).toBe("友人");

    const split = (await call("set_transaction_split", {
      date: "2026-09-20", description: "食事", amount: 2000, method: "equal", shares: [{ personId: person.id }],
    })).data.split as { id: string };
    const detail = (await call("get_split", { id: split.id })).data;
    expect(detail).toMatchObject(await api.get<SplitResponse>(`/api/splits/${split.id}`));
    const settlement = (await call("create_settlement", {
      kind: "offset", personId: person.id, date: "2026-09-21", allocations: [{ shareId: (detail.shares as Array<{ id: string }>)[0].id, amount: 500 }],
    })).data.settlement as { id: string };
    const settlements = (await call("list_settlements", { personId: person.id })).data.items;
    expect(settlements).toEqual(await api.get(`/api/settlements?personId=${person.id}`));
    expect(settlements).toEqual([expect.objectContaining({ id: settlement.id })]);
    const empty = (await call("list_settlements", { transactionId: "33333333-3333-4333-a333-333333333333" })).data.items;
    expect(empty).toEqual(await api.get("/api/settlements?transactionId=33333333-3333-4333-a333-333333333333"));

    const account = (await call("create_account", {
      name: "口座", balance: 10000, balanceOffset: 0, currencyCode: "JPY", exchangeRateToJpy: 1, sortOrder: 0,
    })).data.account as { id: string };
    const recurring = (await call("create_recurring_item", {
      name: "定期収入", type: "income", amount: 1000, recurrence: "monthly", interval: 1,
      dayOfMonth: 1, startDate: "2026-09-01", endDate: null, accountId: account.id, enabled: true, sortOrder: 0,
    })).data.item as { id: string };
    expect((await call("get_recurring_item", { id: recurring.id })).data.item).toMatchObject({ id: recurring.id, name: "定期収入" });

    const subscription = (await call("create_subscription", {
      name: "保管サービス", amount: 1200, currencyCode: "JPY", startDate: "2026-09-01", dayOfMonth: 1,
    })).data.item as { id: string };
    await call("create_subscription_amount_change", { subscriptionId: subscription.id, effectiveFrom: "2026-10-01", amount: 1500 });
    expect((await call("get_subscription", { id: subscription.id })).data.item).toEqual(await api.get(`/api/subscriptions/${subscription.id}`));
    const monthly = (await call("get_subscription_monthly", { yearMonth: "2026-10" })).data;
    expect(monthly).toMatchObject(await api.get<SubscriptionMonthlyResponse>("/api/subscriptions/monthly/2026-10"));
    expect(monthly.items).toEqual(expect.arrayContaining([expect.objectContaining({ amount: 1500 })]));

    await call("delete_settlement", { settlementId: settlement.id });
    expect((await call("delete_split", { id: split.id })).data).toMatchObject({ status: "preview", executed: false, found: true });
    expect((await call("delete_split", { id: split.id, confirm: true })).data).toMatchObject({ deleted: true, executed: true });
    expect((await call("delete_person", { id: person.id })).data).toMatchObject({ status: "preview", executed: false, found: true });
    expect((await call("delete_person", { id: person.id, confirm: true })).data).toMatchObject({ deleted: true, executed: true });
    expect(await api.get("/api/people")).toEqual([]);
  });

  it("rejects the new write tools with a read-only token", async () => {
    await client.close();
    await server.close();
    await connect(true);
    for (const [name, args] of [
      ["create_person", { name: "拒否", sortOrder: 0 }],
      ["update_person", { id: "11111111-1111-4111-a111-111111111111", name: "拒否", sortOrder: 0 }],
      ["delete_person", { id: "11111111-1111-4111-a111-111111111111", confirm: true }],
      ["delete_split", { id: "11111111-1111-4111-a111-111111111111", confirm: true }],
    ] as const) {
      const { result, data } = await call(name, args);
      expect(result.isError).toBe(true);
      expect(data).toMatchObject({ status: "error", error: { httpStatus: 403 } });
    }
  });
});
