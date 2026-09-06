import { budgetAt, mfCategory } from "./spending-budget";
import type {
  SpendingCalculation,
  SpendingLedger,
  SpendingRequest,
  SpendingDetail,
} from "@sui/shared";
import {
  addMonthsToYearMonth,
  addCalendarDays as addDays,
  getDaysInYearMonth as monthDays,
} from "@sui/shared";

import { SPENDING_RULE_DEFAULTS } from "./spending-defaults";

export function emptySpendingLedger(): SpendingLedger {
  return {
    schemaVersion: 1,
    ruleDefaultsApplied: true,
    settings: {
      ...SPENDING_RULE_DEFAULTS,
      ai: null,
    },
    requests: [],
    details: [],
    allocations: [],
    budgets: [],
    plans: [],
    imports: [],
    reviews: [],
    categoryMappings: {},
    paymentMappings: {},
  };
}
export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
export {
  addCalendarDays as addDays,
  getDaysInYearMonth as monthDays,
} from "@sui/shared";
export function recordedPurchase(r: SpendingRequest) {
  return (
    r.purchaseRecord ??
    (r.purchases.length
      ? {
          amount: sum(r.purchases.map((p) => p.amount)),
          date: r.purchases
            .map((p) => p.date)
            .sort()
            .at(-1)!,
          reason: "旧購入記録",
          at: r.createdAt,
        }
      : null)
  );
}
export function effectiveStatus(r: SpendingRequest, today: string) {
  if (r.status === "reviewing") return r.status;
  if (recordedPurchase(r)) return "completed";
  if (r.status === "approved" && r.expiresAt && r.expiresAt < today)
    return "expired";
  return r.status;
}
export function validDetail(d: SpendingDetail) {
  return !d.deletedAt && d.included && !d.transfer && d.amount < 0;
}
/** MF is the sole source of budget actuals. Expense-category credits are refunds. */
export function spendingFacts(ledger: SpendingLedger) {
  return ledger.details
    .filter(
      (d) =>
        !d.deletedAt && d.included && !d.transfer && mfCategory(d) !== "収入",
    )
    .map((d) => ({
      ...d,
      budgetMonth: d.date.slice(0, 7),
      budgetCategory: mfCategory(d),
      supplemental: false,
    }));
}
export function coveredDays(
  ledger: SpendingLedger,
  month: string,
  through: number,
) {
  return Array.from(
    { length: through },
    (_, n) => `${month}-${String(n + 1).padStart(2, "0")}`,
  ).filter((date) =>
    (ledger.imports.some((i) => i.month === month && i.committed)
      ? ledger.imports.filter((i) => i.month === month)
      : ledger.imports
    ).some(
      (i) =>
        i.committed &&
        !i.supersededAt &&
        i.confirmedCoverage &&
        i.from <= date &&
        i.to >= date,
    ),
  ).length;
}
/** MF actuals plus an isolated what-if for an unpurchased application; no reservations or forecasts. */
export function calculateSpending(
  ledger: SpendingLedger,
  request: SpendingRequest,
  today: string,
): SpendingCalculation[] {
  const facts = spendingFacts(ledger);
  const keys = [
    ...new Set(
      request.input.items.map((i) => JSON.stringify([i.month, i.category])),
    ),
  ];
  return keys.map((key) => {
    const [month, category] = JSON.parse(key) as [string, string];
    const rowsFor = (m: string) =>
      facts.filter((d) => d.budgetMonth === m && d.budgetCategory === category);
    const actual = (m: string) => -sum(rowsFor(m).map((d) => d.amount));
    const A = actual(month);
    const history = [-3, -2, -1].map((n) => {
      const m = addMonthsToYearMonth(month, n),
        total = actual(m);
      return {
        month: m,
        total,
        variable: total,
        covered: coveredDays(ledger, m, monthDays(m)) === monthDays(m),
      };
    });
    const samples = history
      .filter((h) => h.covered)
      .map((h) => h.total)
      .sort((a, b) => a - b);
    const median = samples.length
      ? Math.round(
          (samples[Math.floor((samples.length - 1) / 2)] +
            samples[Math.floor(samples.length / 2)]) /
            2,
        )
      : 0;
    const elapsed =
      month < today.slice(0, 7)
        ? monthDays(month)
        : month > today.slice(0, 7)
          ? 0
          : Number(today.slice(8));
    const coverage = coveredDays(ledger, month, elapsed);
    const Q =
      request.input.kind === "normal" && !recordedPurchase(request)
        ? Math.round(
            sum(
              request.input.items
                .filter((i) => i.month === month && i.category === category)
                .map((i) => i.amount),
            ) * (request.input.rateToJpy ?? 0),
          )
        : 0;
    const budget =
      budgetAt(ledger, month).find((b) => b.category === category)?.amount ??
      null;
    const missing: string[] = [];
    if (budget === null) missing.push("対象月・カテゴリの通常予算が未登録です");
    if (history.some((h) => !h.covered))
      missing.push("直近3か月のMFデータが不足しています");
    const latest = ledger.imports
      .filter(
        (i) =>
          i.committed &&
          !i.supersededAt &&
          i.confirmedCoverage &&
          i.from <= today &&
          i.to >= today.slice(0, 7) + "-01",
      )
      .map((i) => i.at.slice(0, 10))
      .sort()
      .at(-1);
    if (
      ledger.settings.freshnessDays === null ||
      !latest ||
      addDays(latest, ledger.settings.freshnessDays) < today ||
      elapsed - coverage > (ledger.settings.freshnessDays ?? 0)
    )
      missing.push("当月のMFデータを更新してください");
    return {
      month,
      category,
      budget,
      A,
      R: 0,
      F: 0,
      Q,
      before: A,
      after: A + Q,
      remaining: budget === null ? null : budget - A - Q,
      allSpending: A,
      supplemental: 0,
      history,
      median,
      average: samples.length ? Math.round(sum(samples) / samples.length) : 0,
      maximum: samples.at(-1) ?? 0,
      currentPace: 0,
      coveredDays: coverage,
      forecastAvailable: [],
      missing,
    };
  });
}
