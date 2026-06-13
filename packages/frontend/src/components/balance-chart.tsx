import {
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useEffect, useRef, useState } from "react";
import type { SupportedCurrencyCode } from "@sui/shared";
import { formatChartDateWithYear, formatCurrency, formatDateWithYear } from "../lib/format";

type BalanceChartPoint = {
  date: string;
  balance: number;
  description?: string;
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

export function BalanceChart({
  data,
  currentBalance,
  label,
  currencyCode = "JPY",
}: {
  data: BalanceChartPoint[];
  currentBalance: number;
  label: string;
  currencyCode?: SupportedCurrencyCode;
}) {
  const [chartRef, chartSize] = useElementSize();

  if (data.length === 0) {
    return (
      <div ref={chartRef} className="flex h-full min-h-0 min-w-0 items-center justify-center text-white/60">
        表示できる {label} の推移がありません。
      </div>
    );
  }

  const balances = data.map((point) => point.balance);
  const minBalance = Math.min(...balances);
  const maxBalance = Math.max(...balances);
  const chartDomain: [number, number] =
    minBalance === maxBalance
      ? [
          minBalance - Math.max(Math.abs(currentBalance) * 0.08, 10_000),
          maxBalance + Math.max(Math.abs(currentBalance) * 0.08, 10_000),
        ]
      : [
          minBalance - Math.max((maxBalance - minBalance) * 0.12, 10_000),
          maxBalance + Math.max((maxBalance - minBalance) * 0.12, 10_000),
        ];
  const showZeroLine = chartDomain[0] <= 0 && chartDomain[1] >= 0;

  return (
    <div ref={chartRef} className="h-full min-h-0 min-w-0">
      {chartSize.width > 0 && chartSize.height > 0 ? (
        <LineChart
          data={data}
          height={chartSize.height}
          margin={{ left: 12, right: 12, top: 12, bottom: 8 }}
          width={chartSize.width}
        >
          {showZeroLine ? <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" /> : null}
          <XAxis
            dataKey="date"
            stroke="rgba(255,255,255,0.28)"
            height={28}
            tick={{ fontSize: 10, fill: "rgba(255,255,255,0.58)" }}
            tickLine={false}
            tickMargin={6}
            minTickGap={24}
            interval="preserveStartEnd"
            tickFormatter={formatChartDateWithYear}
            padding={{ left: 20, right: 20 }}
          />
          <YAxis
            stroke="rgba(255,255,255,0.4)"
            tickFormatter={(value) => formatCurrency(value, currencyCode)}
            width={110}
            domain={chartDomain}
            tickCount={6}
          />
          <Tooltip
            contentStyle={{
              background: "rgba(18, 22, 30, 0.96)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 16,
            }}
            formatter={(value) => formatCurrency(value as number, currencyCode)}
            labelFormatter={(_, payload) => {
              const point = payload?.[0]?.payload as BalanceChartPoint | undefined;
              if (!point) {
                return "";
              }

              return point.description
                ? `${point.description} / ${formatDateWithYear(point.date)}`
                : formatDateWithYear(point.date);
            }}
          />
          <Line type="monotone" dataKey="balance" stroke="hsl(var(--primary))" strokeWidth={3} dot={false} />
        </LineChart>
      ) : null}
    </div>
  );
}
