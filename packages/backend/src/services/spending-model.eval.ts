/** Opt-in external model evaluation; only synthetic data, never the application DB. */
import { expect, it } from "vitest";
import { requestSpendingDecision } from "./spending-ai";
import { spendingReviewSystem } from "./spending-review-policy";
import { spendingEvaluationSchema } from "./spending-validation";
import { spendingEvidence } from "./spending-evidence";
import { emptySpendingLedger, calculateSpending } from "./spending-core";
import { syntheticDetail, syntheticRequest } from "./spending-fixtures";

const endpoint = process.env.SUI_SPENDING_EVAL_ENDPOINT;
const model = process.env.SUI_SPENDING_EVAL_MODEL;
const credential = process.env.SUI_SPENDING_EVAL_API_KEY;
if (!endpoint || !model || !credential)
  throw new Error(
    "SUI_SPENDING_EVAL_ENDPOINT / SUI_SPENDING_EVAL_MODEL / SUI_SPENDING_EVAL_API_KEY を設定してください。架空データのみを外部AIへ送信します。",
  );

const cases = [
  {
    name: "補正：旅行が続き内訳不明なら確認する",
    kind: "supplemental",
    answered: false,
    expected: ["held", "conditional"],
    question: true,
  },
  {
    name: "通常：予算内でも旅行が続き内訳不明なら確認する",
    kind: "normal",
    answered: false,
    expected: ["held", "conditional"],
    question: true,
  },
  {
    name: "補正：回答後は同じ内訳を再質問しない",
    kind: "supplemental",
    answered: true,
    expected: ["approvable", "conditional", "denied"],
    question: false,
  },
] as const;
for (const c of cases)
  it(c.name, async () => {
    const l = emptySpendingLedger(),
      r = syntheticRequest("synthetic-trip", 60000);
    const today = "2026-09-09";
    const purchaseMonth = c.kind === "normal" ? "2026-09" : "2026-10";
    r.input = {
      ...r.input,
      name: "架空の記念旅行",
      kind: c.kind,
      purchaseDate: `${purchaseMonth}-10`,
      reason: "期間限定の架空展示を見たい",
      subcategory: "旅行",
    };
    r.input.items[0] = {
      ...r.input.items[0],
      amount: 60000,
      category: "特別な支出",
      month: purchaseMonth,
    };
    r.input.funding =
      c.kind === "supplemental"
        ? {
            sourceId: "synthetic-source",
            destinationId: "synthetic-destination",
            amount: 60000,
            date: "2026-10-01",
          }
        : null;
    l.requests.push(r);
    for (const [n, date] of ["2026-07-11", "2026-08-15"].entries()) {
      const d = syntheticDetail(
        `synthetic-trip-${n}`,
        -90000 - n * 10000,
        date,
      );
      d.raw = { 大項目: "特別な支出", 中項目: "旅行", メモ: "架空の観光旅行" };
      l.details.push(d);
    }
    l.budgets.push({
      id: "budget",
      month: purchaseMonth,
      category: "特別な支出",
      amount: 100000,
      at: today,
      reason: "架空予算",
    });
    l.imports.push({
      id: "import",
      hash: "synthetic",
      filename: "synthetic.csv",
      from: "2026-06-01",
      to: today,
      at: today,
      committed: true,
      confirmedCoverage: true,
      rows: [],
      resolutions: {},
      errors: [],
    });
    if (c.answered)
      r.answers = [
        {
          reviewId: "prior",
          requestVersion: 1,
          question: "最近の旅行も踏まえ、今回の内訳と減額案を教えてください",
          answer:
            "以前は家族旅行、今回は一人で展示を見る目的です。交通費35000円、宿泊15000円、入場食事10000円です。日帰りは始発でも開場に間に合わず、1泊に絞りました。今後半年は旅行を控え、ほかの予定支出はありません。",
          at: today,
        },
      ];
    const context = spendingEvidence(l, r, today);
    const raw = await requestSpendingDecision(
      {
        endpoint: endpoint!,
        model: model!,
        credentialEnv: "SUI_SPENDING_EVAL_API_KEY",
        protocol:
          process.env.SUI_SPENDING_EVAL_PROTOCOL === "anthropic"
            ? "anthropic"
            : "chat-completions",
      },
      credential!,
      spendingReviewSystem,
      JSON.stringify({
        settings: l.settings,
        input: {
          ...r.input,
          funding: r.input.funding
            ? { amount: 60000, date: "2026-10-01" }
            : null,
        },
        calculations: calculateSpending(l, r, today),
        context,
        limits: [],
        funding: {
          available: 180000,
          held: 0,
          currencyCode: "JPY",
          issues: [],
        },
      }),
    );
    const result = spendingEvaluationSchema.parse(JSON.parse(raw));
    expect(c.expected).toContain(result.decision);
    expect(
      result.assessment.evidenceIds.some((id) =>
        context.monthly.some((g) => g.id === id),
      ),
    ).toBe(true);
    expect(result.assessment.concentration).toMatch(/旅行|集中|頻度|連続|累積/);
    if (c.question) expect(result.question).toBeTruthy();
    else expect(result.question).toBeNull();
  });
