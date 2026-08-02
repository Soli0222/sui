import { describe, expect, it } from "vitest";
import { calculateFurusatoSimulation, type FurusatoCoreInput } from "./furusato-core";
import {
  basicDeductionNational,
  basicDeductionResident,
  employmentIncome,
  employmentIncomeDeduction,
  marginalIncomeTaxRate,
} from "./tax-parameters";

function buildInput(overrides: Partial<FurusatoCoreInput> = {}): FurusatoCoreInput {
  return {
    year: 2026,
    salaryRecords: [
      {
        paidOn: new Date("2026-01-15T00:00:00.000Z"),
        kind: "salary",
        grossAmount: 300_000,
        healthInsurance: 45_000,
        pensionInsurance: 0,
        employmentInsurance: 0,
      },
    ],
    donations: [],
    input: {
      expectedBonusGross: 0,
      otherIncome: 0,
      otherDeductions: 0,
    },
    referenceDate: new Date("2026-01-31T00:00:00.000Z"),
    ...overrides,
  };
}

describe("calculateFurusatoSimulation", () => {
  it("matches the canonical January salary and 30,000 donation example", () => {
    const input = buildInput({
      donations: [
        {
          donatedOn: new Date("2026-01-20T00:00:00.000Z"),
          amount: 30_000,
        },
      ],
    });

    const simulation = calculateFurusatoSimulation(input);

    expect(simulation).toEqual({
      year: 2026,
      input: {
        expectedBonusGross: 0,
        otherIncome: 0,
        otherDeductions: 0,
      },
      projection: {
        salaryActualGross: 300_000,
        extrapolatedGross: 3_300_000,
        expectedGrossIncome: 3_600_000,
        socialInsurance: 540_000,
        employmentIncome: 2_440_000,
        totalIncome: 2_440_000,
        taxableIncomeNational: 1_020_000,
        taxableIncomeResident: 1_470_000,
        marginalTaxRate: 0.05,
      },
      limit: 36_631,
      donations: {
        total: 30_000,
        remaining: 6_631,
      },
      deduction: {
        incomeTax: 1_429,
        residentBasic: 2_800,
        residentSpecial: 23_770,
        selfBurden: 2_001,
      },
    });
  });

  it.each([
    [1_900_000, 650_000, 1_250_000],
    [1_900_001, 650_000.3, 1_250_000.7],
    [3_600_000, 1_160_000, 2_440_000],
    [3_600_001, 1_160_000.2, 2_440_000.8],
    [6_600_000, 1_760_000, 4_840_000],
    [6_600_001, 1_760_000.1, 4_840_000.9],
    [8_500_000, 1_950_000, 6_550_000],
    [8_500_001, 1_950_000, 6_550_001],
  ])(
    "uses the formula directly at employment-income boundary %i",
    (gross, expectedDeduction, expectedIncome) => {
      expect(employmentIncomeDeduction(gross)).toBeCloseTo(expectedDeduction, 5);
      expect(employmentIncome(gross)).toBeCloseTo(expectedIncome, 5);
    },
  );

  it.each([
    [1_320_000, 950_000],
    [1_320_001, 880_000],
    [3_360_000, 880_000],
    [3_360_001, 680_000],
    [4_890_000, 680_000],
    [4_890_001, 630_000],
    [6_550_000, 630_000],
    [6_550_001, 580_000],
    [23_500_000, 580_000],
    [23_500_001, 480_000],
    [24_000_000, 480_000],
    [24_000_001, 320_000],
    [24_500_000, 320_000],
    [24_500_001, 160_000],
    [25_000_000, 160_000],
    [25_000_001, 0],
  ])("selects the national basic deduction at total income %i", (income, expected) => {
    expect(basicDeductionNational(income)).toBe(expected);
  });

  it.each([
    [24_000_000, 430_000],
    [24_000_001, 290_000],
    [24_500_000, 290_000],
    [24_500_001, 150_000],
    [25_000_000, 150_000],
    [25_000_001, 0],
  ])("selects the resident basic deduction at total income %i", (income, expected) => {
    expect(basicDeductionResident(income)).toBe(expected);
  });

  it.each([
    [1_949_000, 0.05],
    [1_949_001, 0.1],
    [3_299_000, 0.1],
    [3_299_001, 0.2],
    [6_949_000, 0.2],
    [6_949_001, 0.23],
    [8_999_000, 0.23],
    [8_999_001, 0.33],
    [17_999_000, 0.33],
    [17_999_001, 0.4],
    [39_999_000, 0.4],
    [39_999_001, 0.45],
  ])("selects the marginal rate at taxable income %i", (income, expected) => {
    expect(marginalIncomeTaxRate(income)).toBe(expected);
  });

  it.each([
    [0, 0, 0, 0, 0],
    [2_000, 0, 0, 0, 2_000],
    [2_001, 0, 0, 0, 2_001],
  ])(
    "does not calculate a deduction below the 2,000 yen floor for %i yen",
    (amount, incomeTax, residentBasic, residentSpecial, selfBurden) => {
      const result = calculateFurusatoSimulation(
        buildInput({
          donations:
            amount === 0
              ? []
              : [{ donatedOn: new Date("2026-02-01T00:00:00.000Z"), amount }],
        }),
      );
      expect(result.deduction).toEqual({ incomeTax, residentBasic, residentSpecial, selfBurden });
    },
  );

  it("caps the resident special deduction at 20% of resident income tax", () => {
    const result = calculateFurusatoSimulation(
      buildInput({
        donations: [{ donatedOn: new Date("2026-02-01T00:00:00.000Z"), amount: 100_000 }],
      }),
    );
    expect(result.deduction).toEqual({
      incomeTax: 5_002,
      residentBasic: 9_800,
      residentSpecial: 29_400,
      selfBurden: 55_798,
    });
  });

  it("returns the zero-income result without salary records", () => {
    const result = calculateFurusatoSimulation(buildInput({ salaryRecords: [] }));
    expect(result.projection).toEqual({
      salaryActualGross: 0,
      extrapolatedGross: 0,
      expectedGrossIncome: 0,
      socialInsurance: 0,
      employmentIncome: 0,
      totalIncome: 0,
      taxableIncomeNational: 0,
      taxableIncomeResident: 0,
      marginalTaxRate: 0.05,
    });
    expect(result.limit).toBe(2_000);
  });

  it("does not extrapolate from a bonus-only year", () => {
    const result = calculateFurusatoSimulation(
      buildInput({
        salaryRecords: [
          {
            paidOn: new Date("2026-06-15T00:00:00.000Z"),
            kind: "bonus",
            grossAmount: 1_000_000,
            healthInsurance: 100_000,
            pensionInsurance: 0,
            employmentInsurance: 0,
          },
        ],
      }),
    );
    expect(result.projection.salaryActualGross).toBe(1_000_000);
    expect(result.projection.extrapolatedGross).toBe(0);
    expect(result.projection.socialInsurance).toBe(100_000);
  });

  it("clamps taxable income to zero", () => {
    const result = calculateFurusatoSimulation(
      buildInput({
        salaryRecords: [],
        input: { expectedBonusGross: 0, otherIncome: 100_000, otherDeductions: 500_000 },
      }),
    );
    expect(result.projection.taxableIncomeNational).toBe(0);
    expect(result.projection.taxableIncomeResident).toBe(0);
  });

  it("does not extrapolate a December salary", () => {
    const result = calculateFurusatoSimulation(
      buildInput({
        salaryRecords: [
          {
            paidOn: new Date("2026-12-15T00:00:00.000Z"),
            kind: "salary",
            grossAmount: 300_000,
            healthInsurance: 45_000,
            pensionInsurance: 0,
            employmentInsurance: 0,
          },
        ],
      }),
    );
    expect(result.projection.extrapolatedGross).toBe(0);
    expect(result.projection.expectedGrossIncome).toBe(300_000);
    expect(result.projection.socialInsurance).toBe(45_000);
  });

  it("uses the latest salary record regardless of input order", () => {
    const result = calculateFurusatoSimulation(
      buildInput({
        salaryRecords: [
          {
            paidOn: new Date("2026-06-25T00:00:00.000Z"),
            kind: "salary",
            grossAmount: 200_000,
            healthInsurance: 20_000,
            pensionInsurance: 0,
            employmentInsurance: 0,
          },
          {
            paidOn: new Date("2026-01-25T00:00:00.000Z"),
            kind: "salary",
            grossAmount: 100_000,
            healthInsurance: 10_000,
            pensionInsurance: 0,
            employmentInsurance: 0,
          },
        ],
      }),
    );
    expect(result.projection.salaryActualGross).toBe(300_000);
    expect(result.projection.extrapolatedGross).toBe(1_200_000);
    expect(result.projection.expectedGrossIncome).toBe(1_500_000);
    expect(result.projection.socialInsurance).toBe(150_000);
  });
});
