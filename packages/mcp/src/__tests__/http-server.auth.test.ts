import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../api-client";
import { SuiApiClient } from "../api-client";
import type { CliOptions } from "../cli";
import { startHttpServer } from "../http-server";

const fetchImpl: FetchLike = async () =>
  new Response(JSON.stringify({ error: "unexpected upstream request" }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });

const baseOptions: CliOptions = {
  transport: "streamable-http",
  address: "127.0.0.1:0",
  basePath: "",
  endpointPath: "/mcp",
  help: false,
};

async function closeServer(server: Awaited<ReturnType<typeof startHttpServer>>) {
  server.close();
  await once(server, "close");
}

describe("HTTP MCP server auth", () => {
  const servers: Array<Awaited<ReturnType<typeof startHttpServer>>> = [];

  beforeEach(() => {
    vi.stubEnv("SUI_MCP_AUTH_MODE", "token");
    vi.stubEnv("SUI_MCP_AUTH_TOKEN", "test-token");
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(servers.splice(0).map(closeServer));
  });

  async function start() {
    const apiClient = new SuiApiClient("http://localhost:3000", fetchImpl);
    const server = await startHttpServer(baseOptions, apiClient);
    servers.push(server);
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }

  it("refuses to start in token mode without a token", async () => {
    vi.stubEnv("SUI_MCP_AUTH_TOKEN", "");
    await expect(start()).rejects.toThrow("MCP authentication is not configured");
  });

  it("serves health check without authentication", async () => {
    const url = await start();
    const response = await fetch(`${url}/healthz`);
    expect(response.status).toBe(200);
  });

  it("rejects MCP requests without a bearer token", async () => {
    const url = await start();
    const response = await fetch(`${url}/mcp`, { method: "POST" });
    expect(response.status).toBe(401);
    const wwwAuthenticate = response.headers.get("www-authenticate");
    expect(wwwAuthenticate).toContain("Bearer");
  });

  it("accepts MCP requests with a valid bearer token", async () => {
    const url = await start();
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
    });
    expect(response.status).not.toBe(401);
  });

  it("rejects MCP requests with an invalid bearer token", async () => {
    const url = await start();
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
    });
    expect(response.status).toBe(401);
  });

  it("provides OAuth protected resource metadata in oauth mode", async () => {
    vi.stubEnv("SUI_MCP_AUTH_MODE", "oauth");
    vi.stubEnv("SUI_MCP_OAUTH_ISSUER", "https://idp.example.com");
    vi.stubEnv("SUI_MCP_OAUTH_AUDIENCE", "https://mcp.example.com");
    vi.stubEnv("SUI_MCP_RESOURCE_URL", "https://mcp.example.com");

    const url = await start();
    const response = await fetch(`${url}/.well-known/oauth-protected-resource`);
    expect(response.status).toBe(200);
    const metadata = (await response.json()) as { resource: string; authorization_servers: string[] };
    expect(metadata.resource).toBe("https://mcp.example.com");
    expect(metadata.authorization_servers).toEqual(["https://idp.example.com"]);
  });
});
