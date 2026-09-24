import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { DASHBOARD_PERIOD_PRESETS, type DataExportResponse, type Donation, type SalaryRecord } from "@sui/shared";
import { describe, expect, it } from "vitest";
import { createTestApp } from "../../test-helpers/app";
import { testPrisma } from "../../test-helpers/db";
import { createApiTokenRecord } from "../../lib/auth";
import { createApp } from "../../app";
import { InProcessSuiApiClient } from "../client";
import { buildServer } from "../server";

async function connect() {
  const app = createTestApp();
  const server = buildServer({ apiClient: new InProcessSuiApiClient(app) });
  const client = new Client({ name: "business-parity-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, app, close: async () => { await client.close(); await server.close(); } };
}

async function connectReadOnly() {
  const { token } = await createApiTokenRecord("business-parity-read-only", true);
  const app = createApp({ authMode: "enabled", enableStaticFallback: false });
  const server = buildServer({ apiClient: new InProcessSuiApiClient(app, token) });
  const client = new Client({ name: "business-parity-read-only", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).not.toBe(true);
  return result.structuredContent as Record<string, unknown>;
}

describe("business API parity through MCP", () => {
  it("creates, reads, partially updates, and deletes salary records and donations", async () => {
    const { client, close } = await connect();
    try {
      const salary = (await call(client, "create_salary_record", {
        paidOn: "2026-06-25", grossAmount: 400000, kind: "salary", yearEndTaxAdjustment: -5000,
      })).item as SalaryRecord;
      expect(salary.netAmount).toBe(405000);
      expect(((await call(client, "list_salary_records", { year: 2026 })).items as SalaryRecord[]).map((item) => item.id)).toContain(salary.id);
      expect(((await call(client, "get_salary_record", { id: salary.id })).item as SalaryRecord).grossAmount).toBe(400000);
      const updatedSalary = (await call(client, "update_salary_record", { id: salary.id, name: "June" })).item as SalaryRecord;
      expect(updatedSalary).toMatchObject({ name: "June", grossAmount: 400000, yearEndTaxAdjustment: -5000 });
      expect((await call(client, "update_salary_record", { id: salary.id, name: null })).item).toMatchObject({ name: null, grossAmount: 400000 });
      expect((await call(client, "delete_salary_record", { id: salary.id })).executed).toBe(false);
      expect((await testPrisma.salaryRecord.findUniqueOrThrow({ where: { id: salary.id } })).deletedAt).toBeNull();
      expect((await call(client, "delete_salary_record", { id: salary.id, confirm: true })).deleted).toBe(true);

      const donation = (await call(client, "create_donation", { recipient: " 京都市 ", amount: 12000, donatedOn: "2026-07-01" })).item as Donation;
      expect(donation.recipient).toBe("京都市");
      expect(((await call(client, "list_donations", { year: 2026 })).items as Donation[]).map((item) => item.id)).toContain(donation.id);
      const updatedDonation = (await call(client, "update_donation", { id: donation.id, memo: "返礼品" })).item as Donation;
      expect(updatedDonation).toMatchObject({ recipient: "京都市", amount: 12000, memo: "返礼品" });
      expect((await call(client, "update_donation", { id: donation.id, memo: null })).item).toMatchObject({ memo: null, amount: 12000 });
      expect((await call(client, "delete_donation", { id: donation.id })).executed).toBe(false);
      expect((await testPrisma.donation.findUniqueOrThrow({ where: { id: donation.id } })).deletedAt).toBeNull();
      expect((await call(client, "delete_donation", { id: donation.id, confirm: true })).deleted).toBe(true);
    } finally { await close(); }
  });

  it("saves furusato inputs, gets the simulation, and changes UI settings", async () => {
    const { client, close } = await connect();
    try {
      const saved = await call(client, "save_furusato_simulation_input", {
        year: 2026, expectedBonusGross: 500000, otherIncome: 10000, otherDeductions: 12000,
      });
      expect(saved.input).toEqual({ year: 2026, expectedBonusGross: 500000, otherIncome: 10000, otherDeductions: 12000 });
      const simulation = (await call(client, "get_furusato_simulation", { year: 2026 })).simulation as { input: { expectedBonusGross: number } };
      expect(simulation.input.expectedBonusGross).toBe(500000);
      const current = (await call(client, "get_ui_settings")).settings as Record<string, unknown>;
      const desired = DASHBOARD_PERIOD_PRESETS.find((option) => option !== current.dashboardDefaultPeriod);
      const updated = (await call(client, "update_ui_settings", { dashboardDefaultPeriod: desired })).settings as Record<string, unknown>;
      expect(updated.dashboardDefaultPeriod).toBe(desired);
      expect(updated.transactionsDefaultPeriod).toBe(current.transactionsDefaultPeriod);
    } finally { await close(); }
  });

  it("exports full data, previews replacement without mutation, and imports it losslessly", async () => {
    const { client, app, close } = await connect();
    try {
      await call(client, "create_salary_record", { paidOn: "2026-06-25", grossAmount: 400000 });
      await call(client, "create_donation", { recipient: "京都市", amount: 12000, donatedOn: "2026-07-01" });
      const exported = (await call(client, "export_data")).export as DataExportResponse;
      expect(exported.data.salaryRecords).toHaveLength(1);
      expect(exported.data.donations).toHaveLength(1);
      const args = { formatVersion: exported.formatVersion, mode: "replace", data: exported.data };
      const preview = await call(client, "import_data", args);
      expect(preview).toMatchObject({ status: "preview", executed: false, counts: { salaryRecords: 1, donations: 1 } });
      expect(await testPrisma.salaryRecord.count()).toBe(1);
      const result = await call(client, "import_data", { ...args, confirm: true });
      expect(result).toMatchObject({ executed: true, counts: { salaryRecords: 1, donations: 1 } });
      const after = (await (await app.request("/api/export")).json()) as DataExportResponse;
      expect(after.data).toEqual(exported.data);
    } finally { await close(); }
  });

  it("allows read-only business reads and rejects every new mutation through API authorization", async () => {
    const { client, close } = await connectReadOnly();
    try {
      for (const name of ["list_salary_records", "list_donations", "get_furusato_simulation", "get_ui_settings", "export_data"]) {
        expect((await client.callTool({ name, arguments: {} })).isError).not.toBe(true);
      }
      const exported = (await call(client, "export_data")).export as DataExportResponse;
      const mutations = [
        ["create_salary_record", { paidOn: "2026-06-25", grossAmount: 100 }],
        ["update_salary_record", { id: "11111111-1111-4111-a111-111111111111", name: "X" }],
        ["delete_salary_record", { id: "11111111-1111-4111-a111-111111111111", confirm: true }],
        ["create_donation", { recipient: "X", amount: 100, donatedOn: "2026-06-25" }],
        ["update_donation", { id: "11111111-1111-4111-a111-111111111111", memo: "X" }],
        ["delete_donation", { id: "11111111-1111-4111-a111-111111111111", confirm: true }],
        ["save_furusato_simulation_input", { year: 2026, expectedBonusGross: 0, otherIncome: 0, otherDeductions: 0 }],
        ["update_ui_settings", { dashboardDefaultPeriod: "all" }],
        ["import_data", { formatVersion: exported.formatVersion, mode: "replace", data: exported.data, confirm: true }],
      ] as const;
      for (const [name, args] of mutations) {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError, name).toBe(true);
        expect(result.structuredContent, name).toMatchObject({ error: { httpStatus: 403 } });
      }
    } finally { await close(); }
  });
});
