import type { Subscription } from "@sui/shared";
import { describe, expect, it } from "vitest";
import { getAnnualTotal, getMonthlySummary, isActiveInMonth } from "./subscriptions";

function buildSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "11111111-1111-4111-a111-111111111111",
    name: "Subscription",
    amount: 1000,
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

describe("subscription services", () => {
  it("treats monthly subscriptions as active every month", () => {
    const subscription = buildSubscription({ interval: 1, startDate: "2026-01-10" });

    expect(isActiveInMonth(subscription, "2026-01")).toBe(true);
    expect(isActiveInMonth(subscription, "2026-02")).toBe(true);
    expect(isActiveInMonth(subscription, "2026-12")).toBe(true);
  });

  it("treats quarterly subscriptions as active every three months", () => {
    const subscription = buildSubscription({ interval: 3, startDate: "2026-02-01" });

    expect(isActiveInMonth(subscription, "2026-02")).toBe(true);
    expect(isActiveInMonth(subscription, "2026-03")).toBe(false);
    expect(isActiveInMonth(subscription, "2026-05")).toBe(true);
  });

  it("treats yearly subscriptions as active once per year", () => {
    const subscription = buildSubscription({ interval: 12, startDate: "2026-04-10" });

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
      interval: 6,
      startDate: "2026-01-01",
      endDate: null,
    });

    expect(isActiveInMonth(subscription, "2028-01")).toBe(true);
  });

  it("calculates monthly and annual totals for monthly subscriptions", () => {
    const monthly = buildSubscription({
      id: "11111111-1111-4111-a111-111111111112",
      name: "Monthly",
      amount: 1000,
      interval: 1,
      startDate: "2026-01-05",
      dayOfMonth: 5,
    });
    const quarterly = buildSubscription({
      id: "11111111-1111-4111-a111-111111111113",
      name: "Quarterly",
      amount: 6000,
      interval: 3,
      startDate: "2026-02-10",
      dayOfMonth: 10,
    });

    expect(getMonthlySummary([monthly, quarterly], "2026-02")).toEqual({
      items: [
        { subscription: monthly, date: "2026-02-05" },
        { subscription: quarterly, date: "2026-02-10" },
      ],
      total: 7000,
    });
    expect(getAnnualTotal([monthly, quarterly], 2026)).toBe(36000);
  });

  it("calculates weekly subscriptions by occurrence dates", () => {
    const weekly = buildSubscription({
      id: "11111111-1111-4111-a111-111111111114",
      name: "Weekly",
      amount: 500,
      recurrence: "weekly",
      interval: 1,
      dayOfMonth: null,
      dayOfWeek: 5,
      startDate: "2026-02-01",
    });

    const summary = getMonthlySummary([weekly], "2026-02");
    expect(summary.items).toHaveLength(4);
    expect(summary.items.every((item) => item.date.startsWith("2026-02"))).toBe(true);
    expect(summary.total).toBe(500 * 4);
  });

  it("does not activate weekly subscriptions before startDate", () => {
    const weekly = buildSubscription({
      id: "11111111-1111-4111-a111-111111111115",
      name: "Weekly",
      amount: 500,
      recurrence: "weekly",
      interval: 1,
      dayOfMonth: null,
      dayOfWeek: 0,
      startDate: "2026-02-15",
    });

    const summary = getMonthlySummary([weekly], "2026-02");
    expect(summary.items.every((item) => item.date >= "2026-02-15")).toBe(true);
  });

  it("returns 4 or 5 weekly occurrences depending on the month", () => {
    const weekly = buildSubscription({
      id: "11111111-1111-4111-a111-111111111116",
      name: "Weekly",
      amount: 1000,
      recurrence: "weekly",
      interval: 1,
      dayOfMonth: null,
      dayOfWeek: 5,
      startDate: "2026-01-01",
    });

    expect(getMonthlySummary([weekly], "2026-01").items).toHaveLength(5);
    expect(getMonthlySummary([weekly], "2026-02").items).toHaveLength(4);
  });

  it("respects endDate for weekly subscriptions", () => {
    const weekly = buildSubscription({
      id: "11111111-1111-4111-a111-111111111117",
      name: "Weekly",
      amount: 1000,
      recurrence: "weekly",
      interval: 1,
      dayOfMonth: null,
      dayOfWeek: 5,
      startDate: "2026-02-01",
      endDate: "2026-02-20",
    });

    const summary = getMonthlySummary([weekly], "2026-02");
    expect(summary.items).toHaveLength(3);
    expect(summary.items.map((item) => item.date)).toEqual([
      "2026-02-06",
      "2026-02-13",
      "2026-02-20",
    ]);
  });

  it("calculates annual total and monthly average for weekly subscriptions", () => {
    const weekly = buildSubscription({
      id: "11111111-1111-4111-a111-111111111118",
      name: "Weekly",
      amount: 1000,
      recurrence: "weekly",
      interval: 1,
      dayOfMonth: null,
      dayOfWeek: 5,
      startDate: "2026-01-01",
    });

    const annualTotal = getAnnualTotal([weekly], 2026);
    expect(annualTotal).toBe(1000 * 52);
    expect(annualTotal / 12).toBeCloseTo(1000 * 52 / 12, 2);
  });
});
