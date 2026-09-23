import { describe, expect, it } from "vitest";
import { isValidYearMonth, resolveBillingAmount } from "./billings";

describe("credit card assumption periods", () => {
  const resolve = (yearMonth: string, actualAmount: number | null, start: string | null, end: string | null) =>
    resolveBillingAmount({
      yearMonth,
      actualAmount,
      assumptionAmount: 120000,
      assumptionStartMonth: start,
      assumptionEndMonth: end,
      monthOffset: 1,
    });

  it("uses inclusive billing month boundaries and supports open ends", () => {
    expect(resolve("2026-09", null, "2026-10", "2026-11")).toMatchObject({ amount: 0, sourceType: "none" });
    expect(resolve("2026-10", null, "2026-10", "2026-11")).toMatchObject({ amount: 120000, sourceType: "assumption" });
    expect(resolve("2026-11", null, "2026-10", "2026-11")).toMatchObject({ amount: 120000, sourceType: "assumption" });
    expect(resolve("2026-12", null, "2026-10", "2026-11")).toMatchObject({ amount: 0, sourceType: "none" });
    expect(resolve("2026-09", null, null, "2026-11").amount).toBe(120000);
    expect(resolve("2026-12", null, "2026-10", null).amount).toBe(120000);
    expect(resolve("2026-09", null, null, null).amount).toBe(120000);
  });

  it("keeps actuals outside the period without a safety valve, including zero", () => {
    expect(resolve("2026-11", 30000, null, "2026-10")).toMatchObject({ amount: 30000, sourceType: "actual", safetyValveApplied: false });
    expect(resolve("2026-11", 0, null, "2026-10")).toMatchObject({ amount: 0, sourceType: "actual", safetyValveApplied: false });
    expect(resolve("2026-10", 30000, null, "2026-10")).toMatchObject({ amount: 120000, sourceType: "safety-valve", safetyValveApplied: true });
  });

  it("validates a real four-digit year and month", () => {
    expect(isValidYearMonth("2026-12")).toBe(true);
    for (const invalid of ["0000-01", "2026-00", "2026-13", "2026-1", "2026-02-01"]) {
      expect(isValidYearMonth(invalid)).toBe(false);
    }
  });
});
