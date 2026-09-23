import { describe, expect, it } from "vitest";
import { formatCurrency } from "../lib/format";
import { getAnnualTotal, getMonthlySummary, getSubscriptionPricePeriods, getVisibleSubscriptionPricePeriods, isEndedSubscription, partitionSubscriptions, subscriptionBasicChanges, subscriptionBasicPayload, subscriptionInitialCorrectionPayload } from "./subscriptions";
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
  it("月内の価格変更を各発生日と合計に反映する", () => {
    const subscription = buildSubscription({ recurrence: "weekly", dayOfMonth: null, dayOfWeek: 5, startDate: "2026-07-01", amountChanges: [
      { id: "change", subscriptionId: "sub", effectiveFrom: "2026-07-17", amount: 1200, createdAt: "", updatedAt: "" },
    ] });
    const summary = getMonthlySummary([subscription], "2026-07");
    expect(summary.items.map((item) => item.amount)).toEqual([1000, 1000, 1200, 1200, 1200]);
    expect(summary.total).toBe(5600);
  });
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

describe("subscription price periods", () => {
  it("shows each price with its own inclusive period", () => {
    const subscription = buildSubscription({
      startDate: "2026-01-05",
      endDate: null,
      amountChanges: [
        { id: "later", subscriptionId: "sub", effectiveFrom: "2026-07-01", amount: 1200, createdAt: "", updatedAt: "" },
        { id: "next", subscriptionId: "sub", effectiveFrom: "2026-10-01", amount: 1400, createdAt: "", updatedAt: "" },
      ],
    });
    const periods = getSubscriptionPricePeriods([subscription]);
    expect(periods.map(({ amount, startDate, endDate }) => ({ amount, startDate, endDate }))).toEqual([
      { amount: 1000, startDate: "2026-01-05", endDate: "2026-06-30" },
      { amount: 1200, startDate: "2026-07-01", endDate: "2026-09-30" },
      { amount: 1400, startDate: "2026-10-01", endDate: null },
    ]);
  });

  it("does not show prices outside the contract period", () => {
    const subscription = buildSubscription({
      startDate: "2026-02-01",
      endDate: "2026-08-31",
      amountChanges: [
        { id: "prior", subscriptionId: "sub", effectiveFrom: "2026-01-01", amount: 900, createdAt: "", updatedAt: "" },
        { id: "inside", subscriptionId: "sub", effectiveFrom: "2026-07-01", amount: 1200, createdAt: "", updatedAt: "" },
        { id: "after", subscriptionId: "sub", effectiveFrom: "2026-09-01", amount: 1400, createdAt: "", updatedAt: "" },
      ],
    });
    expect(getSubscriptionPricePeriods([subscription]).map(({ amount, startDate, endDate }) => ({ amount, startDate, endDate }))).toEqual([
      { amount: 900, startDate: "2026-02-01", endDate: "2026-06-30" },
      { amount: 1200, startDate: "2026-07-01", endDate: "2026-08-31" },
    ]);
  });

  it("shows the current price first and future prices, hiding expired periods", () => {
    const subscription = buildSubscription({
      startDate: "2026-01-05",
      amountChanges: [
        { id: "current", subscriptionId: "sub", effectiveFrom: "2026-07-01", amount: 1200, createdAt: "", updatedAt: "" },
        { id: "future", subscriptionId: "sub", effectiveFrom: "2026-10-01", amount: 1400, createdAt: "", updatedAt: "" },
      ],
    });
    expect(getVisibleSubscriptionPricePeriods(subscription, "2026-09-23").map(({ amount }) => amount)).toEqual([1200, 1400]);
    expect(getVisibleSubscriptionPricePeriods(subscription, "2026-07-01").map(({ amount }) => amount)).toEqual([1200, 1400]);
    expect(getVisibleSubscriptionPricePeriods(subscription, "2026-06-30").map(({ amount }) => amount)).toEqual([1000, 1200, 1400]);
    expect(getVisibleSubscriptionPricePeriods({ ...subscription, endDate: "2026-08-31" }, "2026-09-23")).toEqual([]);
  });
});

describe("independent subscription edits", () => {
  it("keeps the saved initial price in a basic edit and uses current saved fields for an initial correction", () => {
    const saved = buildSubscription({ name: "Before", amount: 1000, paymentSource: "Visa" });
    const draft = { name: "After", amount: 9999, currencyCode: "JPY" as const, exchangeRateToJpy: 1,
      recurrence: "weekly" as const, interval: 2, startDate: saved.startDate, dayOfMonth: null,
      dayOfWeek: 3, endDate: null, paymentSource: "Bank" };
    expect(subscriptionBasicPayload(saved, draft)).toMatchObject({ name: "After", amount: 1000, paymentSource: "Bank" });
    expect(subscriptionInitialCorrectionPayload(saved, 1200)).toMatchObject({ name: "Before", amount: 1200, paymentSource: "Visa" });
    expect(subscriptionBasicChanges(saved, draft).map((change) => change.label)).toEqual([
      "サービス名", "周期・課金日", "支払い元",
    ]);
  });
});
