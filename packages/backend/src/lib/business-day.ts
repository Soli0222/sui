import holidayJp from "@holiday-jp/holiday_jp";

export type DateShiftPolicy = "none" | "previous" | "next";

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function isBusinessDay(date: string): boolean {
  const value = new Date(`${date}T00:00:00.000Z`);
  const day = value.getUTCDay();
  return day !== 0 && day !== 6 && !holidayJp.isHoliday(date);
}

export function adjustToBusinessDay(date: string, policy: DateShiftPolicy): string {
  if (policy === "none" || isBusinessDay(date)) {
    return date;
  }

  const direction = policy === "previous" ? -1 : 1;
  let adjusted = date;
  do {
    adjusted = addDays(adjusted, direction);
  } while (!isBusinessDay(adjusted));

  return adjusted;
}
