import type { FurusatoSimulationInputPayload, FurusatoSimulationResponse } from "@sui/shared";
import { describe, expect, it } from "vitest";
import { getJstToday } from "../lib/dates";
import { createTestClient, parseJson } from "../test-helpers/app";
import { testPrisma } from "../test-helpers/db";
import { createDonation, createSalaryRecord } from "../test-helpers/fixtures";

const client = createTestClient();

describe("furusato simulation routes", () => {
  it("uses the current JST year and zero defaults when data is absent", async () => {
    const response = await client.get("/api/furusato/simulation");
    const body = await parseJson<FurusatoSimulationResponse>(response);

    expect(response.status).toBe(200);
    expect(body.year).toBe(Number(getJstToday().slice(0, 4)));
    expect(body.input).toEqual({ expectedBonusGross: 0, otherIncome: 0, otherDeductions: 0 });
    expect(body.projection.salaryActualGross).toBe(0);
    expect(body.donations.total).toBe(0);
    expect(body.limit).toBe(2_000);
  });

  it("returns the canonical result and excludes deleted or other-year records", async () => {
    await createSalaryRecord(testPrisma, {
      paidOn: new Date("2026-01-15T00:00:00.000Z"),
      grossAmount: 300_000,
      healthInsurance: 45_000,
    });
    await createSalaryRecord(testPrisma, {
      paidOn: new Date("2026-02-15T00:00:00.000Z"),
      grossAmount: 9_000_000,
      deletedAt: new Date("2026-03-01T00:00:00.000Z"),
    });
    await createSalaryRecord(testPrisma, {
      paidOn: new Date("2025-12-31T00:00:00.000Z"),
      grossAmount: 9_000_000,
    });
    await createDonation(testPrisma, {
      donatedOn: new Date("2026-04-01T00:00:00.000Z"),
      recipient: "Active City",
      amount: 30_000,
    });
    await createDonation(testPrisma, {
      donatedOn: new Date("2026-05-01T00:00:00.000Z"),
      recipient: "Deleted City",
      amount: 500_000,
      deletedAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    await createDonation(testPrisma, {
      donatedOn: new Date("2027-01-01T00:00:00.000Z"),
      recipient: "Next Year",
      amount: 500_000,
    });

    const response = await client.get("/api/furusato/simulation?year=2026");
    const body = await parseJson<FurusatoSimulationResponse>(response);

    expect(response.status).toBe(200);
    expect(body.projection).toEqual({
      salaryActualGross: 300_000,
      extrapolatedGross: 3_300_000,
      expectedGrossIncome: 3_600_000,
      socialInsurance: 540_000,
      employmentIncome: 2_440_000,
      totalIncome: 2_440_000,
      taxableIncomeNational: 1_020_000,
      taxableIncomeResident: 1_470_000,
      marginalTaxRate: 0.05,
    });
    expect(body.limit).toBe(36_631);
    expect(body.donations).toEqual({ total: 30_000, remaining: 6_631 });
    expect(body.deduction).toEqual({
      incomeTax: 1_429,
      residentBasic: 2_800,
      residentSpecial: 23_770,
      selfBurden: 2_001,
    });
  });

  it("creates and updates one input row per year", async () => {
    const initial = {
      year: 2026,
      expectedBonusGross: 500_000,
      otherIncome: 100_000,
      otherDeductions: 50_000,
    } satisfies FurusatoSimulationInputPayload;
    const created = await client.put("/api/furusato/simulation-input", initial);
    expect(created.status).toBe(200);
    expect(await parseJson(created)).toEqual(initial);

    const updatedPayload = { ...initial, expectedBonusGross: 700_000, otherDeductions: 80_000 };
    const updated = await client.put("/api/furusato/simulation-input", updatedPayload);
    expect(updated.status).toBe(200);
    expect(await parseJson(updated)).toEqual(updatedPayload);
    expect(await testPrisma.furusatoSimulationInput.count({ where: { year: 2026 } })).toBe(1);

    const simulation = await client.get("/api/furusato/simulation?year=2026");
    expect((await parseJson<FurusatoSimulationResponse>(simulation)).input).toEqual({
      expectedBonusGross: 700_000,
      otherIncome: 100_000,
      otherDeductions: 80_000,
    });
  });

  it("rejects malformed or unsupported query years", async () => {
    for (const year of ["2026-01", "0000", "9999"]) {
      const response = await client.get(`/api/furusato/simulation?year=${year}`);
      expect(response.status).toBe(400);
    }
  });

  it("strictly validates simulation inputs", async () => {
    const valid = {
      year: 2026,
      expectedBonusGross: 0,
      otherIncome: 0,
      otherDeductions: 0,
    };
    const invalidBodies = [
      { ...valid, extra: true },
      { ...valid, year: 0 },
      { ...valid, year: 9999 },
      { ...valid, expectedBonusGross: -1 },
      { ...valid, otherIncome: 0.5 },
      { ...valid, otherDeductions: 2_147_483_648 },
    ];

    for (const body of invalidBodies) {
      const response = await client.put("/api/furusato/simulation-input", body);
      expect(response.status).toBe(400);
    }
  });
});
