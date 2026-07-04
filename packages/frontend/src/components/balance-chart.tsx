import {
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useRef, useState } from "react";
import type { SupportedCurrencyCode } from "@sui/shared";
import { formatChartDateWithYear, formatCurrency, formatDateWithYear } from "../lib/format";
import {
  buildBalanceChartSegments,
  buildBalanceChartYDomain,
  buildTimeScaleTicks,
  dateOnlyToTimestamp,
  timestampToDateOnly,
  type BalanceChartInputPoint,
  type DailyBalanceChartPoint,
} from "../lib/balance-chart";

type BalanceChartPoint = BalanceChartInputPoint;

type BalanceChartDatum = {
  date: string;
  timestamp: number;
  order: number;
  actualBalance?: number;
  forecastBalance?: number;
  actualDescription?: string;
  forecastDescription?: string;
};

function useElementSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      const nextSize = {
        width: element.clientWidth,
        height: element.clientHeight,
      };
      setSize((current) =>
        current.width === nextSize.width && current.height === nextSize.height
          ? current
          : nextSize,
      );
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}

function formatTimestampTick(value: number) {
  return formatChartDateWithYear(timestampToDateOnly(value));
}

function getTooltipEntry(
  payload: TooltipContentProps["payload"],
  dataKey: "actualBalance" | "forecastBalance",
) {
  return payload.find((entry) => entry.dataKey === dataKey && entry.value !== null && entry.value !== undefined);
}

function BalanceTooltip({
  active,
  payload,
  currencyCode,
  showSeriesLabel,
}: TooltipContentProps & {
  currencyCode: SupportedCurrencyCode;
  showSeriesLabel: boolean;
}) {
  if (!active || payload.length === 0) {
    return null;
  }

  const actualEntry = getTooltipEntry(payload, "actualBalance");
  const forecastEntry = getTooltipEntry(payload, "forecastBalance");
  const selectedEntry = forecastEntry ?? actualEntry;
  if (!selectedEntry || typeof selectedEntry.value !== "number") {
    return null;
  }

  const point = selectedEntry.payload as Partial<BalanceChartDatum> | undefined;
  if (!point?.date) {
    return null;
  }

  const seriesLabel = actualEntry && forecastEntry ? "実績 / 予測" : forecastEntry ? "予測" : "実績";
  const description =
    selectedEntry.dataKey === "forecastBalance" ? point.forecastDescription : point.actualDescription;

  return (
    <div className="max-w-64 rounded-2xl border border-white/10 bg-[rgba(18,22,30,0.96)] px-3 py-2 text-sm shadow-xl">
      {showSeriesLabel ? <div className="mb-1 text-xs font-medium text-white/55">{seriesLabel}</div> : null}
      <div className="text-white/75">{formatDateWithYear(point.date)}</div>
      <div className="mt-1 font-semibold text-white">{formatCurrency(selectedEntry.value, currencyCode)}</div>
      {description ? <div className="mt-1 break-words text-xs text-white/60">{description}</div> : null}
    </div>
  );
}

function isInDomain(point: DailyBalanceChartPoint, domain: [number, number]) {
  return point.timestamp >= domain[0] && point.timestamp <= domain[1];
}

function getMinimumForecastPoint(points: DailyBalanceChartPoint[], domain: [number, number]) {
  return points
    .filter((point) => isInDomain(point, domain))
    .reduce<DailyBalanceChartPoint | null>(
      (minimum, point) => (!minimum || point.balance < minimum.balance ? point : minimum),
      null,
    );
}

export function BalanceChart({
  data,
  forecastData,
  todayPoint,
  todayDate,
  displayStartDate,
  displayEndDate,
  currentBalance,
  label,
  currencyCode = "JPY",
}: {
  data: BalanceChartPoint[];
  forecastData?: BalanceChartPoint[];
  todayPoint?: BalanceChartPoint;
  todayDate?: string;
  displayStartDate?: string;
  displayEndDate?: string;
  currentBalance: number;
  label: string;
  currencyCode?: SupportedCurrencyCode;
}) {
  const [chartRef, chartSize] = useElementSize();
  const {
    actualLineSeries,
    forecastEventSeries,
    forecastLineSeries,
    xDomain,
  } = buildBalanceChartSegments({
    actualPoints: data,
    forecastPoints: forecastData,
    todayPoint,
    displayStartDate,
    displayEndDate,
    currentBalance,
  });

  if (actualLineSeries.length === 0 && forecastLineSeries.length === 0) {
    return (
      <div ref={chartRef} className="flex h-full min-h-0 min-w-0 items-center justify-center text-white/60">
        表示できる {label} の推移がありません。
      </div>
    );
  }

  const visibleBalances = [...actualLineSeries, ...forecastLineSeries]
    .filter((point) => isInDomain(point, xDomain))
    .map((point) => point.balance);
  const chartDomain = buildBalanceChartYDomain(visibleBalances, currentBalance);
  const visibleMinBalance = Math.min(...(visibleBalances.length > 0 ? visibleBalances : [currentBalance]));
  const showZeroLine = chartDomain[0] <= 0 && chartDomain[1] >= 0;
  const showNegativeArea = visibleMinBalance < 0 && showZeroLine;
  const todayTimestamp = todayDate
    ? dateOnlyToTimestamp(todayDate)
    : todayPoint
      ? dateOnlyToTimestamp(todayPoint.date)
      : undefined;
  const showTodayLine =
    todayTimestamp !== undefined && todayTimestamp >= xDomain[0] && todayTimestamp <= xDomain[1];
  const minimumForecastPoint = getMinimumForecastPoint(forecastEventSeries, xDomain);
  const minimumForecastLabelPosition =
    minimumForecastPoint && minimumForecastPoint.timestamp > xDomain[0] + (xDomain[1] - xDomain[0]) * 0.85
      ? "left"
      : "right";
  const chartData: BalanceChartDatum[] = [
    ...actualLineSeries.map((point) => ({
      date: point.date,
      timestamp: point.timestamp,
      order: 0,
      actualBalance: point.balance,
      actualDescription: point.description,
    })),
    ...forecastLineSeries.map((point, index) => ({
      date: point.date,
      timestamp: point.timestamp,
      order: index === 0 && todayPoint ? 1 : 2,
      forecastBalance: point.balance,
      forecastDescription: point.description,
    })),
  ].sort((left, right) => left.timestamp - right.timestamp || left.order - right.order);
  const xTicks = buildTimeScaleTicks(timestampToDateOnly(xDomain[0]), timestampToDateOnly(xDomain[1]));
  const primaryColor = "hsl(var(--primary))";

  return (
    <div ref={chartRef} className="h-full min-h-0 min-w-0">
      {chartSize.width > 0 && chartSize.height > 0 ? (
        <LineChart
          data={chartData}
          height={chartSize.height}
          margin={{ left: 12, right: 12, top: 12, bottom: 8 }}
          width={chartSize.width}
        >
          {showNegativeArea ? (
            <ReferenceArea
              x1={xDomain[0]}
              x2={xDomain[1]}
              y1={chartDomain[0]}
              y2={0}
              fill="rgba(244, 63, 94, 0.08)"
              strokeOpacity={0}
            />
          ) : null}
          {showZeroLine ? <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" /> : null}
          {showTodayLine ? (
            <ReferenceLine
              x={todayTimestamp}
              stroke="rgba(255,255,255,0.32)"
              strokeDasharray="3 5"
              label={{ value: "今日", position: "insideTop", fill: "rgba(255,255,255,0.68)", fontSize: 12 }}
            />
          ) : null}
          {minimumForecastPoint ? (
            <ReferenceDot
              x={minimumForecastPoint.timestamp}
              y={minimumForecastPoint.balance}
              r={4}
              fill={primaryColor}
              stroke="rgba(255,255,255,0.75)"
              strokeWidth={1.5}
              label={{
                value: `表示期間の最小 ${formatCurrency(minimumForecastPoint.balance, currencyCode)} / ${formatDateWithYear(minimumForecastPoint.date)}`,
                position: minimumForecastLabelPosition,
                fill: "rgba(255,255,255,0.72)",
                fontSize: 12,
              }}
            />
          ) : null}
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={xDomain}
            ticks={xTicks}
            stroke="rgba(255,255,255,0.28)"
            height={28}
            tick={{ fontSize: 10, fill: "rgba(255,255,255,0.58)" }}
            tickLine={false}
            tickMargin={6}
            minTickGap={24}
            interval="preserveStartEnd"
            tickFormatter={formatTimestampTick}
            allowDataOverflow
          />
          <YAxis
            stroke="rgba(255,255,255,0.4)"
            tickFormatter={(value) => formatCurrency(value, currencyCode)}
            width={110}
            domain={chartDomain}
            tickCount={6}
            tick={{ fontSize: 11, fill: "rgba(255,255,255,0.58)" }}
            tickLine={false}
            allowDataOverflow
          />
          <Tooltip
            content={(props) => (
              <BalanceTooltip {...props} currencyCode={currencyCode} showSeriesLabel={forecastData !== undefined} />
            )}
            cursor={{ stroke: "rgba(255,255,255,0.18)", strokeDasharray: "4 4" }}
          />
          {actualLineSeries.length > 0 ? (
            <Line
              type="stepAfter"
              dataKey="actualBalance"
              stroke={primaryColor}
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
            />
          ) : null}
          {forecastLineSeries.length > 0 ? (
            <Line
              type="stepAfter"
              dataKey="forecastBalance"
              stroke={primaryColor}
              strokeDasharray="7 6"
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
            />
          ) : null}
        </LineChart>
      ) : null}
    </div>
  );
}
