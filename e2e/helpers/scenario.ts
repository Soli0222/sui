export function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

export function businessNow() {
  const value = process.env.SUI_E2E_NOW;
  if (!value) throw new Error("Use make test-e2e to set the E2E business clock");
  return new Date(value);
}

function getJstDate(offsetDays = 0) {
  const now = businessNow();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + offsetDays));
}

export function getFutureDate(offsetDays = 7) {
  return getJstDate(offsetDays).toISOString().slice(0, 10);
}

export function formatJapaneseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

export function getYearMonth(offsetMonths = 0) {
  const now = businessNow();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const target = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + offsetMonths, 1));
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function getForecastDayOfMonth(offsetDays = 1) {
  const now = businessNow();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return Math.min(jst.getUTCDate() + offsetDays, 31);
}
