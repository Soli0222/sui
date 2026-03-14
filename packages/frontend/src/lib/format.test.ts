import { describe, expect, it } from "vitest";
import { formatChartDateWithYear, formatCurrency, formatDate, formatDateWithYear } from "./format";

describe("formatCurrency", () => {
  it("formats positive, zero, and negative yen values", () => {
    expect(formatCurrency(123456)).toMatch(/[¥￥]123,456/);
    expect(formatCurrency(0)).toMatch(/[¥￥]0/);
    expect(formatCurrency(-500)).toMatch(/-[¥￥]500/);
  });
});

describe("formatDate", () => {
  it("formats YYYY-MM-DD into M月D日(曜)", () => {
    expect(formatDate("2026-03-14")).toBe("3月14日(土)");
  });
});

describe("formatDateWithYear", () => {
  it("formats YYYY-MM-DD into YYYY年M月D日", () => {
    expect(formatDateWithYear("2026-03-14")).toBe("2026年3月14日");
  });
});

describe("formatChartDateWithYear", () => {
  it("formats YYYY-MM-DD into YY/M/D", () => {
    expect(formatChartDateWithYear("2026-03-14")).toBe("26/3/14");
  });
});
