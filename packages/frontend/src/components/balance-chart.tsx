import {
  CartesianGrid,
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
import { usePrefersReducedMotion } from "../hooks/use-prefers-reduced-motion";
import { convertCurrencyInputToJpy, formatCurrency, formatDate, formatManUnit } from "../lib/format";
import {
  buildBalanceChartSegments,
  buildNiceYAxis,
  buildTimeScaleTicks,
  dateOnlyToTimestamp,
  formatChartAxisTick,
  isMoreThanThreeMonths,
  timestampToDateOnly,
  type BalanceChartInputPoint,
  type DailyBalanceChartPoint,
} from "../lib/balance-chart";
import { cn } from "../lib/utils";

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

const CHART_MARGIN = { left: 12, right: 12, top: 12, bottom: 8 };
const Y_AXIS_WIDTH = 56;
const X_AXIS_HEIGHT = 28;
const INITIAL_ANIMATION_MS = 400;

function useElementSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    let frame = 0;

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

    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateSize);
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", scheduleUpdate);
      return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener("resize", scheduleUpdate);
      };
    }

    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return [ref, size] as const;
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
  exchangeRateToJpy,
  showSeriesLabel,
}: TooltipContentProps & {
  currencyCode: SupportedCurrencyCode;
  exchangeRateToJpy: number;
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

  const isForecast = selectedEntry.dataKey === "forecastBalance";
  const seriesLabel = isForecast ? "予測" : "実績";
  const description = isForecast ? point.forecastDescription : point.actualDescription;
  const jpyValue =
    currencyCode === "JPY" ? null : convertCurrencyInputToJpy(selectedEntry.value, currencyCode, exchangeRateToJpy);

  return (
    <div className="max-w-64 rounded-2xl border border-line bg-[rgba(18,22,30,0.96)] px-3 py-2 shadow-xl">
      {showSeriesLabel ? (
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-3">
          <span
            className={cn(
              "inline-block h-0 w-3 border-t-2",
              isForecast ? "border-dashed border-chart-forecast" : "border-solid border-chart-actual",
            )}
          />
          {seriesLabel}
        </div>
      ) : null}
      <div className="font-data text-xs text-ink-2">{formatDate(point.date)}</div>
      <div className="font-data mt-0.5 text-base font-semibold text-ink">
        {formatCurrency(selectedEntry.value, currencyCode)}
      </div>
      {jpyValue !== null ? (
        <div className="font-data mt-0.5 text-xs text-ink-2">{formatCurrency(jpyValue, "JPY")}</div>
      ) : null}
      {description ? <div className="mt-1 max-w-56 break-words text-xs text-ink-2">{description}</div> : null}
    </div>
  );
}

function ChartLegend() {
  return (
    <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-3 rounded-full border border-line bg-[rgba(17,21,28,0.72)] px-2.5 py-1 text-[11px] text-ink-2">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-0 w-3 border-t-2 border-solid border-chart-actual" />
        実績
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-0 w-3 border-t-2 border-dashed border-chart-forecast" />
        予測
      </span>
    </div>
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
  exchangeRateToJpy = 1,
  disposableZero = false,
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
  exchangeRateToJpy?: number;
  disposableZero?: boolean;
}) {
  const [chartRef, chartSize] = useElementSize();
  const prefersReducedMotion = usePrefersReducedMotion();
  // 初回マウントの直後に true へ切り替える。以降の再レンダー（期間・口座・オフセットの
  // 切替でデータが変わる場合）は shouldAnimate が false になり、再アニメーションを起こさない。
  const [hasAnimatedOnce, setHasAnimatedOnce] = useState(false);

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

  useEffect(() => {
    const frame = requestAnimationFrame(() => setHasAnimatedOnce(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (actualLineSeries.length === 0 && forecastLineSeries.length === 0) {
    return (
      <div ref={chartRef} className="flex h-full min-h-0 min-w-0 items-center justify-center text-ink-2">
        表示できる {label} の推移がありません。
      </div>
    );
  }

  const visibleBalances = [...actualLineSeries, ...forecastLineSeries]
    .filter((point) => isInDomain(point, xDomain))
    .map((point) => point.balance);
  const { domain: chartDomain, ticks: yTicks } = buildNiceYAxis(visibleBalances, currentBalance);
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
  const forecastEventTimestamps = new Set(forecastEventSeries.map((point) => point.timestamp));
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
  const useMonthTicks = isMoreThanThreeMonths(
    timestampToDateOnly(xDomain[0]),
    timestampToDateOnly(xDomain[1]),
  );
  const xTicks = buildTimeScaleTicks(timestampToDateOnly(xDomain[0]), timestampToDateOnly(xDomain[1]));
  const zeroLineLabel = disposableZero ? "¥0（可処分ゼロ）" : "¥0";

  const plotLeft = CHART_MARGIN.left + Y_AXIS_WIDTH;
  const plotRight = chartSize.width - CHART_MARGIN.right;
  const plotTop = CHART_MARGIN.top;
  const plotBottom = chartSize.height - CHART_MARGIN.bottom - X_AXIS_HEIGHT;
  const plotWidth = Math.max(plotRight - plotLeft, 0);
  const plotHeight = Math.max(plotBottom - plotTop, 0);

  const scaleX = (timestamp: number) => {
    if (xDomain[1] === xDomain[0]) {
      return plotLeft;
    }

    return plotLeft + ((timestamp - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotWidth;
  };

  const scaleY = (value: number) => {
    if (chartDomain[1] === chartDomain[0]) {
      return plotTop + plotHeight / 2;
    }

    return plotTop + (1 - (value - chartDomain[0]) / (chartDomain[1] - chartDomain[0])) * plotHeight;
  };

  // 描線アニメーションは初回マウントの 400ms のみ（C-2）。以降のデータ更新（期間・口座・
  // オフセットの切替）では isAnimationActive を false にし、再アニメーションを起こさない。
  const shouldAnimate = !prefersReducedMotion && !hasAnimatedOnce;

  return (
    <div ref={chartRef} className="relative h-full min-h-0 min-w-0">
      {chartSize.width > 0 && chartSize.height > 0 ? (
        <>
          <LineChart
            data={chartData}
            height={chartSize.height}
            margin={CHART_MARGIN}
            width={chartSize.width}
          >
            <CartesianGrid horizontal vertical={false} stroke="var(--line)" strokeOpacity={0.4} />
            {showNegativeArea ? (
              <ReferenceArea
                x1={xDomain[0]}
                x2={xDomain[1]}
                y1={chartDomain[0]}
                y2={0}
                fill="var(--critical)"
                fillOpacity={0.1}
                strokeOpacity={0}
              />
            ) : null}
            {showZeroLine ? (
              <ReferenceLine
                y={0}
                stroke="var(--line-strong)"
                strokeDasharray="4 4"
                label={
                  showNegativeArea
                    ? {
                        value: zeroLineLabel,
                        position: "insideBottomLeft",
                        fill: "var(--critical)",
                        fontSize: 11,
                      }
                    : undefined
                }
              />
            ) : null}
            {showTodayLine ? (
              <ReferenceLine x={todayTimestamp} stroke="var(--line-strong)" strokeDasharray="3 5" />
            ) : null}
            {minimumForecastPoint ? (
              <ReferenceDot
                x={minimumForecastPoint.timestamp}
                y={minimumForecastPoint.balance}
                r={3}
                fill={minimumForecastPoint.balance < 0 ? "var(--critical)" : "var(--chart-forecast)"}
                stroke="var(--ink)"
                strokeWidth={1}
              />
            ) : null}
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={xDomain}
              ticks={xTicks}
              stroke="var(--line-strong)"
              height={X_AXIS_HEIGHT}
              tick={{ fontSize: 11, fill: "var(--ink-3)", fontFamily: "var(--font-data)" }}
              tickLine={false}
              tickMargin={6}
              minTickGap={24}
              interval="preserveStartEnd"
              tickFormatter={(value: number) => formatChartAxisTick(value, xTicks, useMonthTicks)}
              allowDataOverflow
            />
            <YAxis
              stroke="var(--line-strong)"
              tickFormatter={(value: number) => formatManUnit(value)}
              width={Y_AXIS_WIDTH}
              domain={chartDomain}
              ticks={yTicks}
              tick={{ fontSize: 11, fill: "var(--ink-3)", fontFamily: "var(--font-data)" }}
              tickLine={false}
              allowDataOverflow
            />
            <Tooltip
              content={(props) => (
                <BalanceTooltip
                  {...props}
                  currencyCode={currencyCode}
                  exchangeRateToJpy={exchangeRateToJpy}
                  showSeriesLabel={forecastData !== undefined}
                />
              )}
              cursor={{ stroke: "var(--line-strong)", strokeDasharray: "4 4" }}
            />
            {actualLineSeries.length > 0 ? (
              <Line
                type="stepAfter"
                dataKey="actualBalance"
                stroke="var(--chart-actual)"
                strokeWidth={2}
                strokeOpacity={0.55}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive={shouldAnimate}
                animationDuration={INITIAL_ANIMATION_MS}
                connectNulls
              />
            ) : null}
            {forecastLineSeries.length > 0 ? (
              <Line
                type="stepAfter"
                dataKey="forecastBalance"
                stroke="var(--chart-forecast)"
                strokeDasharray="7 6"
                strokeWidth={2}
                dot={(dotProps: { cx?: number; cy?: number; payload?: BalanceChartDatum; index?: number }) => {
                  const { cx, cy, payload, index } = dotProps;
                  if (
                    cx === undefined ||
                    cy === undefined ||
                    !payload ||
                    !forecastEventTimestamps.has(payload.timestamp)
                  ) {
                    return <g key={`forecast-dot-${index}`} />;
                  }

                  return (
                    <g key={`forecast-dot-${index}`}>
                      <circle cx={cx} cy={cy} r={8} fill="transparent" />
                      <circle cx={cx} cy={cy} r={3} fill="var(--chart-forecast)" />
                    </g>
                  );
                }}
                activeDot={{ r: 4 }}
                isAnimationActive={shouldAnimate}
                animationDuration={INITIAL_ANIMATION_MS}
                connectNulls
              />
            ) : null}
          </LineChart>
          <ChartLegend />
          {showTodayLine ? (
            <div
              className="pointer-events-none absolute -translate-x-1/2 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2"
              style={{ left: scaleX(todayTimestamp), top: plotTop }}
            >
              今日
            </div>
          ) : null}
          {minimumForecastPoint ? (
            <div
              className={cn(
                "pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-full px-2 py-0.5 text-[11px] font-medium",
                minimumForecastPoint.balance < 0 ? "bg-critical/20 text-critical" : "bg-surface-2 text-ink-2",
              )}
              style={{
                left: scaleX(minimumForecastPoint.timestamp),
                top: scaleY(minimumForecastPoint.balance) - 6,
              }}
            >
              最小
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
