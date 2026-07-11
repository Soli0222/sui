import { describe, expect, it } from "vitest";
import { addMonthsToYearMonth } from "./dates";

describe("addMonthsToYearMonth", () => {
  it("advances by one month in normal and year-crossing cases", () => {
    expect(addMonthsToYearMonth("2026-01", 1)).toBe("2026-02");
    expect(addMonthsToYearMonth("2026-11", 1)).toBe("2026-12");
    expect(addMonthsToYearMonth("2026-12", 1)).toBe("2027-01");
  });

  it("handles leap-year months without date parsing drift", () => {
    expect(addMonthsToYearMonth("2024-01", 1)).toBe("2024-02");
    expect(addMonthsToYearMonth("2024-02", 1)).toBe("2024-03");
    expect(addMonthsToYearMonth("2024-12", 1)).toBe("2025-01");
  });
});
