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

const NICE_FRACTIONS = [1, 2, 2.5, 5, 10];

function niceStep(roughStep: number) {
  if (roughStep <= 0) {
    return 1;
  }

  const exponent = Math.floor(Math.log10(roughStep));
  const base = 10 ** exponent;

  for (const fraction of NICE_FRACTIONS) {
    const candidate = fraction * base;
    if (candidate >= roughStep - Number.EPSILON) {
      return candidate;
    }
  }

  return 10 * base;
}

/**
 * Y ドメインを 1 / 2 / 2.5 / 5 × 10^n の nice ticks に丸める。
 * ¥1,843,972 のようなきりの悪い目盛りを避けるため、生のパディング済みドメインを
 * step 単位に切り上げ/切り下げる。
 */
export function buildNiceYAxis(
  values: number[],
  currentBalance: number,
  targetTickCount = 5,
): { domain: [number, number]; ticks: number[] } {
  const [rawMin, rawMax] = buildBalanceChartYDomain(values, currentBalance);
  const span = rawMax - rawMin;

  if (!(span > 0)) {
    return { domain: [rawMin, rawMax], ticks: [rawMin, rawMax] };
  }

  const step = niceStep(span / targetTickCount);
  const niceMin = Math.floor(rawMin / step) * step;
  const niceMax = Math.ceil(rawMax / step) * step;
  const ticks: number[] = [];

  for (let value = niceMin; value <= niceMax + step * 0.5; value += step) {
    ticks.push(Math.round(value));
  }

  return { domain: [niceMin, niceMax], ticks };
}

export type MovingAveragePoint = {
  date: string;
  timestamp: number;
  balance: number;
};

export function buildMovingAverageSeries(
  actualLineSeries: DailyBalanceChartPoint[],
  windowDays: number,
): MovingAveragePoint[] {
  if (actualLineSeries.length === 0 || windowDays <= 0) {
    return [];
  }

  const sorted = sortDailyPoints(actualLineSeries);
  const startTimestamp = sorted[0].timestamp;
  const endTimestamp = sorted[sorted.length - 1].timestamp;

  if (endTimestamp < startTimestamp) {
    return [];
  }

  const points: MovingAveragePoint[] = [];
  const balances: number[] = [];

  for (let timestamp = startTimestamp; timestamp <= endTimestamp + Number.EPSILON; timestamp += DAY_MS) {
    const point = findLastPointBeforeOrAt(sorted, timestamp);
    if (!point) {
      continue;
    }

    balances.push(point.balance);

    const windowLength = Math.min(windowDays, balances.length);
    let windowSum = 0;
    for (let index = balances.length - windowLength; index < balances.length; index += 1) {
      windowSum += balances[index];
    }

    points.push({
      date: timestampToDateOnly(timestamp),
      timestamp,
      balance: windowSum / windowLength,
    });
  }

  return points;
}

export type ChartDataPoint = {
  date: string;
  timestamp: number;
  order: number;
  actualBalance?: number;
  actualDescription?: string;
  forecastBalance?: number;
  forecastDescription?: string;
  trendBalance?: number;
};

export function buildDenseChartData({
  actualLineSeries,
  forecastLineSeries,
  trendLineSeries,
  xDomain,
}: {
  actualLineSeries: DailyBalanceChartPoint[];
  forecastLineSeries: DailyBalanceChartPoint[];
  trendLineSeries: MovingAveragePoint[];
  xDomain: [number, number];
}): ChartDataPoint[] {
  const points: ChartDataPoint[] = [];
  const trendByTimestamp = new Map(
    trendLineSeries.map((point) => [point.timestamp, point.balance]),
  );
  const actualByTimestamp = new Map(
    actualLineSeries.map((point) => [point.timestamp, point]),
  );
  const forecastByTimestamp = new Map(
    forecastLineSeries.map((point) => [point.timestamp, point]),
  );

  const actualFirst = actualLineSeries[0]?.timestamp;
  const actualLast = actualLineSeries[actualLineSeries.length - 1]?.timestamp;
  const forecastFirst = forecastLineSeries[0]?.timestamp;
  const forecastLast = forecastLineSeries[forecastLineSeries.length - 1]?.timestamp;

  for (
    let timestamp = xDomain[0];
    timestamp <= xDomain[1] + Number.EPSILON;
    timestamp += DAY_MS
  ) {
    const actualInRange =
      actualFirst !== undefined &&
      actualLast !== undefined &&
      timestamp >= actualFirst &&
      timestamp <= actualLast;
    const forecastInRange =
      forecastFirst !== undefined &&
      forecastLast !== undefined &&
      timestamp >= forecastFirst &&
      timestamp <= forecastLast;

    const actualPoint = actualInRange
      ? findLastPointBeforeOrAt(actualLineSeries, timestamp)
      : undefined;
    const forecastPoint = forecastInRange
      ? findLastPointBeforeOrAt(forecastLineSeries, timestamp)
      : undefined;

    const exactActualPoint = actualByTimestamp.get(timestamp);
    const exactForecastPoint = forecastByTimestamp.get(timestamp);

    points.push({
      date: timestampToDateOnly(timestamp),
      timestamp,
      order: 0,
      actualBalance: actualPoint?.balance,
      actualDescription: exactActualPoint?.description,
      forecastBalance: forecastPoint?.balance,
      forecastDescription: exactForecastPoint?.description,
      trendBalance: trendByTimestamp.get(timestamp),
    });
  }

  return points;
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
  // 予測系列は「今日」境界か実際の予測データがあるときだけ生成する。
  // どちらも無い（取引履歴のような事実のみのチャート）場合は空にして、
  // 現在残高の高さに水平な破線が湧く（合成端点の副作用）のを防ぐ。
  const hasForecastContext = boundaryPoint !== null || forecastEventSeries.length > 0;

  return {
    actualLineSeries: ensureRangeEndpoints(actualBaseSeries, xDomain[0], actualEndTimestamp, currentBalance),
    forecastEventSeries,
    forecastLineSeries: hasForecastContext
      ? ensureRangeEndpoints(
          forecastBaseSeries,
          forecastStartTimestamp,
          xDomain[1],
          boundaryPoint?.balance ?? currentBalance,
        )
      : [],
    xDomain,
  };
}

export function isMoreThanThreeMonths(startDate: string, endDate: string) {
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

/**
 * X 軸ラベル。年の繰り返しをやめ、先頭と年替わりのみ「'26 7月」を出し、以降は「8月」。
 * 月内表示（週次ティック）のときは「7/6」形式。
 */
export function formatChartAxisTick(value: number, ticks: number[], useMonthTicks: boolean) {
  const dateOnly = timestampToDateOnly(value);
  const { year, month, day } = parseDateParts(dateOnly);

  if (!useMonthTicks) {
    return `${month}/${day}`;
  }

  const index = ticks.indexOf(value);
  const previousYear =
    index > 0 ? parseDateParts(timestampToDateOnly(ticks[index - 1])).year : null;

  if (index <= 0 || year !== previousYear) {
    return `'${String(year).slice(-2)} ${month}月`;
  }

  return `${month}月`;
}

type PathContext = {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
};

type Vertex = [number, number];

const DEFAULT_CORNER_RADIUS = 7;

/** データ点を stepAfter（前の値で水平 → 新しい値へ垂直）の頂点列に展開する。 */
function toStepAfterVertices(points: Vertex[]): Vertex[] {
  if (points.length === 0) {
    return [];
  }

  const vertices: Vertex[] = [points[0]];
  for (let index = 1; index < points.length; index += 1) {
    const [x, y] = points[index];
    const previousY = points[index - 1][1];
    vertices.push([x, previousY]);
    vertices.push([x, y]);
  }

  return vertices;
}

/** 折れ線の各頂点を半径 radius で面取りしてパスに書き出す。start が true なら直前のパスに連結する（面の下辺用）。 */
function emitRoundedPolyline(context: PathContext, vertices: Vertex[], radius: number, connect: boolean) {
  if (vertices.length === 0) {
    return;
  }

  if (connect) {
    context.lineTo(vertices[0][0], vertices[0][1]);
  } else {
    context.moveTo(vertices[0][0], vertices[0][1]);
  }
  if (vertices.length <= 2) {
    for (let index = 1; index < vertices.length; index += 1) {
      context.lineTo(vertices[index][0], vertices[index][1]);
    }
    return;
  }

  for (let index = 1; index < vertices.length - 1; index += 1) {
    const [px, py] = vertices[index - 1];
    const [cx, cy] = vertices[index];
    const [nx, ny] = vertices[index + 1];
    const d1 = Math.hypot(cx - px, cy - py);
    const d2 = Math.hypot(nx - cx, ny - cy);
    if (d1 === 0 || d2 === 0) {
      context.lineTo(cx, cy);
      continue;
    }

    const r = Math.min(radius, d1 / 2, d2 / 2);
    context.lineTo(cx + ((px - cx) / d1) * r, cy + ((py - cy) / d1) * r);
    context.quadraticCurveTo(cx, cy, cx + ((nx - cx) / d2) * r, cy + ((ny - cy) / d2) * r);
  }

  const last = vertices[vertices.length - 1];
  context.lineTo(last[0], last[1]);
}

/**
 * 角を丸めた stepAfter 曲線ファクトリ（Recharts / d3-shape の CurveFactory 互換）。
 * 残高が階段関数である意味論（#283・C-6）は保ちつつ、90 度の角を面取りして
 * 「ガッタガタ」した見た目をやわらげる。line と area の両方（面の上辺・下辺）に対応する。
 */
export function roundedStepAfter(radius = DEFAULT_CORNER_RADIUS) {
  return function curveRoundedStepAfter(context: PathContext) {
    let buffer: Vertex[] = [];
    // d3 の area は上辺→下辺の 2 本を続けて描くため、下辺は moveTo ではなく lineTo で連結する必要がある。
    // lineFlag: NaN=単純な線 / 0=面の上辺（moveTo）/ 1=面の下辺（lineTo で連結）。
    let lineFlag = Number.NaN;

    return {
      areaStart() {
        lineFlag = 0;
      },
      areaEnd() {
        lineFlag = Number.NaN;
      },
      lineStart() {
        buffer = [];
      },
      lineEnd() {
        emitRoundedPolyline(context, toStepAfterVertices(buffer), radius, lineFlag === 1);
        if (lineFlag === 0 || lineFlag === 1) {
          lineFlag = 1 - lineFlag;
        }
      },
      point(x: number, y: number) {
        buffer.push([Number(x), Number(y)]);
      },
    };
  };
}

export function getDashboardChartStartDate(today: string) {
  return addMonthsToDateOnly(today, -1);
}

export function getDashboardChartEndDate(today: string, months: number) {
  return addMonthsToDateOnly(today, months);
}

export { DAY_MS };
