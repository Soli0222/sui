import type { Subscription } from "@sui/shared";

function getTotalMonths(yearMonth: string) {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));
  return year * 12 + month - 1;
}

export function isActiveInMonth(subscription: Subscription, yearMonth: string): boolean {
  const startYearMonth = subscription.startDate.slice(0, 7);
  if (startYearMonth > yearMonth) {
    return false;
  }

  if (subscription.endDate && subscription.endDate.slice(0, 7) < yearMonth) {
    return false;
  }

  const monthsSinceStart = getTotalMonths(yearMonth) - getTotalMonths(startYearMonth);
  return monthsSinceStart >= 0 && monthsSinceStart % subscription.intervalMonths === 0;
}

export function getMonthlySummary(subscriptions: Subscription[], yearMonth: string) {
  const items = subscriptions
    .filter((subscription) => isActiveInMonth(subscription, yearMonth))
    .sort((left, right) => left.dayOfMonth - right.dayOfMonth || left.name.localeCompare(right.name, "ja-JP"));

  return {
    items,
    total: items.reduce((sum, item) => sum + item.amount, 0),
  };
}

export function getAnnualTotal(subscriptions: Subscription[], year: number) {
  let total = 0;

  for (let month = 1; month <= 12; month += 1) {
    const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
    total += getMonthlySummary(subscriptions, yearMonth).total;
  }

  return total;
}
