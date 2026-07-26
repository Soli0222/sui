import { describe, expect, it } from "vitest";
import { formatCurrency } from "../lib/format";
import { getAnnualTotal, getMonthlySummary, isEndedSubscription, partitionSubscriptions } from "./subscriptions";
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

describe("isEndedSubscription", () => {
  const today = "2026-03-14";

  it("終了日が今日なら現役", () => {
    const subscription = buildSubscription({ endDate: "2026-03-14" });
    expect(isEndedSubscription(subscription, today)).toBe(false);
  });

  it("終了日が昨日なら終了", () => {
    const subscription = buildSubscription({ endDate: "2026-03-13" });
    expect(isEndedSubscription(subscription, today)).toBe(true);
  });

  it("終了日が未設定なら現役", () => {
    const subscription = buildSubscription({ endDate: null });
    expect(isEndedSubscription(subscription, today)).toBe(false);
  });
});

describe("partitionSubscriptions", () => {
  const today = "2026-03-14";

  it("現役と終了済みに分離する", () => {
    const active = buildSubscription({ id: "active", endDate: null });
    const ended = buildSubscription({ id: "ended", endDate: "2026-03-13" });
    const { active: activeItems, archived } = partitionSubscriptions([active, ended], today);
    expect(activeItems).toHaveLength(1);
    expect(activeItems[0].id).toBe("active");
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe("ended");
  });
});
