import { expect, it } from "vitest";
import { emptySpendingLedger, calculateSpending } from "./spending-core";
import { migrateSpending, budgetAt } from "./spending-budget";
import { syntheticRequest, syntheticDetail } from "./spending-fixtures";
import { previewMfMonth, MF_COLUMNS } from "./spending-csv";
import { spendingLedgerSchema } from "./spending-validation";

it("migrates monthly budgets without extending dates or losing category amounts and review history", () => {
  const l = emptySpendingLedger();
  l.categoryMappings = { "教養/学習": "学習", "教養/書籍": "書籍" };
  l.budgets = [
    {
      id: "a",
      month: "2026-08",
      category: "学習",
      amount: 1000,
      at: "2026-08-01",
      reason: "test",
    },
    {
      id: "b",
      month: "2026-08",
      category: "書籍",
      amount: 2000,
      at: "2026-08-01",
      reason: "test",
    },
  ];
  l.requests = [syntheticRequest()];
  const original = structuredClone(l.budgets);
  migrateSpending(l);
  expect(budgetAt(l, "2026-08")).toEqual([{ category: "教養", amount: 3000 }]);
  expect(budgetAt(l, "2026-09")).toEqual([]);
  expect(l.budgets).toEqual(original);
  expect(l.requests[0].input.items[0].category).toBe("教養");
  expect(l.requests[0].history[0].input?.items[0].category).toBe("学習");
  const once = structuredClone(l);
  migrateSpending(l);
  expect(l).toEqual(once);
});
it("applies a proposal across its interval and rejects overlapping restored proposals", () => {
  const l = migrateSpending(emptySpendingLedger());
  const p = {
    id: "p",
    name: "test",
    from: "2026-09",
    to: "2027-03",
    at: "2026-09-01",
    reason: "test",
    supersededAt: null,
    categories: [{ category: "教養", amount: 50000 }],
  };
  l.budgetProposals = [p];
  expect(budgetAt(l, "2027-03")[0].amount).toBe(50000);
  expect(budgetAt(l, "2027-04")).toEqual([]);
  l.budgetProposals.push({ ...p, id: "p2", from: "2027-03", to: null });
  expect(spendingLedgerSchema.safeParse(l).success).toBe(false);
});
it("uses MF categories directly without requiring category or payment mapping", () => {
  const l = migrateSpending(emptySpendingLedger()),
    r = syntheticRequest();
  r.input.items[0].category = "教養";
  l.details = [syntheticDetail()];
  const c = calculateSpending(l, r, "2026-09-06")[0];
  expect(c.A).toBe(20000);
  expect(c.missing.some((s) => s.includes("未対応"))).toBe(false);
});
it("detects monthly files and dates without treating the final row as coverage", () => {
  const bytes = Buffer.from(
    MF_COLUMNS.join(",") +
      "\n1,2026/09/02,架空,-100,架空カード,教養,学習,,0,new",
  );
  const p = previewMfMonth(
    bytes,
    "synthetic.csv",
    emptySpendingLedger(),
    "2026-09-06",
  );
  expect(p.month).toBe("2026-09");
  expect(p.to).toBe("2026-09-06");
  expect(p.encoding).toBe("utf-8");
  expect(p.confirmedCoverage).toBe(false);
  expect(() =>
    previewMfMonth(
      Buffer.from(MF_COLUMNS.join(",")),
      "empty.csv",
      emptySpendingLedger(),
      "2026-09-06",
    ),
  ).toThrow("対象月");
  expect(
    previewMfMonth(
      Buffer.from(MF_COLUMNS.join(",")),
      "収入・支出詳細_2026-08-01_2026-08-31.csv",
      emptySpendingLedger(),
      "2026-09-06",
    ).month,
  ).toBe("2026-08");
});
