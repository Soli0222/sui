const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function getJstToday(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, 10);
}

export function getCurrentYearMonth(today = getJstToday()): string {
  return today.slice(0, 7);
}

export function isYearMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

export function isDateString(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export {
  addMonthsToYearMonth,
  fromDateOnlyString,
  getDayOfWeekDatesInMonth,
  getDaysInMonth,
  getTotalMonths,
  parseYearMonth,
  resolveDateFromYearMonth,
  toDateOnlyString,
} from "@sui/shared";
