import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "../api-client";
import { SuiApiClient } from "../api-client";
import type { CliOptions } from "../cli";
import { startHttpServer } from "../http-server";
import { afterEach, describe, expect, it } from "vitest";

const fetchImpl: FetchLike = async () =>
  new Response(JSON.stringify({ error: "unexpected upstream request" }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });

function baseOptions(transport: CliOptions["transport"]): CliOptions {
  return {
    transport,
    address: "127.0.0.1:0",
    basePath: "",
    endpointPath: "/mcp",
    help: false,
  };
}

async function closeServer(server: Awaited<ReturnType<typeof startHttpServer>>) {
  server.close();
  await once(server, "close");
}

describe("HTTP MCP server", () => {
  const servers: Array<Awaited<ReturnType<typeof startHttpServer>>> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
  });

  async function start(options: CliOptions) {
    const apiClient = new SuiApiClient("http://localhost:3000", fetchImpl);
    const server = await startHttpServer(options, apiClient);
    servers.push(server);
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  it("serves a health check for HTTP transports", async () => {
    const url = await start(baseOptions("streamable-http"));

    const response = await fetch(`${url}/healthz`);

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("ok\n");
  });

  it("accepts streamable HTTP MCP clients", async () => {
    const url = await start(baseOptions("streamable-http"));
    const client = new Client({ name: "test-client", version: "1.0.0" });

    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
    const tools = await client.listTools();
    await client.close();

    expect(tools.tools.map((tool) => tool.name)).toContain("get_dashboard");
  });

  it("accepts legacy SSE MCP clients", async () => {
    const url = await start(baseOptions("sse"));
    const client = new Client({ name: "test-client", version: "1.0.0" });

    await client.connect(new SSEClientTransport(new URL(`${url}/sse`)));
    const tools = await client.listTools();
    await client.close();

    expect(tools.tools.map((tool) => tool.name)).toContain("get_dashboard");
  });
});
