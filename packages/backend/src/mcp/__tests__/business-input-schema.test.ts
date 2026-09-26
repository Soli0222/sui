import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { donationCreatePayloadShape, donationUpdatePayloadShape } from "../../schemas/donations";
import { furusatoSimulationInputShape } from "../../schemas/furusato";
import { salaryCreatePayloadShape, salaryUpdatePayloadShape } from "../../schemas/salary-records";
import { updateUiSettingsShape } from "../../schemas/settings";
import { exportDataSchema } from "../../schemas/data-transfer";
import { createPayloadSchema as recurringCreateSchema } from "../../schemas/recurring-items";
import { payloadSchema as subscriptionSchema } from "../../schemas/subscriptions";
import { transactionPayloadSchema } from "../../schemas/transactions";
import { createPayloadSchema as creditCardCreateSchema } from "../../schemas/credit-cards";
import { createPayloadSchema as loanCreateSchema } from "../../schemas/loans";
import { splitPayloadSchema } from "../../schemas/splits";
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
        ["create_transaction", transactionPayloadSchema.shape, ["date", "type", "description", "amount"]],
        ["update_transaction", { id: null, ...transactionPayloadSchema.shape }, ["id", "date", "type", "description", "amount"]],
        ["create_recurring_item", recurringCreateSchema.shape, ["name", "type", "amount", "startDate", "endDate", "enabled", "sortOrder"]],
        ["create_subscription", subscriptionSchema.def.in.shape, ["name", "amount", "startDate"]],
        ["create_credit_card", creditCardCreateSchema.shape, ["name", "accountId", "sortOrder"]],
        ["create_loan", loanCreateSchema.shape, ["name", "totalAmount", "paymentCount", "startDate", "accountId"]],
        ["set_transaction_split", { splitId: null, ...splitPayloadSchema.shape }, ["date", "description", "amount", "method", "shares"]],
      ];
      for (const [name, shape, required] of cases) {
        const schema = actual.get(name) as { properties?: Record<string, unknown>; required?: string[] } | undefined;
        expect(schema, name).toBeDefined();
        expect(Object.keys(schema?.properties ?? {}).sort(), `${name} fields`).toEqual(Object.keys(shape).sort());
        expect([...(schema?.required ?? [])].sort(), `${name} required`).toEqual(required.sort());
      }
      const properties = (name: string) => (actual.get(name) as { properties: Record<string, Record<string, unknown>> }).properties;
      expect(properties("create_transaction").type.enum).toEqual(["income", "expense", "transfer"]);
      expect(properties("create_subscription").interval.minimum).toBe(1);
      expect(properties("create_loan").paymentMethod.enum).toEqual(["account_withdrawal", "credit_card"]);
      expect(properties("set_transaction_split").ownRatio).toMatchObject({ anyOf: expect.any(Array) });
      expect(properties("create_recurring_item").dayOfMonth).toMatchObject({ anyOf: expect.any(Array) });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
