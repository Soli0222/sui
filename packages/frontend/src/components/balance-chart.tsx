import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatChartDateWithYear, formatCurrency, formatDateWithYear } from "../lib/format";

type BalanceChartPoint = {
  date: string;
  balance: number;
  description?: string;
};

export function BalanceChart({
  data,
  currentBalance,
  label,
}: {
  data: BalanceChartPoint[];
  currentBalance: number;
  label: string;
}) {
  if (data.length === 0) {
    return <div className="flex h-full items-center justify-center text-white/60">表示できる {label} の推移がありません。</div>;
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
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ left: 12, right: 12, top: 12, bottom: 8 }}>
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
          tickFormatter={formatCurrency}
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
          formatter={(value) => formatCurrency(value as number)}
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
    </ResponsiveContainer>
  );
}
