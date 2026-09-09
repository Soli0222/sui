import {
  spendingInputSchema,
  spendingLedgerSchema,
} from "./spending-validation";
import { describe, expect, it } from "vitest";
import {
  calculateSpending,
  emptySpendingLedger,
  effectiveStatus,
  spendingFacts,
} from "./spending-core";
import { migrateSpending } from "./spending-budget";
import { syntheticRequest, syntheticDetail } from "./spending-fixtures";
import {
  MF_COLUMNS,
  parseCsv,
  previewMfMonth,
  previewMf,
} from "./spending-csv";
const today = "2026-09-06";
function fixture() {
  const l = migrateSpending(emptySpendingLedger()),
    r = syntheticRequest();
  r.input.items[0].category = "教養";
  l.budgetProposals!.push({
    id: "b",
    name: "test",
    from: "2026-06",
    to: null,
    at: today,
    reason: "test",
    supersededAt: null,
    categories: [{ category: "教養", amount: 50000 }],
  });
  l.details.push(syntheticDetail());
  return { l, r };
}
it("MF actuals remain independent of approvals, purchases, legacy allocations and forecasts", () => {
  const { l, r } = fixture();
  const baseline = spendingFacts(l);
  r.status = "approved";
  r.input.kind = "supplemental";
  r.input.items[0].month = "2026-08";
  r.purchases.push({
    id: "p",
    itemId: r.input.items[0].id,
    amount: 20000,
    date: today,
    reason: "legacy",
    reflected: [{ detailId: "detail", amount: 20000 }],
  });
  l.requests.push(r);
  l.plans.push({
    id: "old",
    name: "legacy",
    amount: 90000,
    month: "2026-09",
    category: "教養",
    date: today,
    type: "fixed",
    reason: "legacy",
  });
  expect(spendingFacts(l)).toEqual(baseline);
  const overview = syntheticRequest("overview", 0);
  overview.input.items[0].category = "教養";
  const c = calculateSpending(l, overview, today)[0];
  expect([c.A, c.R, c.F, c.Q, c.remaining]).toEqual([20000, 0, 0, 0, 30000]);
});
it("only an unpurchased current application enters the separate what-if", () => {
  const { l, r } = fixture();
  const other = syntheticRequest("other", 90000);
  other.status = "approved";
  l.requests.push(other);
  let c = calculateSpending(l, r, today)[0];
  expect([c.before, c.Q, c.after, c.remaining]).toEqual([
    20000, 12000, 32000, 18000,
  ]);
  r.purchaseRecord = {
    amount: 12000,
    date: today,
    reason: "bought",
    at: today,
  };
  c = calculateSpending(l, r, today)[0];
  expect([c.A, c.Q, c.remaining]).toEqual([20000, 0, 30000]);
  expect(effectiveStatus(r, today)).toBe("completed");
});
it("MF expense-category refunds reduce actuals while income, transfers and excluded rows do not enter budgets", () => {
  const { l, r } = fixture();
  l.details.push(
    syntheticDetail("refund", 3000),
    { ...syntheticDetail("income", 10000), categorySource: "収入/給与" },
    { ...syntheticDetail("transfer"), transfer: true },
    { ...syntheticDetail("excluded"), included: false },
  );
  expect(calculateSpending(l, r, today)[0].A).toBe(17000);
});
it("history uses the preceding three MF months, including special purchases", () => {
  const { l, r } = fixture();
  for (const m of ["06", "07", "08"])
    l.details.push({
      ...syntheticDetail(m, -10000, `2026-${m}-01`),
      oneOff: true,
    });
  const c = calculateSpending(l, r, today)[0];
  expect(c.history.map((h) => [h.month, h.total])).toEqual([
    ["2026-06", 10000],
    ["2026-07", 10000],
    ["2026-08", 10000],
  ]);
  expect(c.missing.length).toBeGreaterThan(0);
});
it("purchase completion survives approval expiry and old receipt records need no allocation", () => {
  const r = syntheticRequest();
  r.status = "approved";
  r.expiresAt = "2026-09-01";
  expect(effectiveStatus(r, today)).toBe("expired");
  r.purchases.push({
    id: "old",
    itemId: r.input.items[0].id,
    amount: 5000,
    date: today,
    reason: "legacy",
    reflected: [],
  });
  expect(effectiveStatus(r, today)).toBe("completed");
});
it("monthly CSV parsing preserves quoted content, identical purchases and invalid rows", () => {
  const l = emptySpendingLedger();
  const csv =
    MF_COLUMNS.join(",") +
    '\n1,2026/09/01,"架空,店舗",-1000,架空カード,教養,書籍,,0,a\n1,2026/09/01,"架空,店舗",-1000,架空カード,教養,書籍,,0,b\nbroken';
  expect(parseCsv(csv)[1][2]).toBe("架空,店舗");
  const p = previewMfMonth(Buffer.from(csv), "test.csv", l, today);
  expect(p.rows).toHaveLength(3);
  expect(p.errors).toHaveLength(1);
  expect(p.rows[0].detail?.sourceId).not.toBe(p.rows[1].detail?.sourceId);
});

describe("MF CSV synthetic format fixtures", () => {
  it("supports BOM, quoted commas, escaped quotes, embedded newlines and CRLF", () =>
    expect(parseCsv('\uFEFFa,b\r\n"a,b","a""b\nc"\r\n')).toEqual([
      ["a", "b"],
      ["a,b", 'a"b\nc'],
    ]));
  it("reports malformed quotes and does not silently discard empty rows", () => {
    expect(() => parseCsv('a\n"open')).toThrow();
    expect(parseCsv("a\n\n")).toEqual([["a"], [""]]);
  });
  it("A07 uses stable IDs, keeps identical distinct purchases and reports invalid rows", () => {
    const csv =
      MF_COLUMNS.join(",") +
      "\n1,2026/09/01,架空店,-1000,架空カード,教養,学習,,0,new1\n1,2026/09/01,架空店,-1000,架空カード,教養,学習,,0,new2\n1,invalid,架空店,no,架空カード,教養,学習,,0,new3";
    const p = previewMf(
      new TextEncoder().encode(csv),
      "utf-8",
      "synthetic.csv",
      "2026-09-01",
      "2026-09-30",
      emptySpendingLedger(),
    );
    expect(p.rows).toHaveLength(3);
    expect(p.errors).toHaveLength(1);
    expect(p.rows[0].detail?.sourceId).not.toBe(p.rows[1].detail?.sourceId);
  });
  it("A08 rejects an unknown header", () =>
    expect(() =>
      previewMf(
        new TextEncoder().encode("日付,金額\n2026/09/01,1"),
        "utf-8",
        "synthetic.csv",
        "2026-09-01",
        "2026-09-30",
        emptySpendingLedger(),
      ),
    ).toThrow());
});

it("rejects a restored ledger whose partial receipts exceed the purchase actual", () => {
  const l = emptySpendingLedger(),
    r = syntheticRequest("restore", 1000);
  r.purchases.push({
    id: "p",
    itemId: r.input.items[0].id,
    date: today,
    amount: 1000,
    reason: "確認",
    reflected: [],
  });
  l.requests.push(r);
  l.details.push(syntheticDetail("one", -1000), syntheticDetail("two", -1000));
  expect(spendingLedgerSchema.safeParse(l).success).toBe(true);
  l.allocations.push(
    ...["one", "two"].map((id) => ({
      id,
      requestId: r.id,
      purchaseId: "p",
      detailId: id,
      amount: 1000,
      active: true,
      at: today,
      detailVersion: 1,
    })),
  );
  expect(spendingLedgerSchema.safeParse(l).success).toBe(false);
});

it("rejects invalid dates and int32 overflow and converts the isolated foreign purchase to JPY", () => {
  const { l, r } = fixture();
  r.input.items[0].amount = 2147483648;
  expect(spendingInputSchema.safeParse(r.input).success).toBe(false);
  r.input.items[0].amount = 10000;
  r.input.purchaseDate = "2026-02-30";
  expect(spendingInputSchema.safeParse(r.input).success).toBe(false);
  r.input.purchaseDate = today;
  r.input.currency = "USD";
  r.input.rateToJpy = 1.5;
  r.input.rateAt = today;
  expect(calculateSpending(l, r, today)[0].Q).toBe(15000);
});

it("reports the midpoint median when only two historical MF months are complete", () => {
  const { l, r } = fixture();
  l.imports.push({
    id: "coverage",
    filename: "synthetic",
    hash: "synthetic",
    at: today,
    from: "2026-06-01",
    to: "2026-07-31",
    committed: true,
    confirmedCoverage: true,
    rows: [],
    resolutions: {},
    errors: [],
  });
  l.details.push(
    syntheticDetail("june", -1000, "2026-06-01"),
    syntheticDetail("july", -3000, "2026-07-01"),
  );
  const c = calculateSpending(l, r, today)[0];
  expect(c.median).toBe(2000);
  expect(c.missing).toContain("直近3か月のMFデータが不足しています");
});

it.each(["none", "partial", "stale", "unset"])(
  "supplemental treats %s MF coverage as reference, while normal still blocks",
  (coverage) => {
    const l = emptySpendingLedger(), r = syntheticRequest();
    if (coverage !== "none") l.imports.push({
      id: "coverage", filename: "synthetic", hash: "synthetic",
      at: "2026-09-01T00:00:00Z", from: coverage === "partial" ? "2026-08-01" : "2026-06-01",
      to: "2026-09-01", committed: true, confirmedCoverage: true,
      rows: [], resolutions: {}, errors: [],
    });
    l.settings.freshnessDays = coverage === "unset" ? null : 3;
    r.input.kind = "supplemental";
    const c = calculateSpending(l, r, today)[0];
    expect(c).toMatchObject({ budget: null, Q: 0, missing: [] });
    expect(c.history).toHaveLength(3);
    if (coverage === "none") expect(c.history.every(h => !h.covered)).toBe(true);
    if (coverage === "partial") expect(c.history.map(h => h.covered)).toEqual([false, false, true]);
    r.input.kind = "normal";
    const normal = calculateSpending(l, r, today)[0];
    expect(normal.missing).toContain("対象月・カテゴリの通常予算が未登録です");
    expect(normal.missing).toContain("当月のMFデータを更新してください");
    if (["none", "partial"].includes(coverage)) expect(normal.missing).toContain("直近3か月のMFデータが不足しています");
  },
);
it("supplemental keeps over-budget MF actuals and never adds its purchase amount", () => {
  const { l, r } = fixture();
  l.details.push(syntheticDetail("supplemental-purchase", -40000));
  r.input.kind = "supplemental";
  l.requests.push(r);
  expect(calculateSpending(l, r, today)[0]).toMatchObject({
    budget: 50000, A: 60000, Q: 0, remaining: -10000, missing: [],
  });
});
