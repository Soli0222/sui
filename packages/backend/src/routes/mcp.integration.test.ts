import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Hono } from "hono";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../app";
import { createApiTokenRecord, createAuthSession, revokeApiToken } from "../lib/auth";

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
  return { client, transport };
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
    const { token } = await createAuthSession("test-sub");

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
});
