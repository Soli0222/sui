function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function parseYearMonth(yearMonth: string) {
  const [year, month] = yearMonth.split("-").map(Number);
  return { year, month };
}

export function getDaysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addMonthsToYearMonth(yearMonth: string, offset: number): string {
  const { year, month } = parseYearMonth(yearMonth);
  const total = year * 12 + (month - 1) + offset;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return `${nextYear}-${pad(nextMonth)}`;
}

export function resolveDateFromYearMonth(yearMonth: string, dayOfMonth: number): string {
  const { year, month } = parseYearMonth(yearMonth);
  const day = Math.min(dayOfMonth, getDaysInMonth(year, month));
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function getDayOfWeekDatesInMonth(yearMonth: string, dayOfWeek: number): string[] {
  const { year, month } = parseYearMonth(yearMonth);
  const daysInMonth = getDaysInMonth(year, month);
  const dates: string[] = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCDay() === dayOfWeek) {
      dates.push(`${year}-${pad(month)}-${pad(day)}`);
    }
  }

  return dates;
}

export function getTotalMonths(yearMonth: string) {
  const { year, month } = parseYearMonth(yearMonth);
  return year * 12 + month - 1;
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
