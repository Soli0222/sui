import {
  fromDateOnlyString,
  getDayOfWeekDatesInMonth,
  getTotalMonths,
  resolveDateFromYearMonth,
  toDateOnlyString,
} from "./dates";

export interface Schedule {
  recurrence: "monthly" | "weekly";
  interval: number;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  startDate: string | null;
  endDate: string | null;
}

function formatDayOfWeek(dayOfWeek: number | null) {
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  if (dayOfWeek === null || dayOfWeek === undefined) {
    return "?";
  }
  return days[dayOfWeek] ?? "?";
}

export function formatSchedule(schedule: {
  recurrence?: string | null;
  interval?: number | null;
  dayOfMonth?: number | null;
  dayOfWeek?: number | null;
  startDate?: string | null;
}) {
  const recurrence = schedule.recurrence ?? "monthly";
  const interval = schedule.interval ?? 1;
  const dayOfMonth = schedule.dayOfMonth ?? null;
  const dayOfWeek = schedule.dayOfWeek ?? null;

  if (recurrence === "weekly") {
    const prefix = interval === 1 ? "毎週" : `${interval}週ごと`;
    return `${prefix} ${formatDayOfWeek(dayOfWeek)}曜日`;
  }

  if (interval === 12) {
    const month = schedule.startDate ? Number(schedule.startDate.slice(5, 7)) : null;
    const monthText = month ? `${month}月` : "";
    return `毎年 ${monthText}${dayOfMonth ?? "?"}日`;
  }

  const prefix = interval === 1 ? "毎月" : `${interval}ヶ月ごと`;
  return `${prefix} ${dayOfMonth ?? "?"}日`;
}

function isDateInRange(startDate: string | null, endDate: string | null, date: string): boolean {
  if (startDate && date < startDate) {
    return false;
  }

  if (endDate && date > endDate) {
    return false;
  }

  return true;
}

function getFirstDayOfWeekOnOrAfter(startDate: string, dayOfWeek: number): string {
  const date = fromDateOnlyString(startDate);
  const startDayOfWeek = date.getUTCDay();
  const offset = (dayOfWeek - startDayOfWeek + 7) % 7;
  date.setUTCDate(date.getUTCDate() + offset);
  return toDateOnlyString(date)!;
}

function matchesMonthlyInterval(
  yearMonth: string,
  startDate: string,
  interval: number,
): boolean {
  const startYearMonth = startDate.slice(0, 7);
  const startTotal = getTotalMonths(startYearMonth);
  const targetTotal = getTotalMonths(yearMonth);
  const diff = targetTotal - startTotal;
  return diff >= 0 && diff % interval === 0;
}

function matchesWeeklyInterval(date: string, anchor: string, interval: number): boolean {
  const diffDays = (fromDateOnlyString(date).getTime() - fromDateOnlyString(anchor).getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays % (7 * interval) === 0;
}

export function getOccurrenceDatesInMonth(
  schedule: Schedule,
  yearMonth: string,
  filterByRange = true,
): string[] {
  const { recurrence, interval, dayOfMonth, dayOfWeek, startDate, endDate } = schedule;

  if (interval < 1) {
    return [];
  }

  if (recurrence === "weekly") {
    if (dayOfWeek == null) {
      return [];
    }

    const dates = getDayOfWeekDatesInMonth(yearMonth, dayOfWeek);

    if (interval === 1) {
      return filterByRange ? dates.filter((date) => isDateInRange(startDate, endDate, date)) : dates;
    }

    if (!startDate) {
      return [];
    }

    const anchor = getFirstDayOfWeekOnOrAfter(startDate, dayOfWeek);
    return dates.filter((date) => {
      if (filterByRange && !isDateInRange(startDate, endDate, date)) {
        return false;
      }
      return matchesWeeklyInterval(date, anchor, interval);
    });
  }

  if (dayOfMonth == null) {
    return [];
  }

  if (interval > 1 && !startDate) {
    return [];
  }

  if (startDate && !matchesMonthlyInterval(yearMonth, startDate, interval)) {
    return [];
  }

  const date = resolveDateFromYearMonth(yearMonth, dayOfMonth);

  if (filterByRange && !isDateInRange(startDate, endDate, date)) {
    return [];
  }

  return [date];
}

export function occursInMonth(schedule: Schedule, yearMonth: string): boolean {
  return getOccurrenceDatesInMonth(schedule, yearMonth).length > 0;
}
