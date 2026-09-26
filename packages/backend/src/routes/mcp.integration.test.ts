import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Hono } from "hono";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../app";
import { createApiTokenRecord, createAuthSession, revokeApiToken } from "../lib/auth";
import { testPrisma } from "../test-helpers/db";
import { createAuditCapture, type CapturedAudit } from "../test-helpers/audit";
import { startMockMcpOAuthProvider, type MockMcpOAuthProvider } from "../test-helpers/mock-mcp-oauth";

async function startServer(app: Hono) {
  return new Promise<{ server: Server; baseUrl: string; stop: () => Promise<void> }>((resolve) => {
    const server = serve(
      {
        fetch: app.fetch,
        port: 0,
      },
      (info) => {
        const address = info as AddressInfo;
        const baseUrl = `http://127.0.0.1:${address.port}`;
        resolve({
          server: server as unknown as Server,
          baseUrl,
          stop: () =>
            new Promise<void>((res, reject) => {
              (server as unknown as Server).close((err) => (err ? reject(err) : res()));
            }),
        });
      },
    );
  });
}

function createMcpClient(baseUrl: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers },
    reconnectionOptions: {
      initialReconnectionDelay: 1,
      maxReconnectionDelay: 1,
      reconnectionDelayGrowFactor: 1,
      maxRetries: 0,
    },
  });

  const client = new Client({ name: "test-client", version: "1.0.0" });
  return { client, transport, headers };
}

async function closeMcpClient(client: Client, transport: StreamableHTTPClientTransport) {
  try {
    await transport.terminateSession();
  } catch {
    // ignore
  }
  await client.close();
}

describe("/mcp", () => {
  let app: Hono;
  let audits: CapturedAudit[];
  let auditLogger: ReturnType<typeof createAuditCapture>["logger"];
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    ({ records: audits, logger: auditLogger } = createAuditCapture());
    app = createApp({ authMode: "enabled", enableStaticFallback: false, auditLogger });
    const started = await startServer(app);
    baseUrl = started.baseUrl;
    stop = started.stop;
  });

  afterEach(async () => {
    await stop();
  });

  it("rejects requests without Authorization", async () => {
    const { client, transport } = createMcpClient(baseUrl);
    await expect(client.connect(transport)).rejects.toThrow();
    await transport.close().catch(() => {});
  });

  it("rejects invalid Bearer tokens", async () => {
    const { client, transport } = createMcpClient(baseUrl, "sui_tok_invalidtoken");
    await expect(client.connect(transport)).rejects.toThrow();
    await transport.close().catch(() => {});
  });

  it("rejects revoked tokens", async () => {
    const { token, record } = await createApiTokenRecord("revoked-test");
    await revokeApiToken(record.id);

    const { client, transport } = createMcpClient(baseUrl, token);
    await expect(client.connect(transport)).rejects.toThrow();
    await transport.close().catch(() => {});
  });

  it("rejects session cookie authentication", async () => {
    const { token } = await createAuthSession({ issuer: "test", subject: "test-sub" });

    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Cookie: `sui_session=${token}`,
      },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(audits[0]).toMatchObject({
      path: "/mcp", status: 401, clientSource: "mcp", authKind: null, subject: null, authMode: "enabled",
    });
    expect(JSON.stringify(audits)).not.toContain(token);
  });

  it("records MCP entrance failures without a token or session secret", async () => {
    const { token, record } = await createApiTokenRecord("audit-entrance");
    const unauthorized = await fetch(`${baseUrl}/mcp?code=private-query`, {
      method: "POST",
      headers: { Authorization: "Bearer sui_tok_invalid" },
    });
    const missingSession = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "mcp-session-id": "private-session" },
    });
    expect(unauthorized.status).toBe(401);
    expect(missingSession.status).toBe(404);
    const logs = audits;
    expect(logs).toHaveLength(2);
    expect(logs).toContainEqual(expect.objectContaining({ path: "/mcp", status: 401, subject: null }));
    expect(logs).toContainEqual(expect.objectContaining({
      path: "/mcp", status: 404, authKind: "token", apiTokenId: record.id,
    }));
    expect(JSON.stringify(logs)).not.toContain("private-query");
    expect(JSON.stringify(logs)).not.toContain("private-session");
    expect(JSON.stringify(logs)).not.toContain(token);
  });

  it("records MCP rate limiting as HTTP 429", async () => {
    vi.stubEnv("SUI_MCP_MAX_REQUESTS_PER_MINUTE", "1");
    const limited = await startServer(createApp({ authMode: "enabled", enableStaticFallback: false, auditLogger }));
    try {
      const { token, record } = await createApiTokenRecord("audit-rate-limit");
      const request = () => fetch(`${limited.baseUrl}/mcp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "mcp-session-id": "missing" },
      });
      expect((await request()).status).toBe(404);
      expect((await request()).status).toBe(429);
      expect(audits.filter((item) => item.path === "/mcp" && item.status === 429))
        .toContainEqual(expect.objectContaining({ apiTokenId: record.id, authKind: "token" }));
    } finally {
      await limited.stop();
      vi.unstubAllEnvs();
    }
  });

  it("lists tools with a valid token", async () => {
    const { token } = await createApiTokenRecord("valid-test");
    const { client, transport } = createMcpClient(baseUrl, token);

    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "get_dashboard")).toBe(true);

    await closeMcpClient(client, transport);
  });

  it("rejects write tools for read-only tokens", async () => {
    const { token } = await createApiTokenRecord("readonly-test", true);
    const { client, transport } = createMcpClient(baseUrl, token);

    await client.connect(transport);
    const result = (await client.callTool({
      name: "create_account",
      arguments: {
        name: "Test",
        balance: 0,
        balanceOffset: 0,
        currencyCode: "JPY",
        exchangeRateToJpy: 1,
        sortOrder: 0,
      },
    })) as { isError?: boolean; content: Array<{ type: string; text?: string }> };

    await closeMcpClient(client, transport);

    expect(result.isError).toBe(true);
    expect(audits.filter((item) => item.path === "/mcp")).toEqual([]);
    expect(JSON.parse(result.content[0].text!)).toMatchObject({ status: "error", error: { httpStatus: 403, requestId: expect.any(String) } });
    expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("Read-only token");
    const logs = audits.filter((item) => item.path === "/api/accounts");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      path: "/api/accounts", status: 403, clientSource: "mcp", authKind: "token",
    });

  });

  it("rejects a read-only token reusing a read-write session id", async () => {
    const { token: writeToken } = await createApiTokenRecord("write-session-test");
    const { token: readToken } = await createApiTokenRecord("read-session-test", true);

    const { client, transport } = createMcpClient(baseUrl, writeToken);
    await client.connect(transport);
    const sessionId = transport.sessionId;
    expect(sessionId).toBeDefined();

    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${readToken}`,
        "mcp-session-id": sessionId ?? "",
        "mcp-protocol-version": "2024-11-05",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Session not found" });

    await closeMcpClient(client, transport);
  });
});

describe("/mcp with auth disabled", () => {
  let app: Hono;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    app = createApp({ authMode: "disabled", enableStaticFallback: false });
    const started = await startServer(app);
    baseUrl = started.baseUrl;
    stop = started.stop;
  });

  afterEach(async () => {
    await stop();
  });

  it("allows MCP calls without Authorization", async () => {
    const { client, transport } = createMcpClient(baseUrl);
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "get_dashboard")).toBe(true);
    await closeMcpClient(client, transport);
  });

  it("keeps OAuth metadata disabled and outside the SPA fallback", async () => {
    const response = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "Not Found" });
  });
  describe("tool contracts over HTTP", () => {
    let client: Client;
    let transport: StreamableHTTPClientTransport;
    type Row = Record<string, unknown> & { id: string; currencyCode: string };
    type List = { items: Row[]; complete: boolean; nextPage: number | null };
    let mode: "structured" | "text" = "structured";

    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-23T03:00:00Z"));
      ({ client, transport } = createMcpClient(baseUrl));
      await client.connect(transport);
    });
    afterEach(async () => {
      await closeMcpClient(client, transport);
      vi.useRealTimers();
    });

    async function call<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError, JSON.stringify(result)).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }>;
      const json = JSON.parse(content.at(-1)!.text);
      expect(json).toEqual(result.structuredContent);
      expect(json.amountUnit).toBe("minor");
      expect(["success", "preview"]).toContain(json.status);
      return (mode === "text" ? json : result.structuredContent) as T;
    }
    async function account(currencyCode = "USD") {
      const result = await call<{ account: Row }>("create_account", {
        name: "同名口座", balance: 100000, balanceOffset: 0,
        currencyCode, exchangeRateToJpy: currencyCode === "JPY" ? 1 : 150, sortOrder: 0,
      });
      return result.account;
    }
    async function updateArguments(tool: string, row: Row) {
      const definition = (await client.listTools()).tools.find((entry) => entry.name === tool)!;
      return Object.fromEntries(Object.keys(definition.inputSchema.properties ?? {})
        .filter((key) => key in row).map((key) => [key, row[key]]));
    }

    const resources = [
      { singular: "credit_card", plural: "credit_cards", payload: { settlementDay: 27, dateShiftPolicy: "next", assumptions: [{ amount: 1234, startMonth: null, endMonth: null }], sortOrder: 2 } },
      { singular: "subscription", plural: "subscriptions", payload: { amount: 1234, currencyCode: "USD", exchangeRateToJpy: 150, recurrence: "weekly", interval: 2, startDate: "2026-09-01", dayOfWeek: 2, dayOfMonth: null, endDate: null, paymentSource: "外貨カード" } },
      { singular: "recurring_item", plural: "recurring_items", payload: { type: "expense", amount: 1234, recurrence: "monthly", interval: 2, startDate: "2026-09-01", endDate: null, dayOfMonth: 27, dayOfWeek: null, dateShiftPolicy: "next", enabled: true, sortOrder: 2 } },
      { singular: "loan", plural: "loans", payload: { totalAmount: 123400, paymentCount: 12, startDate: "2026-09-01", paymentMethod: "account_withdrawal", dateShiftPolicy: "next" } },
    ];
    for (const responseMode of ["structured", "text"] as const) {
      it.each(resources)(`${responseMode}: selects a same-name $singular, updates from current values, previews and deletes`, async ({ singular, plural, payload }) => {
        mode = responseMode;
        const owner = await account();
        const args = { ...payload, name: "同じ名前", ...(singular === "subscription" ? {} : { accountId: owner.id }) };
        const first = await call<{ item: Row }>(`create_${singular}`, args);
        const second = await call<{ item: Row }>(`create_${singular}`, args);
        expect(first.item.id).not.toBe(second.item.id);
        expect(second.item.currencyCode).toBe("USD");
        const list = await call<List>(`list_${plural}`);
        expect(list.items).toHaveLength(2);
        expect(list.complete).toBe(true);
        const target = list.items.find((item) => item.id === second.item.id)!;
        expect(target).toBeDefined();
        expect(target).not.toHaveProperty("account");
        const updated = await call<{ item: Row }>(`update_${singular}`, { ...await updateArguments(`update_${singular}`, target), name: "選んだ対象" });
        expect(updated.item).toMatchObject({ id: target.id, name: "選んだ対象", currencyCode: "USD" });
        const preview = await call(`delete_${singular}`, { id: target.id });
        expect(preview).toMatchObject({ id: target.id, status: "preview", deleted: false, executed: false });
        expect((await call<List>(`list_${plural}`)).items).toHaveLength(2);
        expect(await call(`delete_${singular}`, { id: target.id, confirm: true })).toMatchObject({ id: target.id, deleted: true, executed: true });
        expect((await call<List>(`list_${plural}`)).items.map((item) => item.id)).toEqual([first.item.id]);
      });
    }

    it("uses account/transaction IDs across pages and preserves EUR amounts", async () => {
      mode = "text";
      const owner = await account("EUR");
      const accounts = await call<{ accounts: Row[] }>("list_accounts");
      const selected = accounts.accounts.find((item) => item.id === owner.id)!;
      await call("update_account", { ...await updateArguments("update_account", selected), name: "更新口座" });
      const created: Row[] = [];
      for (let i = 0; i < 2; i++) {
        created.push((await call<{ transaction: Row }>("create_transaction", { accountId: owner.id, type: "expense", amount: 1234, description: "同名取引", date: `2026-09-${20 + i}` })).transaction);
      }
      const firstPage = await call<List>("list_transactions", { limit: 1, accountId: owner.id });
      expect(firstPage).toMatchObject({ complete: false, nextPage: 2 });
      const secondPage = await call<List>("list_transactions", { limit: 1, page: firstPage.nextPage, accountId: owner.id });
      const target = secondPage.items[0];
      expect(target).toMatchObject({ id: created[0].id, amount: 1234, currencyCode: "EUR" });
      await call("update_transaction", { ...await updateArguments("update_transaction", target), amount: 1500 });
      await call("delete_transaction", { id: target.id });
      await call("delete_transaction", { id: target.id, confirm: true });
      expect((await call<List>("list_transactions", { accountId: owner.id })).items.map((item) => item.id)).toEqual([created[1].id]);
      const reconciled = await call<{ account: Row; adjustment: Row }>("reconcile_account", { accountId: owner.id, actualBalance: 90000 });
      expect(reconciled.account.id).toBe(owner.id);
      expect(reconciled.adjustment.id).toBeTruthy();
    });

    it.each(["subscription", "recurring_item"])("uses %s amount history IDs for update and delete", async (kind) => {
      mode = "text";
      const owner = await account();
      const config = resources.find((item) => item.singular === kind)!;
      const parent = await call<{ item: Row }>(`create_${kind}`, { ...config.payload, name: "履歴対象", accountId: owner.id });
      const key = kind === "subscription" ? "subscriptionId" : "recurringItemId";
      const args = { [key]: parent.item.id };
      const change = await call<Row>(`create_${kind}_amount_change`, { ...args, effectiveFrom: "2026-10-01", amount: 1500 });
      const list = await call<{ amountChanges: Row[] }>(`list_${kind}_amount_changes`, args);
      expect(list.amountChanges[0].id).toBe(change.id);
      expect(await call(`update_${kind}_amount_change`, { ...args, changeId: list.amountChanges[0].id, effectiveFrom: "2026-10-01", amount: 1700 })).toMatchObject({ id: change.id, currencyCode: "USD", amount: 1700 });
      expect(await call(`delete_${kind}_amount_change`, { ...args, changeId: change.id })).toMatchObject({ ...args, id: change.id, executed: false });
      await call(`delete_${kind}_amount_change`, { ...args, changeId: change.id, confirm: true });
      expect(await call(`list_${kind}_amount_changes`, args)).toMatchObject({ amountChanges: [] });
    });

    it("gets people, split shares and settlements solely from preceding tools", async () => {
      mode = "text";
      await testPrisma.person.createMany({ data: [{ name: "同じ名前", sortOrder: 0 }, { name: "同じ名前", sortOrder: 1 }] });
      const people = await call<{ people: Row[] }>("list_people");
      expect(people.people).toHaveLength(2);
      const personId = people.people[1].id;
      const created = await call<{ split: Row; shares: Row[] }>("set_transaction_split", { date: "2026-09-20", description: "食事", amount: 2000, method: "equal", shares: [{ personId }] });
      const list = await call<List>("list_splits", { personId });
      const split = list.items.find((row) => row.id === created.split.id)!;
      await call("set_transaction_split", { ...await updateArguments("set_transaction_split", split), splitId: split.id, description: "更新した食事" });
      const summary = await call<{ shares: Row[] }>("get_person_summary", { personId });
      const settlement = await call<{ settlement: Row }>("create_settlement", { kind: "offset", personId, date: "2026-09-21", allocations: [{ shareId: summary.shares[0].id, amount: 1000 }] });
      const settled = await call<{ settlements: Row[] }>("get_person_summary", { personId });
      expect(settled.settlements[0].id).toBe(settlement.settlement.id);
      expect(await call("delete_settlement", { settlementId: settled.settlements[0].id })).toMatchObject({ id: settlement.settlement.id, deleted: true });
    });

    it("uses a month key and a forecast event ID to record a human-confirmed transaction", async () => {
      mode = "structured";
      const owner = await account();
      const card = await call<{ item: Row }>("create_credit_card", { ...resources[0].payload, name: "外貨カード", accountId: owner.id });
      const billing = await call<{ yearMonth: string }>("get_billing", { month: "2026-09" });
      const updated = await call<{ items: Row[] }>("update_billing", { yearMonth: billing.yearMonth, items: [{ creditCardId: card.item.id, amount: 1234 }] });
      expect(updated.items[0]).toMatchObject({ creditCardId: card.item.id, currencyCode: "USD", amount: 1234 });
      const dashboard = await call<{ forecast: Row[] }>("get_dashboard");
      const event = dashboard.forecast.find((row) => row.id.startsWith(`credit-card:${card.item.id}:`))!;
      expect(event).toBeDefined();
      const confirmed = await call<{ transaction: Row }>("confirm_forecast", { forecastEventId: event.id, accountId: owner.id, amount: 1234 });
      expect(confirmed.transaction).toMatchObject({ forecastEventId: event.id, accountId: owner.id, currencyCode: "USD", amount: 1234 });
      expect(confirmed.transaction.id).toBeTruthy();
      await expectApiError("confirm_forecast", { forecastEventId: event.id, amount: 1234 }, 409);
    });

    async function expectApiError(name: string, args: Record<string, unknown>, httpStatus: number) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
      const json = JSON.parse((result.content as Array<{ text: string }>).at(-1)!.text);
      expect(json).toEqual(result.structuredContent);
      expect(json).toMatchObject({ status: "error", error: { httpStatus, requestId: expect.any(String), message: expect.any(String) } });
      expect(JSON.stringify(json)).not.toMatch(/stack|sui_tok_/);
      return json;
    }

    it("returns structured 400/404 errors and complete empty lists", async () => {
      const emptyLists = ["list_accounts", "list_transactions", "list_credit_cards", "list_subscriptions", "list_recurring_items", "list_loans", "list_people", "list_splits"];
      for (const name of emptyLists) {
        const data = await call<Record<string, unknown>>(name);
        expect(data.complete).toBe(true);
        expect(data[name === "list_accounts" ? "accounts" : name === "list_people" ? "people" : "items"]).toEqual([]);
      }
      const invalid = await expectApiError("create_account", { name: "範囲外", balance: 2147483648, balanceOffset: 0, currencyCode: "JPY", exchangeRateToJpy: 1, sortOrder: 0 }, 400);
      expect(invalid.error.details.fieldErrors.balance).toBeDefined();
      await expectApiError("delete_account", { id: "00000000-0000-4000-a000-000000000001", confirm: true }, 404);
    });

  });

});

describe("/mcp with Auth0-style OAuth access tokens", () => {
  const resource = "https://sui.example.com/mcp";
  let provider: MockMcpOAuthProvider;
  let audits: CapturedAudit[];
  let auditLogger: ReturnType<typeof createAuditCapture>["logger"];
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    provider = await startMockMcpOAuthProvider();
  });

  afterAll(async () => {
    await provider.stop();
  });

  beforeEach(() => {
    ({ records: audits, logger: auditLogger } = createAuditCapture());
    vi.stubEnv("SUI_AUTH_MODE", "enabled");
    vi.stubEnv("SUI_MCP_OAUTH_RESOURCE_URL", resource);
    vi.stubEnv("SUI_OIDC_ISSUER", provider.issuerUrl);
    vi.stubEnv("SUI_OIDC_ALLOWED_SUBJECTS", "allowed-sub");
  });

  afterEach(async () => {
    await stop?.();
    vi.unstubAllEnvs();
  });

  async function startOAuthApp(options: Parameters<typeof createApp>[0] = {}) {
    const app = createApp({
      authMode: "enabled",
      enableStaticFallback: false,
      auditLogger,
      mcpOAuthAllowInsecureUrlsForTests: true,
      ...options,
    });
    const started = await startServer(app);
    baseUrl = started.baseUrl;
    stop = started.stop;
    return app;
  }

  async function token(options: Parameters<MockMcpOAuthProvider["signAccessToken"]>[0] = {}) {
    return provider.signAccessToken({ audience: resource, ...options });
  }

  it("publishes protected resource metadata and a host-independent Bearer challenge", async () => {
    await startOAuthApp();
    const metadata = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toEqual({
      resource,
      authorization_servers: [provider.issuerUrl],
      scopes_supported: ["read:sui", "write:sui"],
      bearer_methods_supported: ["header"],
    });

    const compatibility = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    expect(compatibility.status).toBe(200);

    const unauthorized = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { Host: "attacker.example", "X-Forwarded-Host": "attacker.example" },
    });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="https://sui.example.com/.well-known/oauth-protected-resource/mcp", scope="read:sui write:sui"`,
    );
  });

  it("runs tools, resources, and prompts with a valid access token", async () => {
    await startOAuthApp();
    const { client, transport } = createMcpClient(baseUrl, await token());
    await client.connect(transport);

    expect((await client.listTools()).tools.some((tool) => tool.name === "get_dashboard")).toBe(true);
    expect((await client.callTool({ name: "list_accounts", arguments: {} })).isError).not.toBe(true);
    expect((await client.readResource({ uri: "sui://dashboard" })).contents).toHaveLength(1);
    expect((await client.getPrompt({ name: "monthly-report", arguments: { month: "2026-09" } })).messages).toHaveLength(1);

    await closeMcpClient(client, transport);

    const readOnly = createMcpClient(baseUrl, await token({ scope: "read:sui" }));
    await readOnly.client.connect(readOnly.transport);
    expect((await readOnly.client.callTool({ name: "list_accounts", arguments: {} })).isError).not.toBe(true);
    const deniedWrite = await readOnly.client.callTool({
      name: "create_account",
      arguments: { name: "Denied", balance: 0, balanceOffset: 0, currencyCode: "JPY", exchangeRateToJpy: 1, sortOrder: 0 },
    });
    expect(deniedWrite.isError).toBe(true);
    await closeMcpClient(readOnly.client, readOnly.transport);
  });

  it("rejects missing read scope, denied subjects, invalid tokens, and unavailable verification", async () => {
    await startOAuthApp();

    const writeOnly = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await token({ scope: "write:sui" })}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(writeOnly.status).toBe(403);
    expect(writeOnly.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect(audits.find((item) => item.path === "/mcp" && item.status === 403))
      .toMatchObject({ authKind: "oauth", subject: "allowed-sub", oauthClientId: "chatgpt-client" });

    const denied = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await token({ subject: "denied" })}` },
    });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("www-authenticate")).toBeNull();

    const invalid = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer not-a-jwt" },
    });
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get("www-authenticate")).toContain('error="invalid_token"');

    await stop();
    stop = async () => {};
    vi.stubEnv("SUI_OIDC_ISSUER", "http://127.0.0.1:1");
    await startOAuthApp();
    const metadataUnavailable = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`);
    expect(metadataUnavailable.status).toBe(503);
    const unavailable = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer eyJ.invalid.token" },
    });
    expect(unavailable.status).toBe(503);
    const failures = audits.filter((item) => item.path === "/mcp");
    for (const status of [401, 503]) {
      expect(failures).toContainEqual(expect.objectContaining({ status, subject: null }));
    }
    expect(failures).toContainEqual(expect.objectContaining({ status: 403, subject: null }));
  });

  it("keeps API token authentication independent from OAuth provider availability", async () => {
    vi.stubEnv("SUI_OIDC_ISSUER", "http://127.0.0.1:1");
    await startOAuthApp();
    const { token: apiToken } = await createApiTokenRecord("oauth-outage-api-token");
    const { client, transport } = createMcpClient(baseUrl, apiToken);
    await client.connect(transport);
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
    await closeMcpClient(client, transport);

    const invalidApiToken = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer sui_tok_invalid" },
    });
    expect(invalidApiToken.status).toBe(401);
  });

  it("uses refreshed token scopes on an existing session and records OAuth audit identity", async () => {
    let waiting = 0;
    let release!: () => void;
    const bothRequestsArrived = new Promise<void>((resolve) => { release = resolve; });
    await startOAuthApp({
      mcpBeforeInternalRequestForTests: async ({ method, path }) => {
        if (method !== "POST" || path !== "/api/accounts") return;
        waiting += 1;
        if (waiting === 2) release();
        await bothRequestsArrived;
      },
    });

    const writeToken = await token({ scope: "read:sui write:sui", jti: "write-token" });
    const readToken = await token({ scope: "read:sui", jti: "read-token" });
    const { client, transport } = createMcpClient(baseUrl, writeToken);
    await client.connect(transport);
    const sessionId = transport.sessionId;
    expect(sessionId).toBeDefined();

    const call = (accessToken: string, id: number, name: string) => fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "mcp-session-id": sessionId!,
        "mcp-protocol-version": "2024-11-05",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "create_account",
          arguments: { name, balance: 0, balanceOffset: 0, currencyCode: "JPY", exchangeRateToJpy: 1, sortOrder: id },
        },
      }),
    });

    const [writeResponse, readResponse] = await Promise.all([
      call(writeToken, 11, "OAuth write"),
      call(readToken, 12, "OAuth read-only"),
    ]);
    await closeMcpClient(client, transport);
    expect(writeResponse.status).toBe(200);
    expect(readResponse.status).toBe(200);
    expect(await testPrisma.account.count()).toBe(1);
    expect(await testPrisma.account.findFirst()).toMatchObject({ name: "OAuth write" });

    const apiAudits = audits.filter((item) => item.path === "/api/accounts");
    expect(apiAudits).toHaveLength(2);
    expect(JSON.stringify(apiAudits)).not.toContain("write-token");
    expect(JSON.stringify(apiAudits)).not.toContain("read-token");
    expect(JSON.stringify(apiAudits)).not.toContain(writeToken);
    expect(JSON.stringify(apiAudits)).not.toContain(readToken);
    expect(apiAudits).toContainEqual(expect.objectContaining({
      status: 201,
      authKind: "oauth",
      subject: "allowed-sub",
      issuer: provider.issuerUrl,
      oauthClientId: "chatgpt-client",
      sessionId: null,
      apiTokenId: null,
      clientSource: "mcp",
    }));
    expect(apiAudits).toContainEqual(expect.objectContaining({
      status: 403,
      authKind: "oauth",
      subject: "allowed-sub",
      issuer: provider.issuerUrl,
      oauthClientId: "chatgpt-client",
      clientSource: "mcp",
    }));

  });

  it("prevents session reuse by another principal and rechecks the allowlist", async () => {
    await startOAuthApp();
    const accessToken = await token();
    const { client, transport } = createMcpClient(baseUrl, accessToken);
    await client.connect(transport);
    const sessionId = transport.sessionId!;

    const otherPrincipal = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await token({ clientId: "other-client" })}`,
        "mcp-session-id": sessionId,
        "mcp-protocol-version": "2024-11-05",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(otherPrincipal.status).toBe(404);

    const { token: apiToken } = await createApiTokenRecord("cannot-reuse-oauth-session");
    const apiTokenReuse = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "mcp-session-id": sessionId,
        "mcp-protocol-version": "2024-11-05",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(apiTokenReuse.status).toBe(404);

    vi.stubEnv("SUI_OIDC_ALLOWED_SUBJECTS", "someone-else");
    const noLongerAllowed = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "mcp-session-id": sessionId,
        "Content-Type": "application/json",
      },
    });
    expect(noLongerAllowed.status).toBe(403);

    vi.stubEnv("SUI_OIDC_ALLOWED_SUBJECTS", "allowed-sub");
    await closeMcpClient(client, transport);
  });

  it("rejects an expired refreshed request on an existing session", async () => {
    await startOAuthApp();
    const now = Math.floor(Date.now() / 1000);
    const expiringToken = await token({ issuedAtSeconds: now - 10, expiresInSeconds: 7 });
    const { client, transport } = createMcpClient(baseUrl, expiringToken);
    await client.connect(transport);
    const sessionId = transport.sessionId!;

    await new Promise((resolve) => setTimeout(resolve, 3_100));
    const expired = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${expiringToken}`,
        "mcp-session-id": sessionId,
        "Content-Type": "application/json",
      },
    });
    expect(expired.status).toBe(401);
    expect(expired.headers.get("www-authenticate")).toContain('error="invalid_token"');

    await transport.close().catch(() => {});
    await client.close();
  });

  it("does not accept OAuth JWTs or client marker headers on public REST APIs", async () => {
    await startOAuthApp();
    const accessToken = await token();
    const response = await fetch(`${baseUrl}/api/accounts`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "x-sui-client": "mcp",
      },
    });
    expect(response.status).toBe(401);

    const tokenManagement = await fetch(`${baseUrl}/api/auth/tokens`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "must-not-be-created" }),
    });
    expect(tokenManagement.status).toBe(401);
    expect(await testPrisma.apiToken.count()).toBe(0);
  });
});
