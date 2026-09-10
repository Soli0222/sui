import { createHash } from "node:crypto";
import {
  addCalendarMonths,
  addMonthsToYearMonth,
  getDaysInYearMonth,
  toJstDateString,
} from "@sui/shared";
import type {
  SpendingLedger,
  SpendingRequest,
  SpendingLimitUsage,
} from "@sui/shared";
import { mfCategory } from "./spending-budget";
import {
  coveredDays,
  recordedPurchase,
  spendingFacts,
  sum,
} from "./spending-core";

export function spendingEvidence(
  l: SpendingLedger,
  r: SpendingRequest,
  today: string,
) {
  const from = addCalendarMonths(today, -12);
  const categories = new Set(r.input.items.map((i) => i.category));
  const details = l.details.filter(
    (d) => !d.deletedAt && d.date >= from && d.date <= today,
  );
  const groups = new Map<
    string,
    {
      id: string;
      month: string;
      category: string;
      subcategory: string;
      total: number;
      count: number;
    }
  >();
  for (const d of spendingFacts(l).filter(
    (d) => d.date >= from && d.date <= today,
  )) {
    const month = d.date.slice(0, 7),
      category = mfCategory(d),
      subcategory = d.raw["中項目"] || "";
    const id = `mf:${createHash("sha256")
      .update(JSON.stringify([month, category, subcategory]))
      .digest("hex")
      .slice(0, 24)}`;
    const group = groups.get(id) ?? {
      id,
      month,
      category,
      subcategory,
      total: 0,
      count: 0,
    };
    group.total -= d.amount;
    group.count++;
    groups.set(id, group);
  }
  const score = (d: (typeof details)[number]) =>
    (r.input.subcategory && d.raw["中項目"] === r.input.subcategory ? 4 : 0) +
    (categories.has(mfCategory(d)) ? 2 : 0) +
    (mfCategory(d) === "特別な支出" ? 1 : 0);
  details.sort(
    (a, b) =>
      score(b) - score(a) ||
      b.date.localeCompare(a.date) ||
      a.id.localeCompare(b.id),
  );
  const selected = details.slice(0, 500);
  const related = l.requests
    .filter((x) => x.id !== r.id && !x.deletedAt)
    .sort(
      (a, b) =>
        Number(r.input.relatedIds.includes(b.id)) -
          Number(r.input.relatedIds.includes(a.id)) ||
        Number(b.input.items.some((i) => categories.has(i.category))) -
          Number(a.input.items.some((i) => categories.has(i.category))) ||
        b.createdAt.localeCompare(a.createdAt),
    );
  return {
    from,
    through: today,
    // Aggregates are complete, even when individual rows are omitted.
    monthly: [...groups.values()].sort(
      (a, b) =>
        a.month.localeCompare(b.month) ||
        a.category.localeCompare(b.category) ||
        a.subcategory.localeCompare(b.subcategory),
    ),
    coverage: Array.from({ length: 13 }, (_, n) => {
      const month = addMonthsToYearMonth(today.slice(0, 7), n - 12);
      const days =
        month === today.slice(0, 7)
          ? Number(today.slice(8))
          : getDaysInYearMonth(month);
      return {
        month,
        coveredDays: coveredDays(l, month, days),
        elapsedDays: days,
        partialWindow: month === from.slice(0, 7),
      };
    }),
    details: selected.map((d) => ({
      id: d.id,
      date: d.date,
      description: d.description,
      amount: d.amount,
      category: mfCategory(d),
      subcategory: d.raw["中項目"] || "",
      memo: d.raw["メモ"] || "",
      included: d.included,
      transfer: d.transfer,
      oneOff: d.oneOff,
      refundOf: d.refundOf,
    })),
    detailTruncated: details.length > selected.length,
    omittedDetails: details.length - selected.length,
    relatedRequests: related.slice(0, 100).map((x) => ({
      id: x.id,
      input: {
        ...x.input,
        funding: x.input.funding
          ? { amount: x.input.funding.amount, date: x.input.funding.date }
          : null,
      },
      status: x.status,
      purchase: recordedPurchase(x),
      note: "MFとの対応は管理していません。重複加算・未反映の断定をしないでください。",
    })),
    omittedRequests: Math.max(0, related.length - 100),
    answers: (r.answers ?? []).map((a) => ({
      ...a,
      current: a.inputKey
        ? a.inputKey ===
          createHash("sha256").update(JSON.stringify(r.input)).digest("hex")
        : a.requestVersion === r.version,
    })),
  };
}

/** Recover the last approved scope for old ledgers without rewriting their history. */
export function allowanceUse(l: SpendingLedger, r: SpendingRequest) {
  if (r.allowanceUse) return r.allowanceUse;
  const review = l.reviews
    .slice()
    .reverse()
    .find(
      (v) =>
        v.requestId === r.id &&
        v.decision === "approvable" &&
        v.snapshot.input.kind === "supplemental",
    );
  const input = review?.snapshot.input ?? r.input;
  if (input.kind !== "supplemental") return null;
  return {
    at: toJstDateString(review?.at ?? r.createdAt),
    amountJpy: Math.round(
      (r.approvedAmount || sum(input.items.map((i) => i.amount))) *
        (input.rateToJpy ?? 0),
    ),
    category: input.items[0].category,
    subcategory: input.subcategory ?? "",
  };
}

/** MF spending is never added to allowance usage. Each request is counted once. */
export function spendingLimits(
  l: SpendingLedger,
  current: SpendingRequest,
  today: string,
  usedFunding: ReadonlyMap<string, number>,
): SpendingLimitUsage[] {
  if (current.input.kind !== "supplemental") return [];
  return (l.settings.supplementalLimits ?? [])
    .filter(
      (rule) =>
        !rule.category ||
        current.input.items.some((i) => i.category === rule.category),
    )
    .map((rule) => {
      const from = addCalendarMonths(today, -rule.months);
      const rows = l.requests
        .filter((r) => r.id !== current.id)
        .flatMap((r) => {
          const use = allowanceUse(l, r);
          if (
            !use ||
            (rule.category && use.category !== rule.category) ||
            (rule.subcategory && use.subcategory !== rule.subcategory)
          )
            return [];
          const spent = !!recordedPurchase(r) || usedFunding.has(r.id);
          const pending =
            !spent &&
            (r.status === "approved" ||
              (r.status === "reviewing" && r.approvedAmount > 0)) &&
            (!r.expiresAt || r.expiresAt >= today);
          if (
            (!spent && !pending) ||
            (!pending && (use.at < from || use.at > today))
          )
            return [];
          const amount = Math.max(
            use.amountJpy,
            Math.round(
              (recordedPurchase(r)?.amount ?? 0) * (r.input.rateToJpy ?? 0),
            ),
            usedFunding.get(r.id) ?? 0,
          );
          return [{ id: r.id, amount }];
        });
      const applies =
        !rule.subcategory || rule.subcategory === current.input.subcategory;
      const previous = allowanceUse(l, current);
      const spent = !!recordedPurchase(current) || usedFunding.has(current.id);
      const requested = applies
        ? Math.max(
            Math.round(
              sum(current.input.items.map((i) => i.amount)) *
                (current.input.rateToJpy ?? 0),
            ),
            spent ? (previous?.amountJpy ?? 0) : 0,
            Math.round(
              (recordedPurchase(current)?.amount ?? 0) *
                (current.input.rateToJpy ?? 0),
            ),
            usedFunding.get(current.id) ?? 0,
          )
        : 0;
      const used = sum(rows.map((r) => r.amount));
      return {
        ...rule,
        from,
        through: today,
        used,
        requested,
        total: used + requested,
        exceeded: used + requested > rule.amount && applies,
        requestIds: rows.map((r) => r.id),
      };
    });
}
