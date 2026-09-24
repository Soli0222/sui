import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import type { SuiApiClient } from "../client";
import { apiParity } from "../api-parity";
import { buildServer } from "../server";

const UUID = "11111111-1111-4111-8111-111111111111";
const STOP = new Error("dispatch recorded");
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

interface JsonSchema {
  const?: unknown;
  enum?: unknown[];
  default?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minItems?: number;
  minimum?: number;
  format?: string;
}
function example(schema: JsonSchema, field = ""): unknown {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.anyOf || schema.oneOf) {
    const branches = schema.anyOf ?? schema.oneOf ?? [];
    if (branches.length === 0) throw new Error(`Empty union schema for ${field}`);
    return example(branches.find((branch: JsonSchema) => branch.type !== "null") ?? branches[0]!, field);
  }
  if (schema.type === "object" || schema.properties) {
    return Object.fromEntries((schema.required ?? []).map((name: string) => [name, example(schema.properties?.[name] ?? {}, name)]));
  }
  if (schema.type === "array") return Array.from({ length: schema.minItems ?? 0 }, () => example(schema.items ?? {}));
  if (schema.type === "boolean") return field === "confirm";
  if (schema.type === "number" || schema.type === "integer") return Math.max(schema.minimum ?? 0, 1);
  if (schema.type === "string") {
    if (schema.format === "uuid" || /(^id$|Id$|Ids$)/.test(field)) return UUID;
    if (field === "yearMonth" || field === "month") return "2026-01";
    if (field === "year") return "2026";
    if (/date|Date|paidOn|donatedOn|effectiveFrom|from|to/i.test(field)) return "2026-01-01";
    if (field === "base64") return "";
    if (field === "filename") return "sample.csv";
    return "example";
  }
  return null;
}

function routeMatches(route: string, call: string) {
  const [method, template] = route.split(" ");
  const [actualMethod, rawPath] = call.split(" ");
  const pattern = `^${template.replace(/:[^/]+/g, "[^/]+")}$`;
  return method === actualMethod && new RegExp(pattern).test(rawPath.split("?")[0]);
}

describe("MCP to API dispatch", () => {
  it("invokes the mapped method and path for every business operation", async () => {
    const calls: string[] = [];
    let expectedRoute = "";
    const record = <T,>(method: string, path: string): Promise<T> => {
      const call = `${method} ${path}`;
      calls.push(call);
      if (routeMatches(expectedRoute, call)) return Promise.reject(STOP);
      if (path.startsWith("/api/credit-cards") && method === "GET") {
        return Promise.resolve([{ id: UUID, name: "example", currencyCode: "JPY" }] as T);
      }
      if (method === "GET") return Promise.resolve([] as T);
      return Promise.reject(STOP);
    };
    const apiClient: SuiApiClient = {
      get: (path) => record("GET", path),
      post: (path) => record("POST", path),
      put: (path) => record("PUT", path),
      patch: (path) => record("PATCH", path),
      delete: (path) => record("DELETE", path),
    };
    const server = buildServer({ apiClient });
    const client = new Client({ name: "dispatch-test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await client.connect(b);
    cleanup.push(async () => { await client.close(); await server.close(); });
    const toolSchemas = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool.inputSchema]));
    const failures: string[] = [];
    for (const [route, operations] of Object.entries(apiParity)) {
      if (!Array.isArray(operations)) continue;
      for (const operation of operations) {
        if (route === "GET /api/dashboard/events") continue; // second dispatch is checked with a successful first response in contracts.test.ts
        calls.length = 0;
        expectedRoute = route;
        const schema = toolSchemas.get(operation);
        if (!schema) { failures.push(`${route} <- ${operation}: tool missing`); continue; }
        const args = example(schema) as Record<string, unknown>;
        if (operation.startsWith("delete_") || operation === "import_data") args.confirm = true;
        if (operation === "create_transaction" || operation === "update_transaction") args.accountId = UUID;
        if (operation === "update_spending") args.command = { action: "cancel", id: UUID, reason: "example" };
        if (route === "PUT /api/splits/:id") args.splitId = UUID;
        await client.callTool({ name: operation, arguments: args });
        if (!calls.some((call) => routeMatches(route, call))) {
          failures.push(`${route} <- ${operation}: called ${JSON.stringify(calls)} with ${JSON.stringify(args)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
