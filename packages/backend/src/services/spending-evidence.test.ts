import { describe, expect, it } from "vitest";
import { addCalendarMonths, toJstDateString } from "@sui/shared";
import { emptySpendingLedger } from "./spending-core";
import { syntheticDetail, syntheticRequest } from "./spending-fixtures";
import { spendingEvidence, spendingLimits } from "./spending-evidence";
import {
  spendingEvaluationSchema,
  spendingLedgerSchema,
  spendingSettingsSchema,
} from "./spending-validation";

const today = "2026-09-09";
function scenario() {
  const l = emptySpendingLedger(),
    current = syntheticRequest("current", 100000);
  current.input.kind = "supplemental";
  current.input.items[0].category = "特別な支出";
  current.input.subcategory = "旅行";
  l.requests.push(current);
  l.settings.supplementalLimits = [
    {
      id: "travel",
      category: "特別な支出",
      subcategory: "旅行",
      months: 3,
      amount: 200000,
      action: "explain",
    },
  ];
  return { l, current };
}

describe("spending evidence for normal and supplemental reviews", () => {
  it.each(["normal", "supplemental"] as const)(
    "%s retains travel summaries beyond the 500 row limit and prioritizes relevant details",
    (kind) => {
      const { l, current } = scenario();
      current.input.kind = kind;
      const travel = syntheticDetail("travel", -80000, "2026-07-15");
      travel.raw = {
        大項目: "特別な支出",
        中項目: "旅行",
        メモ: "架空の家族旅行",
      };
      l.details = [
        travel,
        ...Array.from({ length: 600 }, (_, n) => ({
          ...syntheticDetail(`food${n}`, -100, today),
          raw: { 大項目: "食費", 中項目: "食料品" },
        })),
      ];
      const e = spendingEvidence(l, current, today);
      expect(e.details[0]).toMatchObject({
        id: "travel",
        subcategory: "旅行",
        memo: "架空の家族旅行",
      });
      expect(e.details).toHaveLength(500);
      expect(e.omittedDetails).toBe(101);
      expect(e.monthly.find((g) => g.subcategory === "旅行")?.total).toBe(
        80000,
      );
      expect(e.monthly.find((g) => g.category === "食費")?.total).toBe(60000);
      expect(e.coverage.every((c) => c.coveredDays === 0)).toBe(true);
      current.input.purchaseDate = "2027-06-01";
      expect(spendingEvidence(l, current, today).monthly).toEqual(e.monthly);
    },
  );
  it("excludes transfers, deleted and excluded rows from aggregates, includes refunds, and retains flags", () => {
    const { l, current } = scenario();
    const base = syntheticDetail("expense", -10000, today);
    base.raw = { 大項目: "特別な支出", 中項目: "旅行" };
    l.details = [
      base,
      { ...base, id: "refund", amount: 2000 },
      { ...base, id: "transfer", transfer: true },
      { ...base, id: "excluded", included: false },
      { ...base, id: "deleted", deletedAt: today },
      { ...base, id: "income", raw: { 大項目: "収入" } },
    ];
    const e = spendingEvidence(l, current, today);
    expect(e.monthly[0]).toMatchObject({ total: 8000, count: 2 });
    expect(e.details.find((d) => d.id === "transfer")?.transfer).toBe(true);
    expect(e.details.some((d) => d.id === "deleted")).toBe(false);
  });
});

describe("rolling supplemental allowances", () => {
  it("clamps calendar months across leap years", () => {
    expect(toJstDateString("2026-09-09T16:00:00Z")).toBe("2026-09-10");
    expect(addCalendarMonths("2024-05-31", -3)).toBe("2024-02-29");
    expect(addCalendarMonths("2025-05-31", -3)).toBe("2025-02-28");
  });
  it("counts each request once, even with many reviews; does not add MF spending", () => {
    const { l, current } = scenario();
    const prior = structuredClone(current);
    prior.id = "prior";
    prior.status = "approved";
    prior.allowanceUse = {
      at: "2026-07-01",
      amountJpy: 120000,
      category: "特別な支出",
      subcategory: "旅行",
    };
    l.requests.push(prior);
    l.details.push(syntheticDetail("mf", -120000));
    const result = spendingLimits(l, current, today, new Map())[0];
    expect(result).toMatchObject({
      used: 120000,
      requested: 100000,
      total: 220000,
      exceeded: true,
      requestIds: ["prior"],
    });
    current.status = "approved";
    current.allowanceUse = { ...prior.allowanceUse, amountJpy: 100000 };
    expect(spendingLimits(l, current, today, new Map())[0]).toEqual(result);
  });
  it.each(["cancelled", "expired", "draft", "held"] as const)(
    "releases unused %s but preserves purchased or transferred usage",
    (status) => {
      const { l, current } = scenario();
      const prior = structuredClone(current);
      prior.id = "prior";
      prior.status = status;
      prior.allowanceUse = {
        at: "2026-08-01",
        amountJpy: 130000,
        category: "特別な支出",
        subcategory: "旅行",
      };
      l.requests.push(prior);
      expect(spendingLimits(l, current, today, new Map())[0].used).toBe(0);
      expect(
        spendingLimits(l, current, today, new Map([[prior.id, 140000]]))[0]
          .used,
      ).toBe(140000);
      prior.purchaseRecord = {
        amount: 130000,
        date: today,
        at: today,
        reason: "架空",
      };
      expect(spendingLimits(l, current, today, new Map())[0].used).toBe(130000);
    },
  );
  it("includes pending approvals outside the window, excludes old spent usage, and applies scope", () => {
    const { l, current } = scenario();
    const prior = structuredClone(current);
    prior.id = "prior";
    prior.status = "approved";
    prior.allowanceUse = {
      at: "2025-01-01",
      amountJpy: 150000,
      category: "特別な支出",
      subcategory: "旅行",
    };
    l.requests.push(prior);
    expect(spendingLimits(l, current, today, new Map())[0].used).toBe(150000);
    // Completed transfers are historical usage, not pending commitments.
    prior.status = "completed";
    expect(
      spendingLimits(l, current, today, new Map([[prior.id, 150000]]))[0].used,
    ).toBe(0);
    prior.allowanceUse.at = "2026-06-09";
    expect(
      spendingLimits(l, current, today, new Map([[prior.id, 150000]]))[0].used,
    ).toBe(150000);
    prior.allowanceUse.subcategory = "家具";
    expect(
      spendingLimits(l, current, today, new Map([[prior.id, 150000]]))[0].used,
    ).toBe(0);
  });
  it("converts foreign requests to JPY and leaves normal requests outside allowances", () => {
    const { l, current } = scenario();
    current.input.currency = "USD";
    current.input.rateToJpy = 1.5;
    expect(spendingLimits(l, current, today, new Map())[0].requested).toBe(
      150000,
    );
    current.input.kind = "normal";
    expect(spendingLimits(l, current, today, new Map())).toEqual([]);
  });
});

it("requires all assessment axes and refuses approval with an unanswered question", () => {
  const result = {
    decision: "approvable",
    reasons: ["資金が足りる"],
    options: [],
    missing: [],
    question: null,
    assessment: {
      evidenceIds: [],
      concentration: "履歴不足",
      purpose: "期限あり",
      amount: "内訳あり",
      conclusion: "費用と目的を確認",
    },
  };
  expect(spendingEvaluationSchema.safeParse(result).success).toBe(true);
  expect(
    spendingEvaluationSchema.safeParse({ ...result, assessment: undefined })
      .success,
  ).toBe(false);
  expect(
    spendingEvaluationSchema.safeParse({ ...result, question: "内訳は？" })
      .success,
  ).toBe(false);
  expect(
    spendingEvaluationSchema.safeParse({ ...result, missing: ["必須情報"] })
      .success,
  ).toBe(false);
  expect(
    spendingEvaluationSchema.safeParse({
      ...result,
      decision: "held",
      question: "内訳は？",
    }).success,
  ).toBe(true);
});
it("validates rule scopes and keeps old exports compatible", () => {
  const { l } = scenario();
  expect(spendingSettingsSchema.safeParse(l.settings).success).toBe(true);
  l.settings.supplementalLimits![0].category = null;
  expect(spendingSettingsSchema.safeParse(l.settings).success).toBe(false);
  expect(spendingLedgerSchema.safeParse(emptySpendingLedger()).success).toBe(
    true,
  );
});
