import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addMonthsToYearMonth,
  fromDateOnlyString,
  getCurrentYearMonth,
  getDaysInMonth,
  isDateString,
  isYearMonth,
  parseYearMonth,
  resolveDateFromYearMonth,
  toDateOnlyString,
} from "./dates";

describe("dates", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the current year month in JST when called without args", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-31T16:30:00.000Z"));

    expect(getCurrentYearMonth()).toBe("2026-04");
  });

  it("returns the provided year month when today is passed", () => {
    expect(getCurrentYearMonth("2026-03-14")).toBe("2026-03");
  });

  it("parses a year month string", () => {
    expect(parseYearMonth("2026-03")).toEqual({ year: 2026, month: 3 });
  });

  it("validates year month strings", () => {
    expect(isYearMonth("2026-03")).toBe(true);
    expect(isYearMonth("2026-3")).toBe(false);
    expect(isYearMonth("2026/03")).toBe(false);
  });

  it("validates date strings", () => {
    expect(isDateString("2026-03-14")).toBe(true);
    expect(isDateString("2026-3-14")).toBe(false);
    expect(isDateString("2026/03/14")).toBe(false);
  });

  it("adds months across years and with negative offsets", () => {
    expect(addMonthsToYearMonth("2026-01", -1)).toBe("2025-12");
    expect(addMonthsToYearMonth("2026-11", 3)).toBe("2027-02");
  });

  it("returns the days in each month including leap years", () => {
    expect(getDaysInMonth(2026, 4)).toBe(30);
    expect(getDaysInMonth(2024, 2)).toBe(29);
    expect(getDaysInMonth(2025, 2)).toBe(28);
  });

  it("resolves dates and clamps to month end", () => {
    expect(resolveDateFromYearMonth("2026-02", 31)).toBe("2026-02-28");
    expect(resolveDateFromYearMonth("2024-02", 31)).toBe("2024-02-29");
  });

  it("converts nullable dates to YYYY-MM-DD", () => {
    expect(toDateOnlyString(new Date("2026-03-14T00:00:00.000Z"))).toBe("2026-03-14");
    expect(toDateOnlyString(null)).toBeNull();
  });

  it("converts date-only strings to UTC dates", () => {
    expect(fromDateOnlyString("2026-03-14").toISOString()).toBe("2026-03-14T00:00:00.000Z");
  });
});
