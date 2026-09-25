export interface DatedAmount {
  effectiveFrom: string;
  amount: number;
}

/** Resolve the price of one occurrence. Changes need not be sorted. */
export function resolveDatedAmount(initialAmount: number, changes: readonly DatedAmount[], date: string): number {
  let amount = initialAmount;
  let latest = "";
  for (const change of changes) {
    if (change.effectiveFrom <= date && change.effectiveFrom > latest) {
      latest = change.effectiveFrom;
      amount = change.amount;
    }
  }
  return amount;
}

/** Inclusive display periods; retain malformed history so the editor can repair it. */
export function getRecurringAmountPeriods(item: Pick<RecurringItem, "startDate" | "endDate" | "amount" | "amountChanges">) {
  const changes = [...(item.amountChanges ?? [])].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const prices = [{ key: "initial", startDate: item.startDate, amount: item.amount },
    ...changes.map((change) => ({ key: change.id, startDate: change.effectiveFrom, amount: change.amount }))];
  return prices.map((price, index) => {
    const nextStart = prices[index + 1]?.startDate;
    const priceEnd = nextStart ? addCalendarDays(nextStart, -1) : null;
    const endDate = item.endDate && priceEnd ? (item.endDate < priceEnd ? item.endDate : priceEnd) : item.endDate ?? priceEnd;
    return { ...price, endDate };
  });
}
import { addCalendarDays } from "./dates";
import type { RecurringItem } from "../types/domain";
