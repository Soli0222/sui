import { describe, expect, it } from "vitest";
import type { CreditCard } from "@sui/shared";
import { cardAssumptionPayload, cardBasicPayload, validatePeriod, validatePeriods } from "./credit-card-editor";

const saved = {
  id: "card-1", name: "保存済みの名前", settlementDay: 27, dateShiftPolicy: "none", accountId: "account-1", sortOrder: 2,
  assumptions: [{ amount: 10000, startMonth: null, endMonth: null }],
} as CreditCard;

describe("credit card update boundaries", () => {
  it("sends only basic fields when editing a card", () => {
    const payload = cardBasicPayload({ name: "新しい名前", settlementDay: 28, dateShiftPolicy: "next", accountId: "account-1", sortOrder: 2 });
    expect(payload).toEqual({ name: "新しい名前", settlementDay: 28, dateShiftPolicy: "next", accountId: "account-1", sortOrder: 2 });
    expect(payload).not.toHaveProperty("assumptions");
    expect(payload).not.toHaveProperty("assumptionAmount");
  });

  it("sends saved basic values with a corrected billing-month period", () => {
    const payload = cardAssumptionPayload(saved, [{ amount: 0, startMonth: "2026-10", endMonth: "2026-10" }]);
    expect(payload).toEqual({ name: "保存済みの名前", settlementDay: 27, dateShiftPolicy: "none", accountId: "account-1", sortOrder: 2,
      assumptions: [{ amount: 0, startMonth: "2026-10", endMonth: "2026-10" }] });
  });
});


describe("billing-month period validation", () => {
  it("accepts an inclusive single month, an unbounded side, and a gap", () => {
    expect(validatePeriods([
      { amountRaw: "10000", startMonth: "", endMonth: "2026-10" },
      { amountRaw: "0", startMonth: "2026-12", endMonth: "2026-12" },
    ])).toEqual({});
  });

  it("rejects overlap at the shared endpoint and invalid amounts", () => {
    expect(validatePeriods([
      { amountRaw: "10000", startMonth: "2026-10", endMonth: "2026-11" },
      { amountRaw: "20000", startMonth: "2026-11", endMonth: "" },
    ])).toHaveProperty("periods");
    expect(validatePeriod({ amountRaw: "", startMonth: "", endMonth: "" })).toHaveProperty("amount");
    expect(validatePeriod({ amountRaw: "2147483648", startMonth: "", endMonth: "" })).toHaveProperty("amount");
  });
});
