import type { UiSettingsResponse } from "@sui/shared";
import { describe, expect, it } from "vitest";
import { createTestClient, parseJson } from "../test-helpers/app";
import { testPrisma } from "../test-helpers/db";

const client = createTestClient();
const uiSettingKeys = [
  "ui_dashboard_default_period",
  "ui_transactions_default_period",
];

describe("settings routes", () => {
  it("returns built-in defaults when the UI setting rows are missing", async () => {
    await testPrisma.setting.deleteMany({
      where: { key: { in: uiSettingKeys } },
    });

    const response = await client.get("/api/settings");

    expect(response.status).toBe(200);
    expect(await parseJson<UiSettingsResponse>(response)).toEqual({
      dashboardDefaultPeriod: "next3Months",
      transactionsDefaultPeriod: "last3Months",
    });
  });

  it("falls back per key when stored values are unsupported", async () => {
    await testPrisma.setting.update({
      where: { key: "ui_dashboard_default_period" },
      data: { value: "unsupported" },
    });
    await testPrisma.setting.update({
      where: { key: "ui_transactions_default_period" },
      data: { value: "custom" },
    });

    const response = await client.get("/api/settings");

    expect(response.status).toBe(200);
    expect(await parseJson<UiSettingsResponse>(response)).toEqual({
      dashboardDefaultPeriod: "next3Months",
      transactionsDefaultPeriod: "last3Months",
    });
  });

  it("persists updates and returns them from subsequent GET requests", async () => {
    const updateResponse = await client.put("/api/settings", {
      dashboardDefaultPeriod: "next6Months",
      transactionsDefaultPeriod: "last1Year",
    });

    expect(updateResponse.status).toBe(200);
    expect(await parseJson<UiSettingsResponse>(updateResponse)).toEqual({
      dashboardDefaultPeriod: "next6Months",
      transactionsDefaultPeriod: "last1Year",
    });

    const saved = await testPrisma.setting.findMany({
      where: { key: { in: uiSettingKeys } },
      orderBy: { key: "asc" },
    });
    expect(saved.map(({ key, value }) => ({ key, value }))).toEqual([
      { key: "ui_dashboard_default_period", value: "next6Months" },
      { key: "ui_transactions_default_period", value: "last1Year" },
    ]);

    expect(await parseJson<UiSettingsResponse>(await client.get("/api/settings"))).toEqual({
      dashboardDefaultPeriod: "next6Months",
      transactionsDefaultPeriod: "last1Year",
    });
  });

  it("preserves the omitted setting during a partial update", async () => {
    await client.put("/api/settings", {
      transactionsDefaultPeriod: "last6Months",
    });

    const response = await client.put("/api/settings", {
      dashboardDefaultPeriod: "next1Month",
    });

    expect(response.status).toBe(200);
    expect(await parseJson<UiSettingsResponse>(response)).toEqual({
      dashboardDefaultPeriod: "next1Month",
      transactionsDefaultPeriod: "last6Months",
    });
  });

  it.each([
    ["custom transaction preset", { transactionsDefaultPeriod: "custom" }],
    ["unknown dashboard preset", { dashboardDefaultPeriod: "tomorrow" }],
    ["unknown key", { forecastMonths: "12" }],
    ["empty object", {}],
  ])("rejects invalid PUT payloads: %s", async (_name, payload) => {
    const response = await client.put("/api/settings", payload);

    expect(response.status).toBe(400);
  });
});
