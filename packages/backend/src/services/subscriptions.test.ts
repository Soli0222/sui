import type { Subscription } from "@sui/shared";
import { describe, expect, it } from "vitest";
import { getAnnualTotal, getMonthlySummary, isActiveInMonth } from "./subscriptions";

function buildSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "11111111-1111-4111-a111-111111111111",
    name: "Subscription",
    amount: 1000,
    intervalMonths: 1,
    startDate: "2026-01-10",
    dayOfMonth: 10,
    endDate: null,
    paymentSource: null,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("subscription services", () => {
  it("treats monthly subscriptions as active every month", () => {
    const subscription = buildSubscription({ intervalMonths: 1, startDate: "2026-01-10" });

    expect(isActiveInMonth(subscription, "2026-01")).toBe(true);
    expect(isActiveInMonth(subscription, "2026-02")).toBe(true);
    expect(isActiveInMonth(subscription, "2026-12")).toBe(true);
  });

  it("treats quarterly subscriptions as active every three months", () => {
    const subscription = buildSubscription({ intervalMonths: 3, startDate: "2026-02-01" });

    expect(isActiveInMonth(subscription, "2026-02")).toBe(true);
    expect(isActiveInMonth(subscription, "2026-03")).toBe(false);
    expect(isActiveInMonth(subscription, "2026-05")).toBe(true);
  });

  it("treats yearly subscriptions as active once per year", () => {
    const subscription = buildSubscription({ intervalMonths: 12, startDate: "2026-04-15" });

    expect(isActiveInMonth(subscription, "2026-04")).toBe(true);
    expect(isActiveInMonth(subscription, "2026-10")).toBe(false);
    expect(isActiveInMonth(subscription, "2027-04")).toBe(true);
  });

  it("does not activate before the start month", () => {
    const subscription = buildSubscription({ startDate: "2026-05-01" });
    expect(isActiveInMonth(subscription, "2026-04")).toBe(false);
  });

  it("does not activate after the end month", () => {
    const subscription = buildSubscription({
      startDate: "2026-01-01",
      endDate: "2026-06-30",
    });

    expect(isActiveInMonth(subscription, "2026-06")).toBe(true);
    expect(isActiveInMonth(subscription, "2026-07")).toBe(false);
  });

  it("keeps null endDate subscriptions active indefinitely", () => {
    const subscription = buildSubscription({
      intervalMonths: 6,
      startDate: "2026-01-01",
      endDate: null,
    });

    expect(isActiveInMonth(subscription, "2028-01")).toBe(true);
  });

  it("calculates monthly and annual totals", () => {
    const monthly = buildSubscription({
      id: "11111111-1111-4111-a111-111111111112",
      name: "Monthly",
      amount: 1000,
      intervalMonths: 1,
      startDate: "2026-01-05",
      dayOfMonth: 5,
    });
    const quarterly = buildSubscription({
      id: "11111111-1111-4111-a111-111111111113",
      name: "Quarterly",
      amount: 6000,
      intervalMonths: 3,
      startDate: "2026-02-10",
      dayOfMonth: 10,
    });

    expect(getMonthlySummary([monthly, quarterly], "2026-02")).toEqual({
      items: [monthly, quarterly],
      total: 7000,
    });
    expect(getAnnualTotal([monthly, quarterly], 2026)).toBe(36000);
  });
});
