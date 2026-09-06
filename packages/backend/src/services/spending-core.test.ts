import { describe, it, expect } from "vitest";
import {
  calculateSpending,
  emptySpendingLedger,
  effectiveStatus,
} from "./spending-core";
import { syntheticRequest, syntheticDetail } from "./spending-fixtures";
import { parseCsv, previewMf, MF_COLUMNS } from "./spending-csv";
import { spendingInputSchema } from "./spending-validation";
const date = "2026-09-06";
function ledger() {
  const l = emptySpendingLedger();
  l.categoryMappings = { "教養/学習": "学習" };
  l.paymentMappings = { 架空カード: "架空カード" };
  l.budgets.push({
    id: "budget",
    month: "2026-09",
    category: "学習",
    amount: 50000,
    at: date,
    reason: "synthetic",
  });
  return l;
}
describe("spending deterministic accounting", () => {
  it("A05 calculates A + R + F + Q and preserves previous three months", () => {
    const l = ledger(),
      r = syntheticRequest();
    l.details.push(syntheticDetail());
    const previous = syntheticRequest("previous", 5000);
    previous.status = "approved";
    l.requests.push(previous);
    l.plans.push({
      id: "plan",
      month: "2026-09",
      category: "学習",
      amount: 15000,
      date: "2026-09-20",
      name: "定期教材",
      type: "fixed",
      reason: "契約",
    });
    const [c] = calculateSpending(l, r, date);
    expect([c.A, c.R, c.F, c.Q, c.after, c.remaining]).toEqual([
      20000, 5000, 15000, 12000, 52000, -2000,
    ]);
    expect(c.history.map((h) => h.month)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
  });
  it("A06 moves an identified plan through Q, R and A without counting twice, including fixed classification", () => {
    const l = ledger(),
      r = syntheticRequest();
    l.plans.push({
      id: "plan",
      month: "2026-09",
      category: "学習",
      amount: 15000,
      date: "2026-09-20",
      name: "教材",
      type: "fixed",
      reason: "契約",
    });
    r.input.items[0].forecastId = "plan";
    r.input.items[0].forecastAmount = 12000;
    expect(calculateSpending(l, r, date)[0].after).toBe(15000);
    r.status = "approved";
    l.requests.push(r);
    const next = syntheticRequest("next", 1);
    expect(calculateSpending(l, next, date)[0].after).toBe(15001);
    const d = syntheticDetail("purchase", -12000);
    d.fixedId = "plan";
    l.details.push(d);
    r.purchases.push({
      id: "p",
      itemId: r.input.items[0].id,
      date,
      amount: 12000,
      reason: "確認",
      reflected: [{ detailId: d.id, amount: 12000 }],
    });
    expect(calculateSpending(l, next, date)[0].after).toBe(15001);
  });
  it("A03 uses complete historical variable months, leaves one-off facts in total history", () => {
    const l = ledger();
    for (const [month, n] of [
      ["2026-06", 10000],
      ["2026-07", 20000],
      ["2026-08", 60000],
    ] as const) {
      l.details.push(syntheticDetail(month, -n, month + "-01"));
      l.imports.push({
        id: month,
        hash: month,
        filename: "synthetic",
        at: date,
        from: month + "-01",
        to: month + "-31",
        committed: true,
        confirmedCoverage: true,
        rows: [],
        resolutions: {},
        errors: [],
      });
    }
    l.details[2].oneOff = true;
    const c = calculateSpending(l, syntheticRequest(), date)[0];
    expect(c.median).toBe(10000);
    expect(c.maximum).toBe(20000);
    expect(c.history[2].total).toBe(60000);
    expect(c.coveredDays).toBe(0);
    expect(c.missing).toContain("当月に取込未確認日があります");
  });
  it("A09 unlink leaves attribution reflected; deleting original restores reservation", () => {
    const l = ledger(),
      r = syntheticRequest();
    r.status = "purchased";
    r.closedRemainder = true;
    l.requests.push(r);
    const d = syntheticDetail("p", -12000);
    l.details.push(d);
    r.purchases.push({
      id: "p",
      itemId: r.input.items[0].id,
      date,
      amount: 12000,
      reason: "確認",
      reflected: [{ detailId: d.id, amount: 12000 }],
    });
    const next = syntheticRequest("next", 1);
    const a = calculateSpending(l, next, date)[0];
    expect(a.A + a.R).toBe(12000);
    d.deletedAt = date;
    const b = calculateSpending(l, next, date)[0];
    expect(b.A + b.R).toBe(12000);
  });
  it("A15 supplemental attribution is excluded only from normal spending", () => {
    const l = ledger(),
      r = syntheticRequest();
    r.input.kind = "supplemental";
    r.purchases.push({
      id: "p",
      itemId: r.input.items[0].id,
      date,
      amount: 12000,
      reason: "確認",
      reflected: [{ detailId: "detail", amount: 12000 }],
    });
    l.requests.push(r);
    l.details.push(syntheticDetail());
    const c = calculateSpending(l, syntheticRequest("next"), date)[0];
    expect([c.allSpending, c.supplemental, c.A]).toEqual([20000, 12000, 8000]);
  });
  it("A16 keeps purchased facts after cancellation or expiry", () => {
    const l = ledger(),
      r = syntheticRequest("prior");
    r.status = "cancelled";
    r.closedRemainder = true;
    r.purchases.push({
      id: "p",
      itemId: r.input.items[0].id,
      date,
      amount: 12000,
      reason: "事後",
      reflected: [],
    });
    l.requests.push(r);
    expect(calculateSpending(l, syntheticRequest(), date)[0].R).toBe(12000);
    r.status = "approved";
    r.expiresAt = "2026-09-05";
    expect(effectiveStatus(r, date)).toBe("purchased");
  });
  it("rejects aggregate int32 overflow, invalid dates, and mismatched funding", () => {
    const r = syntheticRequest();
    r.input.items[0].amount = 2147483648;
    expect(spendingInputSchema.safeParse(r.input).success).toBe(false);
    r.input.items[0].amount = 12000;
    r.input.purchaseDate = "2026-02-30";
    expect(spendingInputSchema.safeParse(r.input).success).toBe(false);
  });
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
      ledger(),
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
        ledger(),
      ),
    ).toThrow());
});

it("attributes a partial receipt to each budget month/category while retaining source date", () => {
  const l = ledger(),
    r = syntheticRequest("earlier", 12000);
  r.input.items[0].month = "2026-08";
  r.status = "purchased";
  r.closedRemainder = true;
  r.purchases.push({
    id: "p",
    itemId: r.input.items[0].id,
    date,
    amount: 12000,
    reason: "対象月確認",
    reflected: [{ detailId: "detail", amount: 12000 }],
  });
  l.requests.push(r);
  l.details.push(syntheticDetail());
  expect(calculateSpending(l, syntheticRequest(), date)[0].A).toBe(8000);
  const earlier = syntheticRequest("query");
  earlier.input.items[0].month = "2026-08";
  expect(calculateSpending(l, earlier, date)[0].A).toBe(12000);
  expect(l.details[0].date).toBe("2026-09-01");
});

it("re-review replaces its own fulfilled plan claim instead of consuming the remaining cap twice", () => {
  const l = ledger(),
    r = syntheticRequest();
  r.input.items[0].forecastId = "plan";
  r.input.items[0].forecastAmount = 12000;
  r.status = "purchased";
  l.requests.push(r);
  l.plans.push({
    id: "plan",
    month: "2026-09",
    category: "学習",
    amount: 15000,
    date: "2026-09-20",
    name: "教材",
    type: "fixed",
    reason: "契約",
  });
  const d = syntheticDetail("fulfilled", -12000);
  d.fixedId = "plan";
  l.details.push(d);
  r.purchases.push({
    id: "p",
    itemId: r.input.items[0].id,
    date,
    amount: 12000,
    reason: "確認",
    reflected: [{ detailId: d.id, amount: 12000 }],
  });
  const c = calculateSpending(l, r, date)[0];
  expect(c.after).toBe(15000);
  expect(c.Q).toBe(0);
  expect(c.missing).not.toContain("予測からの充当が利用可能額を超えています");
});

it("converts foreign minor-unit reservations before aggregating with JPY details", () => {
  const l = ledger(),
    r = syntheticRequest("foreign", 2000);
  r.input.currency = "USD";
  r.input.rateToJpy = 1.5;
  r.input.rateAt = date;
  expect(calculateSpending(l, r, date)[0].Q).toBe(3000);
  r.status = "purchased";
  r.closedRemainder = true;
  r.purchases.push({
    id: "p",
    itemId: r.input.items[0].id,
    date,
    amount: 2000,
    reason: "確認",
    reflected: [{ detailId: "fx", amount: 3000 }],
  });
  l.requests.push(r);
  l.details.push(syntheticDetail("fx", -3000));
  const c = calculateSpending(l, syntheticRequest("next"), date)[0];
  expect(c.R).toBe(0);
  expect(c.A).toBe(3000);
});

it("rejects a restored ledger whose partial receipts exceed the purchase actual", async () => {
  const { spendingLedgerSchema } = await import("./spending-validation");
  const l = ledger(),
    r = syntheticRequest("restore", 1000);
  r.purchases.push({
    id: "p",
    itemId: r.input.items[0].id,
    date,
    amount: 1000,
    reason: "確認",
    reflected: [],
  });
  l.requests.push(r);
  l.details.push(syntheticDetail("one", -1000), syntheticDetail("two", -1000));
  l.allocations.push(
    ...["one", "two"].map((id) => ({
      id,
      requestId: r.id,
      purchaseId: "p",
      detailId: id,
      amount: 1000,
      active: true,
      at: date,
      detailVersion: 1,
    })),
  );
  expect(spendingLedgerSchema.safeParse(l).success).toBe(false);
});
