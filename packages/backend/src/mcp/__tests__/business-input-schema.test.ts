import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { donationCreatePayloadShape, donationUpdatePayloadShape } from "../../routes/donations";
import { furusatoSimulationInputShape } from "../../routes/furusato";
import { salaryCreatePayloadShape, salaryUpdatePayloadShape } from "../../routes/salary-records";
import { updateUiSettingsShape } from "../../routes/settings";
import { exportDataSchema } from "../../routes/data-transfer";
import { InProcessSuiApiClient } from "../client";
import { buildServer } from "../server";
import { Hono } from "hono";

describe("business MCP input schema parity", () => {
  it("exposes exactly the API fields with matching required and optional inputs", async () => {
    const server = buildServer({ apiClient: new InProcessSuiApiClient(new Hono()) });
    const client = new Client({ name: "business-schema-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const { tools } = await client.listTools();
      const actual = new Map(tools.map((tool) => [tool.name, tool.inputSchema]));
      const cases: Array<[string, Record<string, unknown>, string[]]> = [
        ["create_salary_record", salaryCreatePayloadShape, ["paidOn", "grossAmount"]],
        ["update_salary_record", { id: null, ...salaryUpdatePayloadShape }, ["id"]],
        ["create_donation", donationCreatePayloadShape, ["recipient", "amount", "donatedOn"]],
        ["update_donation", { id: null, ...donationUpdatePayloadShape }, ["id"]],
        ["save_furusato_simulation_input", furusatoSimulationInputShape, ["year", "expectedBonusGross", "otherIncome", "otherDeductions"]],
        ["update_ui_settings", updateUiSettingsShape, []],
        ["import_data", { formatVersion: null, mode: null, data: exportDataSchema, confirm: null }, ["formatVersion", "mode", "data"]],
      ];
      for (const [name, shape, required] of cases) {
        const schema = actual.get(name) as { properties?: Record<string, unknown>; required?: string[] } | undefined;
        expect(schema, name).toBeDefined();
        expect(Object.keys(schema?.properties ?? {}).sort(), `${name} fields`).toEqual(Object.keys(shape).sort());
        expect([...(schema?.required ?? [])].sort(), `${name} required`).toEqual(required.sort());
      }
    } finally {
      await client.close();
      await server.close();
    }
  });
});
