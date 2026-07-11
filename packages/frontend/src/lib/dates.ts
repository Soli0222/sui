function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function addMonthsToYearMonth(yearMonth: string, offset: number): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const total = year * 12 + (month - 1) + offset;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  return `${nextYear}-${pad(nextMonth)}`;
}
