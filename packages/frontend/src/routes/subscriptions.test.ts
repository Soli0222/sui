import { describe, expect, it } from "vitest";
import { formatCurrency } from "../lib/format";
import { getAnnualTotal, getMonthlySummary } from "./subscriptions";
import type { Subscription } from "@sui/shared";

function buildSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "11111111-1111-4111-a111-111111111111",
    name: "Subscription",
    amount: 1000,
    currencyCode: "JPY",
    exchangeRateToJpy: 1,
    exchangeRateUpdatedAt: "2026-01-01T00:00:00.000Z",
    recurrence: "monthly",
    interval: 1,
    startDate: "2026-01-10",
    dayOfMonth: 10,
    dayOfWeek: null,
    endDate: null,
    paymentSource: null,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("getMonthlySummary", () => {
  it("JPY サブスクの月合計を計算する", () => {
    const jpy = buildSubscription({
      id: "jpy-sub",
      name: "JPY",
      amount: 1000,
      startDate: "2026-01-05",
      dayOfMonth: 5,
    });

    const summary = getMonthlySummary([jpy], "2026-01");
    expect(summary.total).toBe(1000);
  });

  it("USD サブスクを JPY 換算で月合計に含める", () => {
    const usd = buildSubscription({
      id: "usd-sub",
      name: "USD",
      amount: 1099,
      currencyCode: "USD",
      exchangeRateToJpy: 150,
      startDate: "2026-01-05",
      dayOfMonth: 5,
    });
    const jpy = buildSubscription({
      id: "jpy-sub",
      name: "JPY",
      amount: 1000,
      startDate: "2026-01-10",
      dayOfMonth: 10,
    });

    const summary = getMonthlySummary([usd, jpy], "2026-01");
    expect(summary.total).toBe(1649 + 1000);
    expect(formatCurrency(usd.amount, usd.currencyCode)).toBe("$10.99");
    expect(formatCurrency(summary.total, "JPY")).toMatch(/[¥￥]2,649/);
  });
});

describe("getAnnualTotal", () => {
  it("USD サブスクを JPY 換算で年間合計に含める", () => {
    const usd = buildSubscription({
      id: "usd-sub",
      name: "USD",
      amount: 1099,
      currencyCode: "USD",
      exchangeRateToJpy: 150,
      startDate: "2026-01-05",
      dayOfMonth: 5,
    });
    const jpy = buildSubscription({
      id: "jpy-sub",
      name: "JPY",
      amount: 1000,
      startDate: "2026-01-10",
      dayOfMonth: 10,
    });

    expect(getAnnualTotal([usd, jpy], 2026)).toBe(1649 * 12 + 1000 * 12);
  });
});
