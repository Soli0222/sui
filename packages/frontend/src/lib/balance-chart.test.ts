import { describe, expect, it } from "vitest";
import {
  buildBalanceChartSegments,
  buildDenseChartData,
  buildMovingAverageSeries,
  dateOnlyToTimestamp,
  timestampToDateOnly,
} from "./balance-chart";

describe("buildMovingAverageSeries", () => {
  it("returns an empty array for empty input", () => {
    expect(buildMovingAverageSeries([], 7)).toEqual([]);
  });

  it("returns an empty array when windowDays is not positive", () => {
    const points = [
      { date: "2026-07-01", timestamp: dateOnlyToTimestamp("2026-07-01"), balance: 100_000, eventCount: 1 },
    ];

    expect(buildMovingAverageSeries(points, 0)).toEqual([]);
    expect(buildMovingAverageSeries(points, -1)).toEqual([]);
  });

  it("returns a single point for a single-day actual line", () => {
    const points = [
      { date: "2026-07-01", timestamp: dateOnlyToTimestamp("2026-07-01"), balance: 100_000, eventCount: 1 },
    ];

    const result = buildMovingAverageSeries(points, 7);

    expect(result).toEqual([
      { date: "2026-07-01", timestamp: dateOnlyToTimestamp("2026-07-01"), balance: 100_000 },
    ]);
  });

  it("uses a 7-day backward window and averages only past closing values", () => {
    const segments = buildBalanceChartSegments({
      actualPoints: Array.from({ length: 10 }, (_, index) => ({
        date: `2026-07-${String(index + 1).padStart(2, "0")}`,
        balance: (index + 1) * 1_000,
      })),
      displayStartDate: "2026-07-01",
      displayEndDate: "2026-07-10",
      currentBalance: 10_000,
    });

    const result = buildMovingAverageSeries(segments.actualLineSeries, 7);

    expect(result.length).toBe(10);
    expect(result[0]).toEqual({
      date: "2026-07-01",
      timestamp: dateOnlyToTimestamp("2026-07-01"),
      balance: 1_000,
    });
    expect(result[1]).toEqual({
      date: "2026-07-02",
      timestamp: dateOnlyToTimestamp("2026-07-02"),
      balance: 1_500,
    });
    expect(result[6]).toEqual({
      date: "2026-07-07",
      timestamp: dateOnlyToTimestamp("2026-07-07"),
      balance: 4_000,
    });
    expect(result[7]).toEqual({
      date: "2026-07-08",
      timestamp: dateOnlyToTimestamp("2026-07-08"),
      balance: 5_000,
    });
    expect(result[9]).toEqual({
      date: "2026-07-10",
      timestamp: dateOnlyToTimestamp("2026-07-10"),
      balance: 7_000,
    });
  });

  it("uses a 30-day backward window when requested", () => {
    const segments = buildBalanceChartSegments({
      actualPoints: Array.from({ length: 10 }, (_, index) => ({
        date: `2026-07-${String(index + 1).padStart(2, "0")}`,
        balance: (index + 1) * 1_000,
      })),
      displayStartDate: "2026-07-01",
      displayEndDate: "2026-07-10",
      currentBalance: 10_000,
    });

    const result = buildMovingAverageSeries(segments.actualLineSeries, 30);

    expect(result[9].balance).toBe(5_500);
  });

  it("uses the available days for the head period when the window is not yet filled", () => {
    const segments = buildBalanceChartSegments({
      actualPoints: [
        { date: "2026-07-01", balance: 1_000 },
        { date: "2026-07-02", balance: 2_000 },
        { date: "2026-07-03", balance: 3_000 },
      ],
      displayStartDate: "2026-07-01",
      displayEndDate: "2026-07-03",
      currentBalance: 3_000,
    });

    const result = buildMovingAverageSeries(segments.actualLineSeries, 7);

    expect(result.map((point) => point.balance)).toEqual([1_000, 1_500, 2_000]);
  });

  it("does not include future closing values in the average", () => {
    const segments = buildBalanceChartSegments({
      actualPoints: [
        { date: "2026-07-01", balance: 100_000 },
        { date: "2026-07-02", balance: 100_000 },
        { date: "2026-07-03", balance: 100_000 },
        { date: "2026-07-04", balance: 100_000 },
        { date: "2026-07-05", balance: 100_000 },
        { date: "2026-07-06", balance: 200_000 },
        { date: "2026-07-07", balance: 200_000 },
        { date: "2026-07-08", balance: 200_000 },
        { date: "2026-07-09", balance: 200_000 },
        { date: "2026-07-10", balance: 200_000 },
      ],
      displayStartDate: "2026-07-01",
      displayEndDate: "2026-07-10",
      currentBalance: 200_000,
    });

    const result = buildMovingAverageSeries(segments.actualLineSeries, 7);

    // Day 5 (index 4) should only average the first 5 days of 100,000
    expect(result[4].balance).toBe(100_000);
    // Day 6 (index 5) should be (5 * 100_000 + 200_000) / 6
    expect(result[5].balance).toBe((5 * 100_000 + 200_000) / 6);
  });

  it("preserves the step-after closing value on days without an explicit transaction", () => {
    const segments = buildBalanceChartSegments({
      actualPoints: [
        { date: "2026-07-01", balance: 10_000 },
        { date: "2026-07-05", balance: 50_000 },
      ],
      displayStartDate: "2026-07-01",
      displayEndDate: "2026-07-05",
      currentBalance: 50_000,
    });

    const result = buildMovingAverageSeries(segments.actualLineSeries, 7);

    expect(result.map((point) => point.balance)).toEqual([10_000, 10_000, 10_000, 10_000, 18_000]);
  });

  it("uses the step-after closing value from the extended range endpoints", () => {
    const segments = buildBalanceChartSegments({
      actualPoints: [{ date: "2026-07-03", balance: 30_000 }],
      displayStartDate: "2026-07-01",
      displayEndDate: "2026-07-05",
      currentBalance: 30_000,
    });

    const result = buildMovingAverageSeries(segments.actualLineSeries, 7);

    expect(result.length).toBe(5);
    expect(result.map((point) => point.balance)).toEqual([30_000, 30_000, 30_000, 30_000, 30_000]);
    expect(result.map((point) => timestampToDateOnly(point.timestamp))).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ]);
  });
});

describe("buildDenseChartData", () => {
  it("returns one dense row per day in the xDomain", () => {
    const segments = buildBalanceChartSegments({
      actualPoints: [
        { date: "2026-07-01", balance: 10_000 },
        { date: "2026-07-03", balance: 30_000 },
      ],
      displayStartDate: "2026-07-01",
      displayEndDate: "2026-07-05",
      currentBalance: 30_000,
    });

    const chartData = buildDenseChartData({
      actualLineSeries: segments.actualLineSeries,
      forecastLineSeries: segments.forecastLineSeries,
      trendLineSeries: [],
      xDomain: segments.xDomain,
    });

    expect(chartData.map((point) => point.date)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ]);
  });

  it("uses step-after actual values only within the actual line range and is undefined after the actual last point", () => {
    const segments = buildBalanceChartSegments({
      actualPoints: [
        { date: "2026-07-01", balance: 10_000 },
        { date: "2026-07-05", balance: 50_000 },
      ],
      forecastPoints: [
        { date: "2026-07-06", balance: 60_000 },
        { date: "2026-07-08", balance: 80_000 },
      ],
      todayPoint: { date: "2026-07-04", balance: 40_000 },
      displayStartDate: "2026-07-01",
      displayEndDate: "2026-07-08",
      currentBalance: 40_000,
    });

    const chartData = buildDenseChartData({
      actualLineSeries: segments.actualLineSeries,
      forecastLineSeries: segments.forecastLineSeries,
      trendLineSeries: [],
      xDomain: segments.xDomain,
    });

    expect(chartData.map((point) => point.actualBalance)).toEqual([
      10_000, 10_000, 10_000, 40_000, undefined, undefined, undefined, undefined,
    ]);
  });

  it("is undefined for forecast before the forecast start and defined from the forecast start", () => {
    const segments = buildBalanceChartSegments({
      actualPoints: [
        { date: "2026-07-01", balance: 10_000 },
        { date: "2026-07-05", balance: 50_000 },
      ],
      forecastPoints: [
        { date: "2026-07-06", balance: 60_000 },
        { date: "2026-07-08", balance: 80_000 },
      ],
      todayPoint: { date: "2026-07-04", balance: 40_000 },
      displayStartDate: "2026-07-01",
      displayEndDate: "2026-07-08",
      currentBalance: 40_000,
    });

    const chartData = buildDenseChartData({
      actualLineSeries: segments.actualLineSeries,
      forecastLineSeries: segments.forecastLineSeries,
      trendLineSeries: [],
      xDomain: segments.xDomain,
    });

    expect(chartData.map((point) => point.forecastBalance)).toEqual([
      undefined, undefined, undefined, 40_000, 40_000, 60_000, 60_000, 80_000,
    ]);
  });

  it("maps the trend balance for days inside the actual range and omits it outside", () => {
    const segments = buildBalanceChartSegments({
      actualPoints: [
        { date: "2026-07-01", balance: 10_000 },
        { date: "2026-07-02", balance: 20_000 },
        { date: "2026-07-03", balance: 30_000 },
      ],
      forecastPoints: [
        { date: "2026-07-05", balance: 50_000 },
      ],
      todayPoint: { date: "2026-07-03", balance: 30_000 },
      displayStartDate: "2026-07-01",
      displayEndDate: "2026-07-06",
      currentBalance: 30_000,
    });
    const trendLineSeries = buildMovingAverageSeries(segments.actualLineSeries, 2);

    const chartData = buildDenseChartData({
      actualLineSeries: segments.actualLineSeries,
      forecastLineSeries: segments.forecastLineSeries,
      trendLineSeries,
      xDomain: segments.xDomain,
    });

    expect(chartData.map((point) => point.trendBalance)).toEqual([
      10_000, 15_000, 25_000, undefined, undefined, undefined,
    ]);
  });

  it("contains both actual and forecast balances at the same-day boundary", () => {
    const segments = buildBalanceChartSegments({
      actualPoints: [
        { date: "2026-07-01", balance: 10_000 },
        { date: "2026-07-04", balance: 40_000 },
      ],
      forecastPoints: [
        { date: "2026-07-06", balance: 60_000 },
        { date: "2026-07-08", balance: 80_000 },
      ],
      todayPoint: { date: "2026-07-04", balance: 40_000 },
      displayStartDate: "2026-07-01",
      displayEndDate: "2026-07-08",
      currentBalance: 40_000,
    });

    const chartData = buildDenseChartData({
      actualLineSeries: segments.actualLineSeries,
      forecastLineSeries: segments.forecastLineSeries,
      trendLineSeries: [],
      xDomain: segments.xDomain,
    });

    const boundary = chartData.find((point) => point.date === "2026-07-04");
    expect(boundary).toEqual({
      date: "2026-07-04",
      timestamp: dateOnlyToTimestamp("2026-07-04"),
      order: 0,
      actualBalance: 40_000,
      actualDescription: undefined,
      forecastBalance: 40_000,
      forecastDescription: undefined,
      trendBalance: undefined,
    });
  });

  it("preserves actual and forecast descriptions only on exact days", () => {
    const segments = buildBalanceChartSegments({
      actualPoints: [
        { date: "2026-07-01", balance: 10_000, description: "Salary" },
        { date: "2026-07-04", balance: 40_000, description: "Today" },
      ],
      forecastPoints: [
        { date: "2026-07-06", balance: 60_000, description: "Rent" },
      ],
      todayPoint: { date: "2026-07-04", balance: 40_000, description: "Today" },
      displayStartDate: "2026-07-01",
      displayEndDate: "2026-07-06",
      currentBalance: 40_000,
    });

    const chartData = buildDenseChartData({
      actualLineSeries: segments.actualLineSeries,
      forecastLineSeries: segments.forecastLineSeries,
      trendLineSeries: [],
      xDomain: segments.xDomain,
    });

    const actualDay = chartData.find((point) => point.date === "2026-07-01");
    const forecastDay = chartData.find((point) => point.date === "2026-07-06");
    const interpolatedDay = chartData.find((point) => point.date === "2026-07-02");
    const boundaryDay = chartData.find((point) => point.date === "2026-07-04");

    expect(actualDay?.actualDescription).toBe("Salary");
    expect(forecastDay?.forecastDescription).toBe("Rent");
    expect(interpolatedDay?.actualDescription).toBeUndefined();
    expect(interpolatedDay?.forecastDescription).toBeUndefined();
    expect(boundaryDay?.actualDescription).toBe("Today");
    expect(boundaryDay?.forecastDescription).toBe("Today");
  });
});
