const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type BalanceChartInputPoint = {
  date: string;
  balance: number;
  description?: string;
};

export type DailyBalanceChartPoint = BalanceChartInputPoint & {
  timestamp: number;
  eventCount: number;
};

export type BalanceChartSegments = {
  actualLineSeries: DailyBalanceChartPoint[];
  forecastEventSeries: DailyBalanceChartPoint[];
  forecastLineSeries: DailyBalanceChartPoint[];
  xDomain: [number, number];
};

function parseDateParts(value: string) {
  const [year = "0", month = "1", day = "1"] = value.split("-");

  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
  };
}

function formatDateParts(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function toUtcDate(value: string) {
  const { year, month, day } = parseDateParts(value);

  return new Date(Date.UTC(year, month - 1, day));
}

export function dateOnlyToTimestamp(value: string) {
  const { year, month, day } = parseDateParts(value);

  return Date.UTC(year, month - 1, day) - JST_OFFSET_MS;
}

export function timestampToDateOnly(value: number) {
  return formatDateParts(new Date(value + JST_OFFSET_MS));
}

export function addDaysToDateOnly(value: string, days: number) {
  const date = toUtcDate(value);
  date.setUTCDate(date.getUTCDate() + days);

  return formatDateParts(date);
}

export function addMonthsToDateOnly(value: string, months: number) {
  const date = toUtcDate(value);
  date.setUTCMonth(date.getUTCMonth() + months);

  return formatDateParts(date);
}

export function aggregateBalancePointsByDate(points: BalanceChartInputPoint[]): DailyBalanceChartPoint[] {
  const byDate = new Map<
    string,
    {
      date: string;
      balance: number;
      descriptions: string[];
      eventCount: number;
    }
  >();

  for (const point of points) {
    const existing = byDate.get(point.date);
    const descriptions = existing?.descriptions ?? [];
    if (point.description) {
      descriptions.push(point.description);
    }

    byDate.set(point.date, {
      date: point.date,
      balance: point.balance,
      descriptions,
      eventCount: (existing?.eventCount ?? 0) + 1,
    });
  }

  return Array.from(byDate.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((point) => {
      const firstDescription = point.descriptions[0];

      return {
        date: point.date,
        timestamp: dateOnlyToTimestamp(point.date),
        balance: point.balance,
        description:
          firstDescription && point.eventCount > 1
            ? `${firstDescription} 他${point.eventCount - 1}件`
            : firstDescription,
        eventCount: point.eventCount,
      };
    });
}

function toDailyPoint(point: BalanceChartInputPoint): DailyBalanceChartPoint {
  return {
    ...point,
    timestamp: dateOnlyToTimestamp(point.date),
    eventCount: point.description ? 1 : 0,
  };
}

function sortDailyPoints(points: DailyBalanceChartPoint[]) {
  return [...points].sort((left, right) => left.timestamp - right.timestamp);
}

function createSyntheticPoint(date: string, balance: number): DailyBalanceChartPoint {
  return {
    date,
    timestamp: dateOnlyToTimestamp(date),
    balance,
    eventCount: 0,
  };
}

function upsertDailyPoint(points: DailyBalanceChartPoint[], point: DailyBalanceChartPoint) {
  return sortDailyPoints([...points.filter((item) => item.date !== point.date), point]);
}

function findLastPointBeforeOrAt(points: DailyBalanceChartPoint[], timestamp: number) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index].timestamp <= timestamp) {
      return points[index];
    }
  }

  return undefined;
}

function ensureRangeEndpoints(
  points: DailyBalanceChartPoint[],
  startTimestamp: number,
  endTimestamp: number,
  fallbackBalance: number,
) {
  if (endTimestamp < startTimestamp) {
    return [];
  }

  const startDate = timestampToDateOnly(startTimestamp);
  const endDate = timestampToDateOnly(endTimestamp);
  const sorted = sortDailyPoints(points);

  if (sorted.length === 0) {
    const startPoint = createSyntheticPoint(startDate, fallbackBalance);
    return startDate === endDate ? [startPoint] : [startPoint, createSyntheticPoint(endDate, fallbackBalance)];
  }

  const inRange = sorted.filter((point) => point.timestamp >= startTimestamp && point.timestamp <= endTimestamp);
  const lastBeforeOrAtStart = findLastPointBeforeOrAt(sorted, startTimestamp);
  const firstAfterStart = sorted.find((point) => point.timestamp > startTimestamp);
  const startBalance = lastBeforeOrAtStart?.balance ?? firstAfterStart?.balance ?? fallbackBalance;
  const lastBeforeOrAtEnd = findLastPointBeforeOrAt(sorted, endTimestamp);
  const endBalance = lastBeforeOrAtEnd?.balance ?? startBalance;
  const ranged = [...inRange];

  if (!ranged.some((point) => point.timestamp === startTimestamp)) {
    ranged.unshift(createSyntheticPoint(startDate, startBalance));
  }

  if (!ranged.some((point) => point.timestamp === endTimestamp)) {
    ranged.push(createSyntheticPoint(endDate, endBalance));
  }

  if (ranged.length === 1 && startTimestamp < endTimestamp) {
    const onlyPoint = ranged[0];
    if (onlyPoint.timestamp === startTimestamp) {
      ranged.push(createSyntheticPoint(endDate, onlyPoint.balance));
    } else {
      ranged.unshift(createSyntheticPoint(startDate, onlyPoint.balance));
    }
  }

  return ranged;
}

export function buildBalanceChartYDomain(values: number[], currentBalance: number): [number, number] {
  const targetValues = values.length > 0 ? values : [currentBalance];
  const minBalance = Math.min(...targetValues);
  const maxBalance = Math.max(...targetValues);

  if (minBalance === maxBalance) {
    const padding = Math.max(Math.abs(currentBalance) * 0.08, 10_000);
    return [minBalance - padding, maxBalance + padding];
  }

  const padding = Math.max((maxBalance - minBalance) * 0.12, 10_000);
  return [minBalance - padding, maxBalance + padding];
}

export function buildBalanceChartSegments({
  actualPoints,
  forecastPoints = [],
  todayPoint,
  displayStartDate,
  displayEndDate,
  currentBalance,
}: {
  actualPoints: BalanceChartInputPoint[];
  forecastPoints?: BalanceChartInputPoint[];
  todayPoint?: BalanceChartInputPoint;
  displayStartDate?: string;
  displayEndDate?: string;
  currentBalance: number;
}): BalanceChartSegments {
  const actualSeries = aggregateBalancePointsByDate(actualPoints);
  const forecastEventSeries = aggregateBalancePointsByDate(forecastPoints);
  const boundaryPoint = todayPoint ? toDailyPoint(todayPoint) : null;
  const actualBaseSeries = boundaryPoint ? upsertDailyPoint(actualSeries, boundaryPoint) : actualSeries;
  const forecastBaseSeries = boundaryPoint
    ? sortDailyPoints([boundaryPoint, ...forecastEventSeries])
    : forecastEventSeries;
  const allTimestamps = [...actualBaseSeries, ...forecastBaseSeries].map((point) => point.timestamp);
  const fallbackStart = allTimestamps.length > 0 ? Math.min(...allTimestamps) : dateOnlyToTimestamp(displayStartDate ?? "1970-01-01");
  const fallbackEnd = allTimestamps.length > 0 ? Math.max(...allTimestamps) : fallbackStart;
  const xDomain: [number, number] = [
    displayStartDate
      ? dateOnlyToTimestamp(displayStartDate)
      : fallbackStart === fallbackEnd
        ? fallbackStart - DAY_MS * 7
        : fallbackStart,
    displayEndDate
      ? dateOnlyToTimestamp(displayEndDate)
      : fallbackStart === fallbackEnd
        ? fallbackEnd + DAY_MS * 7
        : fallbackEnd,
  ];
  const actualEndTimestamp = boundaryPoint
    ? Math.min(Math.max(boundaryPoint.timestamp, xDomain[0]), xDomain[1])
    : xDomain[1];
  const forecastStartTimestamp = boundaryPoint
    ? Math.min(Math.max(boundaryPoint.timestamp, xDomain[0]), xDomain[1])
    : xDomain[0];

  return {
    actualLineSeries: ensureRangeEndpoints(actualBaseSeries, xDomain[0], actualEndTimestamp, currentBalance),
    forecastEventSeries,
    forecastLineSeries: ensureRangeEndpoints(
      forecastBaseSeries,
      forecastStartTimestamp,
      xDomain[1],
      boundaryPoint?.balance ?? currentBalance,
    ),
    xDomain,
  };
}

function isMoreThanThreeMonths(startDate: string, endDate: string) {
  return endDate > addMonthsToDateOnly(startDate, 3);
}

function getStartOfNextMonth(value: string) {
  const { year, month } = parseDateParts(value);

  return formatDateParts(new Date(Date.UTC(year, month, 1)));
}

export function buildTimeScaleTicks(startDate: string, endDate: string) {
  if (endDate < startDate) {
    return [];
  }

  const ticks: number[] = [];
  const useMonthTicks = isMoreThanThreeMonths(startDate, endDate);
  let cursor = useMonthTicks ? getStartOfNextMonth(startDate) : startDate;

  while (cursor <= endDate) {
    ticks.push(dateOnlyToTimestamp(cursor));
    cursor = useMonthTicks ? addMonthsToDateOnly(cursor, 1) : addDaysToDateOnly(cursor, 7);
  }

  if (ticks.length === 0) {
    ticks.push(dateOnlyToTimestamp(startDate));
  }

  return ticks;
}

export function getDashboardChartStartDate(today: string) {
  return addMonthsToDateOnly(today, -1);
}

export function getDashboardChartEndDate(today: string, months: number) {
  return addMonthsToDateOnly(today, months);
}

export { DAY_MS };
