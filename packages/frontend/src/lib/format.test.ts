import { describe, expect, it } from "vitest";
import {
  formatChartDateWithYear,
  formatCurrency,
  formatCurrencyInputValue,
  formatCurrencyWithJpy,
  formatDate,
  formatDateWithYear,
  parseCurrencyInputValue,
} from "./format";

describe("formatCurrency", () => {
  it("formats positive, zero, and negative yen values", () => {
    expect(formatCurrency(123456)).toMatch(/[¥￥]123,456/);
    expect(formatCurrency(0)).toMatch(/[¥￥]0/);
    expect(formatCurrency(-500)).toMatch(/-[¥￥]500/);
  });

  it("formats foreign currencies from minor units", () => {
    expect(formatCurrency(123456, "USD")).toBe("$1,234.56");
    expect(formatCurrency(987, "EUR")).toBe("€9.87");
    expect(formatCurrencyWithJpy(123456, "USD", 185184)).toMatch(/\$1,234\.56 \/ [¥￥]185,184/);
  });
});

describe("currency input helpers", () => {
  it("formats and parses currency input values by minor unit", () => {
    expect(formatCurrencyInputValue(123456, "USD")).toBe("1234.56");
    expect(parseCurrencyInputValue("1234.56", "USD")).toBe(123456);
    expect(formatCurrencyInputValue(123456, "JPY")).toBe("123456");
    expect(parseCurrencyInputValue("123456", "JPY")).toBe(123456);
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
