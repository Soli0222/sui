import { describe, expect, it } from "vitest";
import { amountOnCurrencyChange, currencyScale, formatMinorDraft, majorRateToMinor, parseMajorDraft } from "./spending-request-editor";

describe("spending request currency boundary", () => {
  it("round trips USD 12.34 and a 150 JPY per dollar rate without changing minor-unit API values", () => {
    expect(currencyScale("USD")).toMatchObject({ known: true, digits: 2, factor: 100 });
    expect(formatMinorDraft(1234, "USD")).toBe("12.34");
    const amount = parseMajorDraft("12.34", "USD");
    const rate = majorRateToMinor("150", "USD");
    expect(amount).toBe(1234);
    expect(rate).toBe(1.5);
    expect(Math.round(amount! * rate!)).toBe(1851);
  });

  it("uses zero decimals for JPY and does not round fractional minor units", () => {
    expect(parseMajorDraft("1200", "JPY")).toBe(1200);
    expect(parseMajorDraft("1.5", "JPY")).toBeNull();
    expect(parseMajorDraft("0.29", "USD")).toBe(29);
    expect(amountOnCurrencyChange("1234", "JPY", "USD")).toBe("12.34");
    expect(amountOnCurrencyChange("12.34", "USD", "JPY")).toBe("1234");
    expect(amountOnCurrencyChange("1.", "USD", "JPY")).toBe("1.");
  });

  it("respects known three-decimal codes and keeps unknown codes in raw minor units", () => {
    expect(currencyScale("KWD")).toMatchObject({ known: true, digits: 3, factor: 1000 });
    expect(formatMinorDraft(1234, "KWD")).toBe("1.234");
    expect(parseMajorDraft("1.234", "KWD")).toBe(1234);
    expect(currencyScale("ZZZ")).toMatchObject({ known: false, factor: 1 });
    expect(formatMinorDraft(1234, "ZZZ")).toBe("1234");
    expect(parseMajorDraft("1234", "ZZZ")).toBe(1234);
    expect(parseMajorDraft("12.34", "ZZZ")).toBeNull();
  });
});
