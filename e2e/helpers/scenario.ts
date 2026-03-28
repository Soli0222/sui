export function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

function getJstDate(offsetDays = 0) {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + offsetDays));
}

export function getFutureDate(offsetDays = 7) {
  return getJstDate(offsetDays).toISOString().slice(0, 10);
}

export function getYearMonth(offsetMonths = 0) {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const target = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + offsetMonths, 1));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function getForecastDayOfMonth(offsetDays = 1) {
  return Math.min(Number(getFutureDate(offsetDays).slice(8, 10)), 28);
}
