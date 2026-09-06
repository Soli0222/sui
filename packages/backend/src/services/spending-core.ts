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

export function emptySpendingLedger(): SpendingLedger {
  return {
    schemaVersion: 1,
    settings: {
      threshold: null,
      freshnessDays: null,
      approvalDays: null,
      fundingDays: null,
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
export function effectiveStatus(r: SpendingRequest, today: string) {
  if (r.status === "approved" && r.expiresAt && r.expiresAt < today)
    return r.purchases.length ? "purchased" : "expired";
  return r.status;
}
export function hasReservation(r: SpendingRequest, today: string) {
  return (
    !r.closedRemainder &&
    ["approved", "purchased", "reviewing"].includes(
      effectiveStatus(r, today),
    ) &&
    (!r.expiresAt || r.expiresAt >= today)
  );
}
export function validDetail(d: SpendingDetail) {
  return !d.deletedAt && d.included && !d.transfer && d.amount < 0;
}
/** Apply user-confirmed budget attribution without changing MF's source rows. */
export function spendingFacts(ledger: SpendingLedger) {
  const result: (SpendingDetail & {
    budgetMonth: string;
    budgetCategory: string;
    supplemental: boolean;
    requestId: string | null;
    itemId: string | null;
  })[] = [];
  for (const detail of ledger.details.filter(validDetail)) {
    let remaining = -detail.amount;
    for (const request of ledger.requests)
      for (const purchase of request.purchases) {
        const item = request.input.items.find(
          (item) => item.id === purchase.itemId,
        );
        if (!item) continue;
        for (const ref of purchase.reflected.filter(
          (ref) => ref.detailId === detail.id,
        )) {
          const amount = Math.min(remaining, ref.amount);
          if (!amount) continue;
          remaining -= amount;
          result.push({
            ...detail,
            amount: -amount,
            budgetMonth: item.month,
            budgetCategory: item.category,
            supplemental: request.input.kind === "supplemental",
            requestId: request.id,
            itemId: item.id,
          });
        }
      }
    if (remaining)
      result.push({
        ...detail,
        amount: -remaining,
        budgetMonth: detail.date.slice(0, 7),
        budgetCategory: ledger.categoryMappings[detail.categorySource] ?? "",
        supplemental: false,
        requestId: null,
        itemId: null,
      });
  }
  return result;
}
export function reflectedAmount(
  ledger: SpendingLedger,
  request: SpendingRequest,
  itemId?: string,
) {
  return (
    sum(
      spendingFacts(ledger)
        .filter(
          (f) => f.requestId === request.id && (!itemId || f.itemId === itemId),
        )
        .map((f) => -f.amount),
    ) / (request.input.rateToJpy || 1)
  );
}
export function reservedAmount(
  ledger: SpendingLedger,
  r: SpendingRequest,
  itemId: string,
  today: string,
) {
  const purchased = sum(
    r.purchases.filter((p) => p.itemId === itemId).map((p) => p.amount),
  );
  const planned = r.input.items.find((i) => i.id === itemId)?.amount ?? 0;
  return Math.max(
    0,
    Math.max(purchased, hasReservation(r, today) ? planned : 0) -
      reflectedAmount(ledger, r, itemId),
  );
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
    ledger.imports.some(
      (i) =>
        i.committed && i.confirmedCoverage && i.from <= date && i.to >= date,
    ),
  ).length;
}
export function calculateSpending(
  ledger: SpendingLedger,
  request: SpendingRequest,
  today: string,
): SpendingCalculation[] {
  const keys = [
    ...new Set(
      request.input.items.map((i) => JSON.stringify([i.month, i.category])),
    ),
  ];
  return keys.map((key) => {
    const [month, category] = JSON.parse(key) as [string, string];
    const rate = request.input.rateToJpy ?? 0;
    const jpy = (amount: number) => Math.round(amount * rate);
    const facts = spendingFacts(ledger);
    const rowsFor = (m: string) =>
      facts.filter((d) => d.budgetMonth === m && d.budgetCategory === category);
    const amountFor = (d: (typeof facts)[number]) =>
      d.supplemental ? 0 : -d.amount;
    const current = rowsFor(month);
    const A = sum(current.map(amountFor));
    const history = [-3, -2, -1].map((offset) => {
      const m = addMonthsToYearMonth(month, offset),
        rows = rowsFor(m);
      return {
        month: m,
        total: sum(rows.map(amountFor)),
        variable: sum(
          rows.filter((d) => !d.oneOff && !d.fixedId).map(amountFor),
        ),
        covered: coveredDays(ledger, m, monthDays(m)) === monthDays(m),
      };
    });
    const samples = history
      .filter((h) => h.covered)
      .map((h) => h.variable)
      .sort((a, b) => a - b);
    const median = samples.length ? samples[Math.floor(samples.length / 2)] : 0;
    const elapsed =
      month < today.slice(0, 7)
        ? monthDays(month)
        : month > today.slice(0, 7)
          ? 0
          : Number(today.slice(8));
    const coverage = coveredDays(ledger, month, elapsed);
    const currentPace = coverage
      ? Math.ceil(
          (sum(
            current
              .filter((d) => !d.oneOff && !d.fixedId && d.date <= today)
              .map(amountFor),
          ) /
            coverage) *
            monthDays(month),
        )
      : 0;
    const remainingDays = monthDays(month) - elapsed;
    const variable = Math.ceil(
      (Math.max(median, currentPace) * remainingDays) / monthDays(month),
    );
    const plans = ledger.plans.filter(
      (p) => p.month === month && p.category === category,
    );
    const forecasts = [
      ...plans.map((p) => ({
        id: p.id,
        amount: p.amount,
        actual: sum(current.filter((d) => d.fixedId === p.id).map(amountFor)),
      })),
      { id: `variable:${month}:${category}`, amount: variable, actual: 0 },
    ];
    const others = ledger.requests.filter(
      (r) => r.id !== request.id && r.input.kind === "normal",
    );
    const claims = (id: string, requests: SpendingRequest[]) =>
      sum(
        requests.flatMap((r) =>
          r.input.items
            .filter(
              (i) =>
                i.forecastId === id &&
                (hasReservation(r, today) ||
                  r.purchases.some((p) => p.itemId === i.id)),
            )
            .map((i) =>
              Math.round(i.forecastAmount * (r.input.rateToJpy ?? 0)),
            ),
        ),
      );
    const forecastAvailable = forecasts.map((p) => ({
      id: p.id,
      amount: Math.max(
        0,
        p.amount -
          Math.max(
            Math.max(
              0,
              p.actual -
                sum(
                  current
                    .filter(
                      (d) => d.fixedId === p.id && d.requestId === request.id,
                    )
                    .map(amountFor),
                ),
            ),
            claims(p.id, others),
          ),
      ),
    }));
    const Fbefore = sum(forecastAvailable.map((p) => p.amount));
    const ownItems = request.input.items.filter(
      (i) => i.month === month && i.category === category,
    );
    const requestedClaim =
      request.input.kind === "normal"
        ? sum(ownItems.map((i) => jpy(i.forecastAmount)))
        : 0;
    const missing: string[] = [];
    for (const item of ownItems) {
      if (
        item.forecastAmount > 0 &&
        (!item.forecastId ||
          sum(
            ownItems
              .filter((i) => i.forecastId === item.forecastId)
              .map((i) => jpy(i.forecastAmount)),
          ) >
            (forecastAvailable.find((f) => f.id === item.forecastId)?.amount ??
              0))
      )
        missing.push("予測からの充当が利用可能額を超えています");
    }
    const F = requestedClaim
      ? sum(
          forecasts.map((p) =>
            Math.max(
              0,
              p.amount -
                Math.max(
                  p.actual,
                  claims(p.id, others) +
                    sum(
                      ownItems
                        .filter((i) => i.forecastId === p.id)
                        .map((i) => jpy(i.forecastAmount)),
                    ),
                ),
            ),
          ),
        )
      : Fbefore;
    const R = sum(
      others.flatMap((r) =>
        r.input.items
          .filter((i) => i.month === month && i.category === category)
          .map((i) =>
            Math.round(
              reservedAmount(ledger, r, i.id, today) * (r.input.rateToJpy ?? 0),
            ),
          ),
      ),
    );
    const Q =
      request.input.kind === "normal"
        ? sum(
            ownItems.map((i) =>
              Math.max(
                0,
                jpy(i.amount - reflectedAmount(ledger, request, i.id)),
              ),
            ),
          )
        : 0;
    const budget =
      ledger.budgets
        .filter((b) => b.month === month && b.category === category)
        .at(-1)?.amount ?? null;
    if (budget === null) missing.push("対象月・カテゴリの通常予算が未登録です");
    if (history.some((h) => !h.covered))
      missing.push("直近3か月の取込確認範囲が不足しています");
    if (coverage < elapsed) missing.push("当月に取込未確認日があります");
    const latest = ledger.imports
      .filter((i) => i.committed && i.confirmedCoverage)
      .map((i) => i.at.slice(0, 10))
      .sort()
      .at(-1);
    if (
      ledger.settings.freshnessDays === null ||
      !latest ||
      addDays(latest, ledger.settings.freshnessDays) < today
    )
      missing.push("明細の鮮度を確認できません");
    if (current.some((d) => !ledger.paymentMappings[d.paymentSource]))
      missing.push("未対応の支払手段があります");
    if (
      ledger.details.some(
        (d) =>
          validDetail(d) &&
          d.date.startsWith(month) &&
          !ledger.categoryMappings[d.categorySource],
      )
    )
      missing.push("未対応カテゴリがあります");
    return {
      month,
      category,
      budget,
      A,
      R,
      F,
      Q,
      before: A + R + Fbefore,
      after: A + R + F + Q,
      remaining: budget === null ? null : budget - A - R - F - Q,
      allSpending: sum(current.map((d) => -d.amount)),
      supplemental: sum(
        current.filter((d) => d.supplemental).map((d) => -d.amount),
      ),
      history,
      median,
      average: samples.length ? Math.round(sum(samples) / samples.length) : 0,
      maximum: Math.max(0, ...samples),
      currentPace,
      coveredDays: coverage,
      forecastAvailable,
      missing,
    };
  });
}
