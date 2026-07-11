import { describe, expect, it } from "vitest";
import { formatSchedule, getOccurrenceDatesInMonth } from "./schedule";

function schedule(
  overrides: Partial<{
    recurrence: "monthly" | "weekly";
    interval: number;
    dayOfMonth: number | null;
    dayOfWeek: number | null;
    startDate: string | null;
    endDate: string | null;
  }>,
) {
  return {
    recurrence: "monthly" as const,
    interval: 1,
    dayOfMonth: 1,
    dayOfWeek: null,
    startDate: null,
    endDate: null,
    ...overrides,
  };
}

describe("getOccurrenceDatesInMonth", () => {
  it("returns the monthly date for interval 1", () => {
    expect(getOccurrenceDatesInMonth(schedule({ dayOfMonth: 10 }), "2026-02")).toEqual(["2026-02-10"]);
    expect(getOccurrenceDatesInMonth(schedule({ dayOfMonth: 10 }), "2026-12")).toEqual(["2026-12-10"]);
  });

  it("returns the yearly date for interval 12 from the anchor month", () => {
    const yearly = schedule({ interval: 12, dayOfMonth: 10, startDate: "2026-04-10" });

    expect(getOccurrenceDatesInMonth(yearly, "2026-04")).toEqual(["2026-04-10"]);
    expect(getOccurrenceDatesInMonth(yearly, "2026-10")).toEqual([]);
    expect(getOccurrenceDatesInMonth(yearly, "2027-04")).toEqual(["2027-04-10"]);
  });

  it("returns the anchor month for interval 3", () => {
    const quarterly = schedule({ interval: 3, dayOfMonth: 10, startDate: "2026-02-10" });

    expect(getOccurrenceDatesInMonth(quarterly, "2026-02")).toEqual(["2026-02-10"]);
    expect(getOccurrenceDatesInMonth(quarterly, "2026-03")).toEqual([]);
    expect(getOccurrenceDatesInMonth(quarterly, "2026-05")).toEqual(["2026-05-10"]);
    expect(getOccurrenceDatesInMonth(quarterly, "2026-08")).toEqual(["2026-08-10"]);
  });

  it("rounds dayOfMonth 31 to the last day of shorter months", () => {
    const monthEnd = schedule({ dayOfMonth: 31 });

    expect(getOccurrenceDatesInMonth(monthEnd, "2026-02")).toEqual(["2026-02-28"]);
    expect(getOccurrenceDatesInMonth(monthEnd, "2026-04")).toEqual(["2026-04-30"]);
    expect(getOccurrenceDatesInMonth(monthEnd, "2026-05")).toEqual(["2026-05-31"]);
  });

  it("returns every weekly occurrence for interval 1", () => {
    const weekly = schedule({
      recurrence: "weekly",
      dayOfMonth: null,
      dayOfWeek: 0,
      startDate: "2026-01-01",
    });

    expect(getOccurrenceDatesInMonth(weekly, "2026-01")).toEqual([
      "2026-01-04",
      "2026-01-11",
      "2026-01-18",
      "2026-01-25",
    ]);
  });

  it("returns bi-weekly occurrences 14 days apart across month boundaries", () => {
    const biweekly = schedule({
      recurrence: "weekly",
      interval: 2,
      dayOfMonth: null,
      dayOfWeek: 5,
      startDate: "2026-01-02",
    });

    expect(getOccurrenceDatesInMonth(biweekly, "2026-01")).toEqual(["2026-01-02", "2026-01-16", "2026-01-30"]);
    expect(getOccurrenceDatesInMonth(biweekly, "2026-02")).toEqual(["2026-02-13", "2026-02-27"]);
  });

  it("omits the occurrence when the monthly day is before startDate in the start month", () => {
    const boundary = schedule({ dayOfMonth: 10, startDate: "2026-03-15" });

    expect(getOccurrenceDatesInMonth(boundary, "2026-03")).toEqual([]);
    expect(getOccurrenceDatesInMonth(boundary, "2026-04")).toEqual(["2026-04-10"]);
  });

  it("omits the occurrence when the endDate is before the monthly day", () => {
    const boundary = schedule({ dayOfMonth: 10, endDate: "2026-04-09" });

    expect(getOccurrenceDatesInMonth(boundary, "2026-04")).toEqual([]);
  });

  it("keeps the occurrence when the endDate is the same as the monthly day", () => {
    const boundary = schedule({ dayOfMonth: 10, endDate: "2026-04-10" });

    expect(getOccurrenceDatesInMonth(boundary, "2026-04")).toEqual(["2026-04-10"]);
  });

  it("omits weekly occurrences before startDate", () => {
    const weekly = schedule({
      recurrence: "weekly",
      dayOfMonth: null,
      dayOfWeek: 0,
      startDate: "2026-02-15",
    });

    expect(getOccurrenceDatesInMonth(weekly, "2026-02")).toEqual(["2026-02-15", "2026-02-22"]);
  });

  it("returns an empty array when interval > 1 and startDate is missing for monthly", () => {
    const noStart = schedule({ interval: 12, dayOfMonth: 10 });

    expect(getOccurrenceDatesInMonth(noStart, "2026-04")).toEqual([]);
    expect(getOccurrenceDatesInMonth(noStart, "2027-04")).toEqual([]);
  });

  it("returns an empty array when interval > 1 and startDate is missing for weekly", () => {
    const noStart = schedule({
      recurrence: "weekly",
      dayOfMonth: null,
      dayOfWeek: 5,
      interval: 2,
    });

    expect(getOccurrenceDatesInMonth(noStart, "2026-01")).toEqual([]);
  });
});

describe("formatSchedule", () => {
  it("formats monthly schedules", () => {
    expect(formatSchedule({ recurrence: "monthly", interval: 1, dayOfMonth: 10 })).toBe("毎月 10日");
    expect(formatSchedule({ recurrence: "monthly", interval: 3, dayOfMonth: 10 })).toBe("3ヶ月ごと 10日");
  });

  it("formats yearly schedules with the anchor month", () => {
    expect(formatSchedule({ recurrence: "monthly", interval: 12, dayOfMonth: 10, startDate: "2026-04-10" })).toBe(
      "毎年 4月10日",
    );
  });

  it("formats yearly schedules without the anchor month", () => {
    expect(formatSchedule({ recurrence: "monthly", interval: 12, dayOfMonth: 10 })).toBe("毎年 10日");
  });

  it("formats weekly schedules", () => {
    expect(formatSchedule({ recurrence: "weekly", interval: 1, dayOfWeek: 5 })).toBe("毎週 金曜日");
    expect(formatSchedule({ recurrence: "weekly", interval: 2, dayOfWeek: 0 })).toBe("2週ごと 日曜日");
  });

  it("falls back to a placeholder when the day is unknown", () => {
    expect(formatSchedule({ recurrence: "monthly", interval: 1, dayOfMonth: null })).toBe("毎月 ?日");
    expect(formatSchedule({ recurrence: "weekly", interval: 1, dayOfWeek: null })).toBe("毎週 ?曜日");
  });
});
