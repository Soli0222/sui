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
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeEach(async () => {
    app = createApp({ authMode: "enabled", enableStaticFallback: false });
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

    expect(result.isError).toBe(true);
    expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("Read-only token");

    await closeMcpClient(client, transport);
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
});

describe("/mcp with Auth0-style OAuth access tokens", () => {
  const resource = "https://sui.example.com/mcp";
  let provider: MockMcpOAuthProvider;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    provider = await startMockMcpOAuthProvider();
  });

  afterAll(async () => {
    await provider.stop();
  });

  beforeEach(() => {
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
    expect(writeResponse.status).toBe(200);
    expect(readResponse.status).toBe(200);
    expect(await testPrisma.account.count()).toBe(1);
    expect(await testPrisma.account.findFirst()).toMatchObject({ name: "OAuth write" });

    const audits = await testPrisma.auditLog.findMany({ where: { path: "/api/accounts" } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      authKind: "oauth",
      subject: "allowed-sub",
      issuer: provider.issuerUrl,
      oauthClientId: "chatgpt-client",
      sessionId: null,
      apiTokenId: null,
      clientSource: "mcp",
    });

    await closeMcpClient(client, transport);
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
