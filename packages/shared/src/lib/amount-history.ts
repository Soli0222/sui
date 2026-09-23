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
