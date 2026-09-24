import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { SuiApiError } from "../client";
import { readOnlyToolAnnotations, registerTool, textContent } from "../helpers";

async function connect(handler: () => Promise<ReturnType<typeof textContent>>) {
  const server = new McpServer({ name: "output-contract-test", version: "1" });
  registerTool(server, "list_accounts", "口座を一覧する", {}, readOnlyToolAnnotations, handler);
  const client = new Client({ name: "output-contract-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  await client.listTools();
  return { client, close: async () => { await client.close(); await server.close(); } };
}

describe("MCP structured error output", () => {
  it.each([400, 403, 404, 409])("returns a structured HTTP %i error after tool discovery", async (status) => {
    const { client, close } = await connect(async () => { throw new SuiApiError("API rejected request", status, "request-1"); });
    try {
      const result = await client.callTool({ name: "list_accounts", arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({ status: "error", error: { message: "API rejected request", httpStatus: status, requestId: "request-1" } });
    } finally { await close(); }
  });

  it("returns a sanitized unexpected error after tool discovery", async () => {
    const { client, close } = await connect(async () => { throw new Error("private-secret"); });
    try {
      const result = await client.callTool({ name: "list_accounts", arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({ status: "error", error: { message: "ツールの実行に失敗しました", httpStatus: null, requestId: null } });
      expect(JSON.stringify(result)).not.toContain("private-secret");
    } finally { await close(); }
  });

  it("keeps success fields mandatory", async () => {
    const { client, close } = await connect(async () => textContent("missing complete", { accounts: [] }));
    try {
      const tool = (await client.listTools()).tools.find(({ name }) => name === "list_accounts");
      const branches = (tool?.outputSchema as { anyOf?: Array<{ properties?: { status?: { enum?: string[]; const?: string } }; required?: string[] }> })?.anyOf;
      expect(branches?.[0]?.properties?.status?.enum).toEqual(["success", "preview"]);
      expect(branches?.[0]?.required).toEqual(expect.arrayContaining(["status", "amountUnit", "accounts", "complete"]));
      expect(branches?.[1]?.properties?.status?.const).toBe("error");
      expect(branches?.[1]?.required).toEqual(["status", "error"]);
      const result = await client.callTool({ name: "list_accounts", arguments: {} });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.stringify(result.content)).toMatch(/Output validation error|does not match/);
    } finally { await close(); }
  });

  it("accepts a complete success DTO after tool discovery", async () => {
    const { client, close } = await connect(async () => textContent("ok", { accounts: [], complete: true }));
    try {
      const result = await client.callTool({ name: "list_accounts", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ status: "success", accounts: [], complete: true });
    } finally { await close(); }
  });
});
