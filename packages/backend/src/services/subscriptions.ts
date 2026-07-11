import type { Subscription } from "@sui/shared";
import { getDayOfWeekDatesInMonth, resolveDateFromYearMonth } from "../lib/dates";

function getTotalMonths(yearMonth: string) {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));
  return year * 12 + month - 1;
}

function isDateInRange(subscription: Subscription, date: string): boolean {
  if (date < subscription.startDate) {
    return false;
  }

  if (subscription.endDate && date > subscription.endDate) {
    return false;
  }

  return true;
}

export function isActiveInMonth(subscription: Subscription, yearMonth: string): boolean {
  const startYearMonth = subscription.startDate.slice(0, 7);
  if (startYearMonth > yearMonth) {
    return false;
  }

  if (subscription.endDate && subscription.endDate.slice(0, 7) < yearMonth) {
    return false;
  }

  if (subscription.recurrence === "weekly") {
    if (subscription.dayOfWeek == null) {
      return false;
    }
    return getDayOfWeekDatesInMonth(yearMonth, subscription.dayOfWeek).some((date) =>
      isDateInRange(subscription, date),
    );
  }

  const monthsSinceStart = getTotalMonths(yearMonth) - getTotalMonths(startYearMonth);
  return monthsSinceStart >= 0 && monthsSinceStart % (subscription.intervalMonths ?? 1) === 0;
}

export interface SubscriptionOccurrence {
  subscription: Subscription;
  date: string;
}

export function getMonthlySummary(
  subscriptions: Subscription[],
  yearMonth: string,
): {
  items: SubscriptionOccurrence[];
  total: number;
} {
  const items: SubscriptionOccurrence[] = [];

  for (const subscription of subscriptions) {
    if (!isActiveInMonth(subscription, yearMonth)) {
      continue;
    }

    if (subscription.recurrence === "weekly") {
      if (subscription.dayOfWeek == null) {
        continue;
      }
      for (const date of getDayOfWeekDatesInMonth(yearMonth, subscription.dayOfWeek)) {
        if (isDateInRange(subscription, date)) {
          items.push({ subscription, date });
        }
      }
    } else {
      if (subscription.dayOfMonth == null) {
        continue;
      }
      const date = resolveDateFromYearMonth(yearMonth, subscription.dayOfMonth);
      if (isDateInRange(subscription, date)) {
        items.push({ subscription, date });
      }
    }
  }

  items.sort(
    (left, right) => left.date.localeCompare(right.date) || left.subscription.name.localeCompare(right.subscription.name, "ja-JP"),
  );

  return {
    items,
    total: items.reduce((sum, item) => sum + item.subscription.amount, 0),
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
