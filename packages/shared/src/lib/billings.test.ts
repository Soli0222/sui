import { describe, expect, it } from "vitest";
import { hasOverlappingAssumptions, isValidYearMonth, resolveBillingAmount, type BillingAssumption } from "./billings";

const periods: BillingAssumption[] = [
  { amount: 120000, startMonth: null, endMonth: "2026-10" },
  { amount: 80000, startMonth: "2026-12", endMonth: "2027-02" },
  { amount: 100000, startMonth: "2027-03", endMonth: null },
];

function resolve(yearMonth: string, actualAmount: number | null = null, assumptions = periods) {
  return resolveBillingAmount({ yearMonth, actualAmount, assumptions, monthOffset: 1 });
}

describe("credit card assumption periods", () => {
  it("selects each period's amount by inclusive billing month and leaves gaps at zero", () => {
    expect(resolve("2026-10")).toMatchObject({ amount: 120000, appliedAssumptionAmount: 120000, sourceType: "assumption" });
    expect(resolve("2026-11")).toMatchObject({ amount: 0, appliedAssumptionAmount: 0, sourceType: "none" });
    expect(resolve("2026-12")).toMatchObject({ amount: 80000, sourceType: "assumption" });
    expect(resolve("2027-02")).toMatchObject({ amount: 80000, sourceType: "assumption" });
    expect(resolve("2027-03")).toMatchObject({ amount: 100000, sourceType: "assumption" });
    expect(resolve("2026-11", null, [])).toMatchObject({ amount: 0, sourceType: "none" });
  });

  it("keeps actuals outside periods and applies the safety valve only inside a period", () => {
    expect(resolve("2026-11", 30000)).toMatchObject({ amount: 30000, sourceType: "actual", safetyValveApplied: false });
    expect(resolve("2026-11", 0)).toMatchObject({ amount: 0, sourceType: "actual", safetyValveApplied: false });
    expect(resolve("2026-12", 30000)).toMatchObject({ amount: 80000, sourceType: "safety-valve", safetyValveApplied: true });
  });

  it("detects inclusive overlaps while permitting adjacent months and gaps", () => {
    expect(hasOverlappingAssumptions(periods)).toBe(false);
    expect(hasOverlappingAssumptions([
      { amount: 1, startMonth: "2026-10", endMonth: "2026-11" },
      { amount: 2, startMonth: "2026-11", endMonth: "2026-12" },
    ])).toBe(true);
    expect(hasOverlappingAssumptions([
      { amount: 1, startMonth: null, endMonth: null },
      { amount: 2, startMonth: "2026-11", endMonth: null },
    ])).toBe(true);
  });

  it("validates a real four-digit year and month", () => {
    expect(isValidYearMonth("2026-12")).toBe(true);
    for (const invalid of ["0000-01", "2026-00", "2026-13", "2026-1", "2026-02-01"]) {
      expect(isValidYearMonth(invalid)).toBe(false);
    }
  });
});
