import { convertMinorUnitToJpy } from "../constants/currency";
import type { Subscription, SubscriptionOccurrence } from "../types/domain";
import { resolveDatedAmount } from "./amount-history";
import { getOccurrenceDatesInMonth } from "./schedule";

export function isActiveInMonth(subscription: Subscription, yearMonth: string): boolean {
  return getOccurrenceDatesInMonth(subscription, yearMonth).length > 0;
}

export function getMonthlySummary(subscriptions: Subscription[], yearMonth: string): {
  items: SubscriptionOccurrence[];
  total: number;
} {
  const items: SubscriptionOccurrence[] = [];
  for (const subscription of subscriptions) {
    for (const date of getOccurrenceDatesInMonth(subscription, yearMonth)) {
      items.push({ subscription, date, amount: resolveDatedAmount(subscription.amount, subscription.amountChanges ?? [], date) });
    }
  }
  items.sort((left, right) =>
    left.date.localeCompare(right.date) || left.subscription.name.localeCompare(right.subscription.name, "ja-JP"));
  return {
    items,
    total: items.reduce((sum, item) => sum + convertMinorUnitToJpy(
      item.amount, item.subscription.currencyCode, item.subscription.exchangeRateToJpy,
    ), 0),
  };
}

export function getAnnualTotal(subscriptions: Subscription[], year: number): number {
  let total = 0;
  for (let month = 1; month <= 12; month += 1) {
    total += getMonthlySummary(subscriptions, `${year}-${String(month).padStart(2, "0")}`).total;
  }
  return total;
}
