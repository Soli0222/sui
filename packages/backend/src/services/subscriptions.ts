import type { Subscription } from "@sui/shared";
import { getOccurrenceDatesInMonth, type Schedule } from "@sui/shared";

function scheduleFromSubscription(subscription: Subscription): Schedule {
  return {
    recurrence: subscription.recurrence,
    interval: subscription.interval,
    dayOfMonth: subscription.dayOfMonth,
    dayOfWeek: subscription.dayOfWeek,
    startDate: subscription.startDate,
    endDate: subscription.endDate,
  };
}

export function isActiveInMonth(subscription: Subscription, yearMonth: string): boolean {
  return getOccurrenceDatesInMonth(scheduleFromSubscription(subscription), yearMonth).length > 0;
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
    for (const date of getOccurrenceDatesInMonth(scheduleFromSubscription(subscription), yearMonth)) {
      items.push({ subscription, date });
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
