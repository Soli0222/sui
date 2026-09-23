import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { InProcessSuiApiClient } from "../client";
import { toolOutputSchemas } from "../contracts";
import { buildServer } from "../server";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function connect(app = new Hono()) {
  const server = buildServer({ apiClient: new InProcessSuiApiClient(app) });
  const client = new Client({ name: "contract-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  cleanup.push(async () => { await client.close(); await server.close(); });
  return client;
}

describe("MCP public tool contracts", () => {
  it("keeps every registered tool in the inventory and output schema registry", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(Object.keys(toolOutputSchemas).sort()).toEqual(names);
    const doc = readFileSync(new URL("../../../../../docs/architecture/mcp-endpoint.md", import.meta.url), "utf8");
    const inventory = [...doc.matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1]).sort();
    expect(inventory).toEqual(names);
    for (const tool of tools) {
      expect(tool.outputSchema?.required).toEqual(expect.arrayContaining(["status", "amountUnit"]));
      expect(tool.description).toContain("structuredContent と同一");
    }
  });

  it("documents sources for all identifier arguments including nested command fields", async () => {
    const { tools } = await (await connect()).listTools();
    function visit(schema: unknown, field: string, context: string, tool: string) {
      if (!schema || typeof schema !== "object") return;
      const node = schema as Record<string, unknown>;
      const description = `${context} ${typeof node.description === "string" ? node.description : ""}`;
      if (/^(id|.*Id|.*Ids|version|yearMonth|month|from|to)$/.test(field)) {
        expect(description, `${tool}.${field}`).toMatch(/取得元|list_|get_|preview_|利用者|YYYY-MM/);
      }
      for (const [key, value] of Object.entries((node.properties ?? {}) as Record<string, unknown>)) {
        visit(value, key, description, tool);
      }
      if (node.items) visit(node.items, "", description, tool);
      for (const key of ["anyOf", "oneOf", "allOf"]) {
        for (const branch of (node[key] ?? []) as unknown[]) visit(branch, "", description, tool);
      }
    }
    for (const tool of tools) visit(tool.inputSchema, "", "", tool.name);
  });

  it.each([400, 403, 404, 409])("keeps HTTP %i diagnostics but omits credentials and raw error objects", async (status) => {
    const app = new Hono().get("/api/accounts", () => new Response(JSON.stringify({
      error: "Validation failed sui_tok_secret Bearer opaque-secret",
      token: "private-top-level-value", stack: "private-stack",
      details: { formErrors: ["Try again"], fieldErrors: { balance: ["Must be an integer"], token: ["private-field-value"] }, input: "private-body" },
    }), { status, headers: { "x-request-id": "request-test", "content-type": "application/json" } }));
    const client = await connect(app);
    const result = await client.callTool({ name: "list_accounts", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ status: "error", error: {
      httpStatus: status, requestId: "request-test", message: "Validation failed [redacted] [redacted]",
      details: { formErrors: ["Try again"], fieldErrors: { balance: ["Must be an integer"] } },
    } });
    expect(JSON.parse((result.content as Array<{ text: string }>)[0].text)).toEqual(result.structuredContent);
    expect(JSON.stringify(result)).not.toMatch(/private-|opaque-secret|sui_tok_secret/);
  });

  it("does not expose an unexpected exception message or stack", async () => {
    const server = buildServer({ apiClient: {
      get: async () => { throw new Error("private-secret"); },
      post: async () => { throw new Error("private-secret"); },
      put: async () => { throw new Error("private-secret"); },
      delete: async () => { throw new Error("private-secret"); },
    } });
    const client = new Client({ name: "error-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    cleanup.push(async () => { await client.close(); await server.close(); });
    const result = await client.callTool({ name: "list_accounts", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ status: "error", error: { httpStatus: null, requestId: null } });
    expect(JSON.stringify(result)).not.toMatch(/private-secret|stack/);
  });
});
