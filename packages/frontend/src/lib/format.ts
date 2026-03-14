const JAPAN_TIME_ZONE = "Asia/Tokyo";

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: JAPAN_TIME_ZONE,
    month: "short",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

export function formatDateWithYear(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: JAPAN_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00+09:00`));
}

export function formatChartDateWithYear(value: string) {
  const date = new Date(`${value}T00:00:00+09:00`);
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: JAPAN_TIME_ZONE,
    year: "2-digit",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}/${month}/${day}`;
}
