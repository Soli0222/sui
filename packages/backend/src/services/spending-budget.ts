import { randomUUID } from "node:crypto";
import type { SpendingLedger, SpendingDetail } from "@sui/shared";

export const mfCategory = (d: SpendingDetail) =>
  d.raw["大項目"] || d.categorySource.split("/")[0];
export function migrateSpending(l: SpendingLedger): SpendingLedger {
  if (l.settings.ai && !l.settings.ai.provider) {
    const ai = l.settings.ai;
    ai.provider =
      ai.endpoint === "https://api.openai.com/v1/chat/completions"
        ? "openai"
        : ai.endpoint === "https://api.anthropic.com/v1/messages"
          ? "anthropic"
          : "custom";
  }
  let category = (value: string) => value;
  if (!l.mfNative) {
    const aliases = new Map<string, Set<string>>();
    for (const [source, target] of Object.entries(l.categoryMappings)) {
      const values = aliases.get(target) ?? new Set<string>();
      values.add(source.split("/")[0]);
      aliases.set(target, values);
    }
    category = (value: string) =>
      aliases.get(value)?.size === 1 ? [...aliases.get(value)!][0] : value;
    // Keep review snapshots and historical input revisions as originally evaluated.

    for (const p of l.plans) p.category = category(p.category);
    for (const r of l.requests) {
      const previous = structuredClone(r.input);
      for (const i of r.input.items) {
        const next = category(i.category);
        if (i.forecastId === `variable:${i.month}:${i.category}`)
          i.forecastId = `variable:${i.month}:${next}`;
        i.category = next;
      }
      if (JSON.stringify(previous) !== JSON.stringify(r.input))
        r.history.push({
          at: new Date().toISOString(),
          action: "mf-category-migration",
          reason: "MFカテゴリへの移行",
          input: previous,
        });
    }
    l.mfNative = true;
  }
  if (!l.budgetProposals) {
    const months = [...new Set(l.budgets.map((b) => b.month))];
    l.budgetProposals = months.map((month) => {
      const latest = [
        ...new Map(
          l.budgets
            .filter((b) => b.month === month)
            .map((b) => [b.category, b]),
        ).values(),
      ];
      const amounts = new Map<string, number>();
      for (const b of latest)
        amounts.set(
          category(b.category),
          (amounts.get(category(b.category)) ?? 0) + b.amount,
        );
      return {
        id: `legacy:${month}`,
        name: "MF通常予算",
        from: month,
        to: month,
        categories: [...amounts].map(([category, amount]) => ({
          category,
          amount,
        })),
        at: latest.at(-1)!.at,
        reason: "旧月別予算から移行",
        supersededAt: null,
      };
    });
  }
  l.paymentLinks ??= {};
  return l;
}
export function budgetAt(l: SpendingLedger, month: string) {
  if (l.budgetProposals)
    return (
      l.budgetProposals.find(
        (p) => !p.supersededAt && p.from <= month && (!p.to || p.to >= month),
      )?.categories ?? []
    );
  return [
    ...new Map(
      l.budgets.filter((b) => b.month === month).map((b) => [b.category, b]),
    ).values(),
  ];
}
export function legacyBudget(
  l: SpendingLedger,
  month: string,
  category: string,
  amount: number,
  reason: string,
  at: string,
) {
  l.budgets.push({ id: randomUUID(), month, category, amount, reason, at });
  // Legacy clients may revise a single month; split the active interval rather than losing other months.
  const categories = [
    ...budgetAt(l, month).filter((c) => c.category !== category),
    { category, amount },
  ];
  const active = l.budgetProposals?.find(
    (p) => !p.supersededAt && p.from <= month && (!p.to || p.to >= month),
  );
  if (active) {
    active.supersededAt = at;
    if (active.from < month)
      l.budgetProposals!.push({
        ...active,
        id: randomUUID(),
        to: shiftMonth(month, -1),
        supersededAt: null,
      });
    if (!active.to || active.to > month)
      l.budgetProposals!.push({
        ...active,
        id: randomUUID(),
        from: shiftMonth(month, 1),
        supersededAt: null,
      });
  }
  l.budgetProposals!.push({
    id: randomUUID(),
    name: "MF通常予算",
    from: month,
    to: month,
    categories,
    at,
    reason,
    supersededAt: null,
  });
}
import { addMonthsToYearMonth as shiftMonth } from "@sui/shared";
