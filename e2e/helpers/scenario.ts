import { addCalendarDays, addMonthsToYearMonth, fromDateOnlyString, toJstDateString } from "@sui/shared";

// Stable dates for fixture data, never the expected "today" of a newly opened screen.
function scenarioDate() {
  const startedAt = process.env.SUI_E2E_STARTED_AT;
  if (!startedAt) throw new Error("Use make test-e2e to capture the scenario date");
  return toJstDateString(startedAt);
}

export function getDate(offsetDays = 0) {
  return addCalendarDays(scenarioDate(), offsetDays);
}

export function getYearMonth(offsetMonths = 0) {
  return addMonthsToYearMonth(scenarioDate().slice(0, 7), offsetMonths);
}

export function getYear() {
  return Number(scenarioDate().slice(0, 4));
}

// A form can open across midnight. Both dates observed around that action are valid.
export function getCurrentDates(openedAt: Date, checkedAt = new Date()) {
  return [...new Set([openedAt, checkedAt].map((date) => toJstDateString(date.toISOString())))];
}

// A single future event keeps UI scenarios independent of the month length and holidays.
export function getOneTimeSchedule(offsetDays = 1) {
  const date = getDate(offsetDays);
  return {
    dayOfMonth: Number(date.slice(8)),
    startDate: fromDateOnlyString(date),
    endDate: fromDateOnlyString(date),
    dateShiftPolicy: "none" as const,
  };
}

export function formatJapaneseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}
