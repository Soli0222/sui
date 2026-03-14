const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function getJstToday(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, 10);
}

export function getCurrentYearMonth(today = getJstToday()): string {
  return today.slice(0, 7);
}

export function parseYearMonth(yearMonth: string) {
  const [year, month] = yearMonth.split("-").map(Number);
  return { year, month };
}

export function isYearMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

export function isDateString(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function addMonthsToYearMonth(yearMonth: string, offset: number): string {
  const { year, month } = parseYearMonth(yearMonth);
  const total = year * 12 + (month - 1) + offset;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return `${nextYear}-${pad(nextMonth)}`;
}

export function getDaysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function resolveDateFromYearMonth(yearMonth: string, dayOfMonth: number): string {
  const { year, month } = parseYearMonth(yearMonth);
  const day = Math.min(dayOfMonth, getDaysInMonth(year, month));
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function toDateOnlyString(date: Date | null | undefined): string | null {
  if (!date) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

export function fromDateOnlyString(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

