import { describe, expect, it } from "vitest";
import {
  aggregateBalancePointsByDate,
  buildBalanceChartSegments,
  buildBalanceChartYDomain,
  buildTimeScaleTicks,
  timestampToDateOnly,
} from "./balance-chart";
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
    expect(formatCurrencyWithJpy(123456, "USD", 185184)).toMatch(/\$1,234\.56（[¥￥]185,184）/);
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

describe("buildTimeScaleTicks", () => {
  it("generates weekly ticks for ranges up to three months", () => {
    expect(buildTimeScaleTicks("2026-03-01", "2026-03-22").map(timestampToDateOnly)).toEqual([
      "2026-03-01",
      "2026-03-08",
      "2026-03-15",
      "2026-03-22",
    ]);
  });

  it("generates month-start ticks for ranges over three months", () => {
    expect(buildTimeScaleTicks("2026-03-14", "2026-07-20").map(timestampToDateOnly)).toEqual([
      "2026-04-01",
      "2026-05-01",
      "2026-06-01",
      "2026-07-01",
    ]);
  });
});

describe("aggregateBalancePointsByDate", () => {
  it("keeps the last balance for each day and summarizes same-day descriptions", () => {
    expect(
      aggregateBalancePointsByDate([
        { date: "2026-03-02", balance: 1_000, description: "Coffee" },
        { date: "2026-03-01", balance: 2_000, description: "Salary" },
        { date: "2026-03-02", balance: 700, description: "Lunch" },
      ]),
    ).toEqual([
      {
        date: "2026-03-01",
        timestamp: expect.any(Number),
        balance: 2_000,
        description: "Salary",
        eventCount: 1,
      },
      {
        date: "2026-03-02",
        timestamp: expect.any(Number),
        balance: 700,
        description: "Coffee 他1件",
        eventCount: 2,
      },
    ]);
  });
});

describe("buildBalanceChartSegments", () => {
  it("keeps flat actual and forecast lines visible when there are no events", () => {
    const segments = buildBalanceChartSegments({
      actualPoints: [],
      forecastPoints: [],
      todayPoint: {
        date: "2026-07-04",
        balance: 100_000,
        description: "現在残高",
      },
      displayStartDate: "2026-06-04",
      displayEndDate: "2026-10-04",
      currentBalance: 100_000,
    });

    expect(segments.actualLineSeries.map((point) => point.date)).toEqual(["2026-06-04", "2026-07-04"]);
    expect(segments.actualLineSeries.map((point) => point.balance)).toEqual([100_000, 100_000]);
    expect(segments.forecastLineSeries.map((point) => point.date)).toEqual(["2026-07-04", "2026-10-04"]);
    expect(segments.forecastLineSeries.map((point) => point.balance)).toEqual([100_000, 100_000]);
  });

  it("extends a single actual point to the visible range endpoints", () => {
    const segments = buildBalanceChartSegments({
      actualPoints: [{ date: "2026-03-14", balance: 50_000, description: "Salary" }],
      displayStartDate: "2026-03-01",
      displayEndDate: "2026-03-31",
      currentBalance: 50_000,
    });

    expect(segments.actualLineSeries.map((point) => point.date)).toEqual([
      "2026-03-01",
      "2026-03-14",
      "2026-03-31",
    ]);
    expect(segments.actualLineSeries.map((point) => point.balance)).toEqual([50_000, 50_000, 50_000]);
  });

  it("excludes out-of-window extremes from rendered segments and y-domain", () => {
    const segments = buildBalanceChartSegments({
      actualPoints: [{ date: "2026-01-08", balance: 100_000, description: "Past event" }],
      forecastPoints: [
        { date: "2026-01-20", balance: 150_000, description: "Visible event" },
        { date: "2026-10-01", balance: -1_000_000, description: "Outside event" },
      ],
      todayPoint: {
        date: "2026-01-15",
        balance: 100_000,
        description: "現在残高",
      },
      displayStartDate: "2026-01-01",
      displayEndDate: "2026-02-15",
      currentBalance: 100_000,
    });
    const displayedBalances = [...segments.actualLineSeries, ...segments.forecastLineSeries].map(
      (point) => point.balance,
    );

    expect(displayedBalances).not.toContain(-1_000_000);
    expect(buildBalanceChartYDomain(displayedBalances, 100_000)).toEqual([90_000, 160_000]);
  });
});
