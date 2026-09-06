import { z } from "zod";
import { isDateString } from "../lib/dates";
const money = z.number().int().min(0).max(2147483647);
const positive = money.min(1);
const text = z.string().trim().min(1).max(2000);
export const spendingDate = z
  .string()
  .refine(isDateString, "YYYY-MM-DD の実在する日付を入力してください");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const id = z.string().min(1).max(200);
export const spendingSettingsSchema = z
  .object({
    threshold: money.nullable(),
    freshnessDays: z.number().int().min(0).max(366).nullable(),
    approvalDays: z.number().int().min(1).max(366).nullable(),
    fundingDays: z.number().int().min(1).max(3660).nullable(),
    ai: z
      .object({
        endpoint: z
          .string()
          .url()
          .refine((s) => ["https:", "http:"].includes(new URL(s).protocol)),
        model: text,
        credentialEnv: z.string().regex(/^SUI_SPENDING_AI_[A-Z0-9_]+$/),
        provider: z.enum(["openai", "anthropic", "custom"]).optional(),
        credentialMode: z.enum(["environment", "stored"]).optional(),
        modelsEndpoint: z.string().url().optional(),
        protocol: z.enum(["chat-completions", "anthropic"]),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const spendingInputSchema = z
  .object({
    name: text,
    reason: text,
    purchaseDate: spendingDate,
    payment: text,
    kind: z.enum(["normal", "supplemental"]),
    currency: z.string().regex(/^[A-Z]{3}$/),
    rateToJpy: z.number().finite().positive().nullable(),
    rateAt: spendingDate.nullable(),
    urgency: z.string().max(2000),
    replacement: z.string().max(2000),
    alternatives: z.string().max(2000),
    relatedIds: z.array(id).max(100),
    items: z
      .array(
        z
          .object({
            id,
            name: text,
            amount: positive,
            category: text,
            month,
            forecastId: id.nullable(),
            forecastAmount: money,
          })
          .strict(),
      )
      .min(1)
      .max(100),
    funding: z
      .object({
        sourceId: z.string().uuid(),
        destinationId: z.string().uuid(),
        date: spendingDate,
        amount: positive,
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (new Set(v.items.map((i) => i.id)).size !== v.items.length)
      ctx.addIssue({ code: "custom", message: "内訳IDが重複しています" });
    if (v.items.reduce((a, i) => a + i.amount, 0) > 2147483647)
      ctx.addIssue({
        code: "custom",
        message: "申請合計がint32を超えています",
      });
    if (v.items.some((i) => i.forecastAmount > i.amount))
      ctx.addIssue({ code: "custom", message: "充当額が購入額を超えています" });
    if ((v.kind === "supplemental") !== Boolean(v.funding))
      ctx.addIssue({
        code: "custom",
        message: "補正予算のみ振替情報が必須です",
      });
    if (
      v.funding &&
      (v.funding.sourceId === v.funding.destinationId ||
        v.funding.amount !== v.items.reduce((a, i) => a + i.amount, 0))
    )
      ctx.addIssue({
        code: "custom",
        message: "振替元先は異なる口座、振替額は購入全額を指定してください",
      });
    const converted = Math.round(
      v.items.reduce((sum, item) => sum + item.amount, 0) * (v.rateToJpy ?? 1),
    );
    if (!Number.isSafeInteger(converted) || converted > 2147483647)
      ctx.addIssue({
        code: "custom",
        message: "JPY換算後の申請合計がint32を超えています",
      });
    if (v.currency === "JPY" && v.rateToJpy !== 1)
      ctx.addIssue({ code: "custom", message: "JPYの換算率は1です" });
  });
export const spendingApplicationSchema = z
  .object({
    name: text,
    amount: positive,
    category: text,
    reason: text,
    purchaseDate: spendingDate,
    payment: text,
    kind: z.enum(["normal", "supplemental"]),
    currency: z.string().regex(/^[A-Z]{3}$/),
    rateToJpy: z.number().finite().positive().nullable(),
    rateAt: spendingDate.nullable(),
    urgency: z.string().max(2000),
    replacement: z.string().max(2000),
    alternatives: z.string().max(2000),
    relatedIds: z.array(id).max(100),
    funding: z
      .object({
        sourceId: z.string().uuid(),
        destinationId: z.string().uuid(),
        date: spendingDate,
        amount: positive,
      })
      .strict()
      .nullable(),
  })
  .strict();
const purchaseRecordSchema = z.object({
  amount: positive,
  date: spendingDate,
  reason: text,
  at: z.string(),
});
const budgetProposalBase = z.object({
  id,
  name: text,
  from: month,
  to: month.nullable(),
  categories: z
    .array(z.object({ category: text, amount: money }))
    .min(1)
    .max(100),
  at: z.string(),
  reason: text,
  supersededAt: z.string().nullable(),
});
const validateProposal = (
  v: z.infer<typeof budgetProposalBase>,
  ctx: z.RefinementCtx,
) => {
  if (
    (v.to && v.to < v.from) ||
    new Set(v.categories.map((c) => c.category)).size !== v.categories.length ||
    v.categories.reduce((n, c) => n + c.amount, 0) > 2147483647
  )
    ctx.addIssue({
      code: "custom",
      message: "予算の適用期間・カテゴリ重複・合計金額を確認してください",
    });
};
export const budgetProposalSchema =
  budgetProposalBase.superRefine(validateProposal);
export const spendingCommandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("budget-proposal"),
    proposal: budgetProposalBase
      .omit({ id: true, at: true, supersededAt: true })
      .superRefine((v, ctx) =>
        validateProposal({ ...v, id: "new", at: "", supersededAt: null }, ctx),
      ),
    replaceId: id.optional(),
  }),
  z.object({
    action: z.literal("payment-link"),
    source: text,
    target: z
      .object({ kind: z.enum(["account", "card"]), id: z.string().uuid() })
      .nullable(),
  }),
  z.object({ action: z.literal("settings"), settings: spendingSettingsSchema }),
  z.object({
    action: z.literal("budget"),
    month,
    category: text,
    amount: money,
    reason: text,
  }),
  z.object({
    action: z.literal("copy-budget"),
    from: month,
    to: month,
    reason: text,
  }),
  z.object({
    action: z.literal("mapping"),
    kind: z.enum(["category", "payment"]),
    source: text,
    target: text,
  }),
  z.object({
    action: z.literal("request"),
    id: id.optional(),
    input: spendingApplicationSchema,
  }),
  z.object({ action: z.literal("cancel"), id, reason: text }),
  z.object({ action: z.literal("delete"), id, reason: text }),
  z.object({
    action: z.literal("purchase"),
    id,
    amount: positive,
    date: spendingDate,
    reason: text,
  }),
  z.object({ action: z.literal("delete-detail"), detailId: id, reason: text }),
  z.object({
    action: z.literal("import-confirm"),
    id,
    resolutions: z.record(z.string(), z.string()),
    confirmedCoverage: z.boolean(),
    acceptErrors: z.boolean(),
  }),
  z.object({
    action: z.literal("return-funds"),
    id,
    linkId: id,
    amount: positive,
    date: spendingDate,
    reason: text,
  }),
]);
export type SpendingCommand = z.infer<typeof spendingCommandSchema>;
export const spendingDecisionSchema = z
  .object({
    decision: z.enum(["approvable", "conditional", "held", "denied"]),
    reasons: z.array(text.max(160)).min(1).max(2),
    options: z.array(text.max(120)).max(1),
    missing: z.array(text.max(120)).max(1),
  })
  .strict();

const detailSchema = z.object({
  id,
  sourceId: id.nullable(),
  raw: z.record(z.string(), z.string()),
  date: spendingDate,
  description: z.string(),
  amount: z.number().int().min(-2147483647).max(2147483647),
  categorySource: z.string(),
  paymentSource: z.string(),
  included: z.boolean(),
  transfer: z.boolean(),
  version: positive,
  deletedAt: z.string().nullable(),
  oneOff: z.boolean(),
  classificationReason: z.string(),
  fixedId: id.nullable(),
  refundOf: id.nullable(),
});
const importSchema = z.object({
  id,
  hash: z.string(),
  filename: z.string(),
  at: z.string(),
  from: spendingDate,
  to: spendingDate,
  confirmedCoverage: z.boolean(),
  month: month.optional(),
  encoding: z.enum(["utf-8", "shift_jis"]).optional(),
  removedIds: z.array(id).optional(),
  ledgerVersion: money.optional(),
  supersededAt: z.string().optional(),
  committed: z.boolean(),
  rows: z.array(
    z.object({
      line: positive,
      detail: detailSchema.nullable(),
      error: z.string().nullable(),
      candidates: z.array(id),
      existingId: id.nullable(),
    }),
  ),
  resolutions: z.record(z.string(), z.string()),
  errors: z.array(z.string()),
});
const fundingSchema = z.object({
  accountId: id,
  balance: z.number(),
  balanceOffset: z.number(),
  held: z.number(),
  available: z.number(),
  through: spendingDate,
  events: z.array(z.object({ id, amount: z.number(), date: spendingDate })),
  issues: z.array(z.string()),
});
const calculationSchema = z.object({
  month,
  category: z.string(),
  budget: money.nullable(),
  A: z.number(),
  R: z.number(),
  F: z.number(),
  Q: z.number(),
  before: z.number(),
  after: z.number(),
  remaining: z.number().nullable(),
  allSpending: z.number(),
  supplemental: z.number(),
  history: z.array(
    z.object({
      month,
      total: z.number(),
      variable: z.number(),
      covered: z.boolean(),
    }),
  ),
  median: z.number(),
  average: z.number(),
  maximum: z.number(),
  currentPace: z.number(),
  coveredDays: z.number(),
  forecastAvailable: z.array(z.object({ id, amount: z.number() })),
  missing: z.array(z.string()),
});
export const spendingLedgerSchema = z
  .object({
    schemaVersion: z.literal(1),
    mfNative: z.boolean().optional(),
    ruleDefaultsApplied: z.boolean().optional(),
    budgetProposals: z.array(budgetProposalSchema).optional(),
    paymentLinks: z
      .record(
        z.string(),
        z.object({ kind: z.enum(["account", "card"]), id: z.string().uuid() }),
      )
      .optional(),
    settings: spendingSettingsSchema,
    requests: z.array(
      z.object({
        purchaseRecord: purchaseRecordSchema.optional(),
        id,
        version: positive,
        input: spendingInputSchema,
        status: z.enum([
          "draft",
          "reviewing",
          "conditional",
          "held",
          "denied",
          "approved",
          "purchased",
          "completed",
          "cancelled",
          "expired",
        ]),
        approvedAmount: money,
        expiresAt: spendingDate.nullable(),
        purchases: z.array(
          z.object({
            id,
            itemId: id,
            date: spendingDate,
            amount: positive,
            reason: z.string(),
            reflected: z.array(z.object({ detailId: id, amount: positive })),
          }),
        ),
        closedRemainder: z.boolean(),
        deletedAt: z.string().nullable(),
        createdAt: z.string(),
        fundingLinks: z.array(
          z.object({
            id,
            recurringId: z.string().uuid(),
            eventId: id,
            expected: spendingInputSchema.shape.funding.unwrap(),
            returnOf: id.nullable(),
          }),
        ),
        history: z.array(
          z.object({
            at: z.string(),
            action: z.string(),
            reason: z.string(),
            input: spendingInputSchema.optional(),
            purchaseRecord: purchaseRecordSchema.optional(),
          }),
        ),
      }),
    ),
    details: z.array(detailSchema),
    allocations: z.array(
      z.object({
        id,
        requestId: id,
        purchaseId: id,
        detailId: id,
        amount: positive,
        active: z.boolean(),
        at: z.string(),
        detailVersion: positive,
      }),
    ),
    budgets: z.array(
      z.object({
        id,
        month,
        category: text,
        amount: money,
        at: z.string(),
        reason: text,
      }),
    ),
    plans: z.array(
      z.object({
        id,
        month,
        category: text,
        name: text,
        amount: money,
        date: spendingDate,
        type: z.enum(["fixed", "variable"]),
        reason: text,
      }),
    ),
    imports: z.array(importSchema),
    reviews: z.array(
      z.object({
        id,
        requestId: id,
        requestVersion: positive,
        ledgerVersion: money,
        at: z.string(),
        snapshot: z.object({
          input: spendingInputSchema,
          settings: spendingSettingsSchema,
          calculations: z.array(calculationSchema),
          detailIds: z.array(id),
          funding: fundingSchema.nullable(),
          fingerprint: z.string(),
          context: z.unknown(),
        }),
        model: z.string().nullable(),
        decision: spendingDecisionSchema.shape.decision,
        reasons: z.array(z.string()),
        options: z.array(z.string()),
        missing: z.array(z.string()),
        overrideReason: z.string().nullable(),
      }),
    ),
    categoryMappings: z.record(z.string(), z.string()),
    paymentMappings: z.record(z.string(), z.string()),
  })
  .superRefine((l, ctx) => {
    const active = (l.budgetProposals ?? []).filter((p) => !p.supersededAt);
    for (const [i, p] of active.entries())
      if (
        active
          .slice(i + 1)
          .some(
            (q) =>
              p.from <= (q.to ?? "9999-12") && q.from <= (p.to ?? "9999-12"),
          )
      )
        ctx.addIssue({
          code: "custom",
          message: "予算案の適用期間が重複しています",
        });
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    for (const rows of [
      l.requests,
      l.details,
      l.allocations,
      l.budgets,
      l.plans,
      l.imports,
      l.reviews,
    ])
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        issue("台帳IDが重複しています");
    const sources = l.details.filter((d) => d.sourceId).map((d) => d.sourceId);
    if (new Set(sources).size !== sources.length)
      issue("MF明細IDが重複しています");
    const purchases = l.requests.flatMap((r) => r.purchases);
    if (new Set(purchases.map((p) => p.id)).size !== purchases.length)
      issue("購入実績IDが重複しています");
    for (const review of l.reviews)
      if (!l.requests.some((r) => r.id === review.requestId))
        issue("審査履歴の関連が不正です");
    for (const r of l.requests) {
      if (r.purchases.reduce((n, p) => n + p.amount, 0) > 2147483647)
        issue("購入合計がint32を超えています");
      for (const p of r.purchases) {
        const limit = Math.round(p.amount * (r.input.rateToJpy ?? 0));
        if (
          l.allocations
            .filter((a) => a.active && a.purchaseId === p.id)
            .reduce((n, a) => n + a.amount, 0) > limit
        )
          issue("購入実額の配賦上限を超えています");
        if (p.reflected.reduce((n, ref) => n + ref.amount, 0) > limit)
          issue("購入実額の反映上限を超えています");
        if (
          new Set(p.reflected.map((ref) => ref.detailId)).size !==
          p.reflected.length
        )
          issue("反映済み明細が重複しています");
        if (!r.input.items.some((i) => i.id === p.itemId))
          issue("購入内訳の関連が不正です");
        if (
          p.reflected.some(
            (ref) => !l.details.some((d) => d.id === ref.detailId),
          )
        )
          issue("反映済み明細の関連が不正です");
      }
      if (r.input.relatedIds.some((id) => !l.requests.some((x) => x.id === id)))
        issue("関連申請が不正です");
    }
    for (const a of l.allocations) {
      const r = l.requests.find((r) => r.id === a.requestId);
      if (
        !r ||
        !r.purchases.some((p) => p.id === a.purchaseId) ||
        !l.details.some((d) => d.id === a.detailId)
      )
        issue("明細配賦の関連が不正です");
    }
    // Changed MF facts can legitimately leave a formerly valid allocation over its
    // new amount. Such versions are retained for re-confirmation, never discarded.
    for (const d of l.details) {
      const total = l.allocations
        .filter(
          (a) =>
            a.active && a.detailId === d.id && a.detailVersion === d.version,
        )
        .reduce((s, a) => s + a.amount, 0);
      if (total > Math.abs(d.amount)) issue("明細の配賦上限を超えています");
    }
  });
