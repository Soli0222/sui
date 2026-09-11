import { hasFundingApproval, loadFundingFacts, returnedFunding } from "./spending-funding";
import { isDeepStrictEqual } from "node:util";
import {
  spendingBudgetPolicy,
  spendingReviewSystem,
} from "./spending-review-policy";
import {
  spendingEvidence,
  spendingLimits,
  allowanceUse,
} from "./spending-evidence";
import {
  encryptCredential,
  spendingCredential,
  credentialStorageReady,
} from "./spending-ai-credentials";
import { listSpendingModels } from "./spending-ai";
import type { SpendingSettings } from "@sui/shared";
import { migrateSpending, budgetAt, legacyBudget } from "./spending-budget";
import { addMonthsToYearMonth } from "@sui/shared";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@sui/db";
import type {
  SpendingLedger,
  SpendingRequest,
  SpendingResponse,
  SpendingReview,
  SpendingFunding,
} from "@sui/shared";
import { getTotalMonths } from "@sui/shared";
import { prisma } from "../lib/db";
import { BadRequestError, ConflictError, NotFoundError } from "../lib/http";
import { getJstToday } from "../lib/dates";
import { buildDashboardCore } from "./forecast-core";
import { loadDashboardCoreData } from "./forecast";
import {
  addDays,
  calculateSpending,
  recordedPurchase,
  effectiveStatus,
  emptySpendingLedger,
  sum,
  spendingFacts,
} from "./spending-core";
import {
  spendingEvaluationSchema,
  spendingInputSchema,
  type SpendingCommand,
} from "./spending-validation";
import { previewMfMonth } from "./spending-csv";
import { requestSpendingDecision } from "./spending-ai";

type Tx = Prisma.TransactionClient;
const asJson = (v: unknown) =>
  JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const fingerprint = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const rawFingerprint = (raw: Record<string, string> | undefined) =>
  fingerprint(
    Object.fromEntries(
      Object.keys(raw ?? {})
        .sort()
        .map((k) => [k, raw![k]]),
    ),
  );
const now = () => new Date().toISOString();
function requestById(l: SpendingLedger, id: string) {
  const r = l.requests.find((r) => r.id === id && !r.deletedAt);
  if (!r) throw new NotFoundError("申請が見つかりません");
  return r;
}
async function readLedger(tx: Pick<Tx, "spendingLedger">) {
  const row = await tx.spendingLedger.findUnique({ where: { id: 1 } });
  return {
    version: row?.version ?? 0,
    ledger: row
      ? migrateSpending(row.data as unknown as SpendingLedger)
      : migrateSpending(emptySpendingLedger()),
  };
}
// Aggregate writes serialize. Existing financial operations retain their own locks;
// SERIALIZABLE detects a concurrent change to any facts read by approval.
async function mutate<T>(
  version: number | null,
  fn: (l: SpendingLedger, tx: Tx, version: number) => Promise<T>,
) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`INSERT INTO spending_ledgers (id, version, data, updated_at) VALUES (1, 0, ${JSON.stringify(emptySpendingLedger())}::jsonb, NOW()) ON CONFLICT (id) DO NOTHING`;
        await tx.$queryRaw`SELECT id FROM spending_ledgers WHERE id = 1 FOR UPDATE`;
        const state = await readLedger(tx);
        if (version !== null && state.version !== version)
          throw new ConflictError(
            "データが更新されました。再読込して操作してください",
          );
        const result = await fn(state.ledger, tx, state.version);
        await tx.spendingLedger.update({
          where: { id: 1 },
          data: { version: { increment: 1 }, data: asJson(state.ledger) },
        });
        return result;
      },
      { isolationLevel: "Serializable", timeout: 30000 },
    );
  } catch (e) {
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      (e.code === "P2034" ||
        (e.code === "P2010" &&
          "meta" in e &&
          JSON.stringify(e.meta).includes("40001")))
    )
      throw new ConflictError(
        "並行更新を検出しました。再読込して再試行してください",
      );
    throw e;
  }
}
async function facts(tx: Tx) {
  const data = await loadDashboardCoreData(tx);
  const transactions = await tx.transaction.findMany({
    where: { deletedAt: null },
  });
  const recurring = await tx.recurringItem.findMany();
  return { data, transactions, recurring };
}
type Facts = Awaited<ReturnType<typeof facts>>;
function fundingState(link: SpendingRequest["fundingLinks"][number], f: Facts) {
  const transaction = f.transactions.find(
    (t) => t.forecastEventId === link.eventId,
  );
  const item = f.recurring.find((i) => i.id === link.recurringId);
  const mismatch = transaction
    ? transaction.type !== "transfer" ||
      transaction.amount !== link.expected.amount ||
      transaction.accountId !== link.expected.sourceId ||
      transaction.transferToAccountId !== link.expected.destinationId
    : item &&
      (item.amount !== link.expected.amount ||
        item.accountId !== link.expected.sourceId ||
        item.transferToAccountId !== link.expected.destinationId ||
        item.startDate?.toISOString().slice(0, 10) !== link.expected.date ||
        item.endDate?.toISOString().slice(0, 10) !== link.expected.date ||
        item.type !== "transfer" ||
        item.recurrence !== "monthly" ||
        item.interval !== 1 ||
        item.dateShiftPolicy !== "none" ||
        item.dayOfMonth !== Number(link.expected.date.slice(8)));
  const state = !transaction && (!item || !item.enabled || item.deletedAt)
    ? "cancelled"
    : mismatch ? "attention" : transaction ? "used" : "scheduled";
  return {
    id: link.id,
    state: state as "attention" | "used" | "cancelled" | "scheduled",
    transactionId: transaction?.id ?? null,
    actual: transaction?.amount ?? null,
    scheduleAvailable: Boolean(item && !item.deletedAt),
    pending: Boolean(!transaction && item && item.enabled && !item.deletedAt),
  };
}
function fundingAvailable(
  l: SpendingLedger,
  f: Facts,
  accountId: string,
  today: string,
  through: string,
  excludeRequest?: string,
): SpendingFunding {
  const account = f.data.accounts.find((a) => a.id === accountId);
  const issues: string[] = [];
  if (!account || !account.supplementalBudgetEnabled)
    issues.push("資金元口座が無効、削除済み、または補正予算に利用不可です");
  const starts = [
    today,
    ...f.data.recurringItems.map(
      (i) =>
        i.startDate?.toISOString().slice(0, 10) ??
        i.createdAt.toISOString().slice(0, 10),
    ),
    ...f.data.loans.map((i) => i.startDate.toISOString().slice(0, 10)),
    ...f.data.creditCards.map((i) => i.createdAt.toISOString().slice(0, 10)),
  ].sort();
  const start = starts[0].slice(0, 7) + "-01";
  const dashboard = buildDashboardCore({
    ...f.data,
    today: start,
    forecastMonths: Math.max(
      1,
      getTotalMonths(through.slice(0, 7)) -
        getTotalMonths(start.slice(0, 7)) +
        1,
    ),
    applyOffset: false,
  });
  const excluded = new Set(
    l.requests
      .filter((r) => r.id === excludeRequest)
      .flatMap((r) =>
        r.fundingLinks.filter((x) => !x.returnOf).map((x) => x.eventId),
      ),
  );
  const byId = new Map<string, { id: string; amount: number; date: string }>();
  for (const e of [...dashboard.overdueForecast, ...dashboard.forecast])
    if (
      e.accountId === accountId &&
      e.type !== "income" &&
      e.date <= through &&
      !excluded.has(e.id)
    )
      byId.set(e.id, { id: e.id, amount: e.amount, date: e.date });
  for (const r of l.requests.filter((r) => r.id !== excludeRequest))
    for (const link of r.fundingLinks.filter(
      (x) => x.expected.sourceId === accountId && !x.returnOf,
    )) {
      const state = fundingState(link, f);
      if (state.transactionId) continue;
      // All unconfirmed approved funding remains reserved, including an externally
      // cancelled or changed schedule, until the application is explicitly resolved.
      if (
        ![
          "cancelled",
          "expired",
          "draft",
          "denied",
          "held",
          "conditional",
        ].includes(
          r.status === "approved" ? effectiveStatus(r, today) : r.status,
        )
      )
        byId.set(link.eventId, {
          id: link.eventId,
          amount: Math.max(
            link.expected.amount,
            byId.get(link.eventId)?.amount ?? 0,
          ),
          date: link.expected.date,
        });
    }
  const held = sum([...byId.values()].map((e) => e.amount));
  return {
    accountId,
    currencyCode: account?.currencyCode,
    balance: account?.balance ?? 0,
    balanceOffset: account?.balanceOffset ?? 0,
    held,
    available: (account?.balance ?? 0) - (account?.balanceOffset ?? 0) - held,
    through,
    events: [...byId.values()],
    issues,
  };
}
function requestState(
  l: SpendingLedger,
  r: SpendingRequest,
  f: Facts,
  today: string,
): SpendingResponse["requestStates"][string] {
  const funding = r.fundingLinks.map((link) => fundingState(link, f));
  const issues: string[] = [];
  if (
    (recordedPurchase(r)?.amount ?? 0) > sum(r.input.items.map((i) => i.amount))
  )
    issues.push("購入実額が申請額を超えています。追加審査が必要です");
  if (funding.some((s) => s.state === "attention"))
    issues.push("振替予定・確定実額と審査条件に差があります");
  const originalFunding = funding.filter(s => !r.fundingLinks.find(link => link.id === s.id)?.returnOf);
  if (
    originalFunding.some(s => s.state === "cancelled") &&
    hasFundingApproval(r, today)
  )
    issues.push("関連振替予定が取消・削除されています");
  const approvalActive = hasFundingApproval(r, today);
  const pendingOriginal = funding.some((s) => s.pending && !r.fundingLinks.find(l => l.id === s.id)?.returnOf);
  if (r.input.funding && ((approvalActive && originalFunding.some(s => !s.transactionId)) || r.status === "reviewing" || pendingOriginal)) {
    const a = f.data.accounts.find((a) => a.id === r.input.funding?.sourceId);
    if (
      !a?.supplementalBudgetEnabled ||
      !f.data.accounts.some((a) => a.id === r.input.funding?.destinationId)
    )
      issues.push("関連口座の置き換えまたは取消が必要です");
    const available = fundingAvailable(
      l,
      f,
      r.input.funding.sourceId,
      today,
      [addDays(today, l.settings.fundingDays ?? 0), r.input.funding.date]
        .sort()
        .at(-1)!,
      r.status === "reviewing" ? r.id : undefined,
    );
    if (
      available.available <
      (r.status === "reviewing" ? r.input.funding.amount : 0)
    )
      issues.push("最新残高で補正予算の資金が不足しています");
  }
  for (const link of r.fundingLinks.filter(l => l.returnOf)) {
    if (funding.find(s => s.id === link.id)?.pending &&
      (!f.data.accounts.some(a => a.id === link.expected.sourceId) ||
       !f.data.accounts.some(a => a.id === link.expected.destinationId)))
      issues.push("返却予定の関連口座を確認してください");
  }
  const purchased = recordedPurchase(r)?.amount ?? 0;
  const used = sum(originalFunding.map(s => s.actual ?? 0));
  const returned = sum(funding.filter(s => r.fundingLinks.find(link => link.id === s.id)?.returnOf)
    .map(s => s.actual ?? 0));
  const purchaseFundingMismatch = Boolean(r.closedRemainder && r.input.funding && purchased > 0 &&
    !(r.status === "cancelled" && used === returned && !pendingOriginal) &&
    (originalFunding.some(s => s.transactionId)
      ? purchased !== used - returned
      : pendingOriginal && purchased !== r.input.funding.amount));
  if (purchaseFundingMismatch) {
    issues.push(
      "購入実額と振替承認額に差があります。未確定振替は条件を修正して再審査、確定済み資金は返却等を確認してください",
    );
  }
  const complete = recordedPurchase(r) !== null;
  let status = effectiveStatus(r, today);
  if (purchased > 0 && !["reviewing"].includes(status))
    status = complete ? "completed" : "purchased";
  const pendingFundingActionRequired = funding.some(s => s.pending) ||
    (approvalActive && originalFunding.some(s => s.state === "cancelled"));
  const fundingActionRequired = pendingFundingActionRequired || purchaseFundingMismatch ||
    funding.some(s => s.state === "attention");
  return { status, issues: [...new Set(issues)], funding, fundingActionRequired, pendingFundingActionRequired };
}

function overviewRequest(
  l: SpendingLedger,
  selectedMonth?: string,
): SpendingRequest {
  const today = getJstToday();
  return {
    id: "overview",
    version: 1,
    status: "draft",
    approvedAmount: 0,
    expiresAt: null,
    purchases: [],
    closedRemainder: false,
    deletedAt: null,
    createdAt: today,
    fundingLinks: [],
    history: [],
    input: {
      name: "月別予算照会",
      reason: "照会",
      purchaseDate: today,
      payment: "",
      kind: "normal",
      currency: "JPY",
      rateToJpy: 1,
      rateAt: today,
      urgency: "",
      replacement: "",
      alternatives: "",
      relatedIds: [],
      funding: null,
      items: [
        ...new Set([
          selectedMonth ?? today.slice(0, 7),
          ...l.budgets.map((b) => b.month),
          ...(l.budgetProposals ?? [])
            .filter((p) => !p.supersededAt)
            .map((p) => p.from),
          ...l.details.map((d) => d.date.slice(0, 7)),
        ]),
      ].flatMap((month) =>
        [
          ...new Set([
            ...budgetAt(l, month).map((b) => b.category),
            ...spendingFacts(l)
              .filter((d) => d.budgetMonth === month)
              .map((d) => d.budgetCategory),
          ]),
        ].map((category) => ({
          id: month + category,
          name: category,
          category,
          month,
          amount: 0,
          forecastId: null,
          forecastAmount: 0,
        })),
      ),
    },
  };
}

export async function getSpending(month?: string): Promise<SpendingResponse> {
  return prisma.$transaction(
    async (tx) => {
      const { version, ledger } = await readLedger(tx),
        f = await facts(tx),
        today = getJstToday();
      return {
        version,
        ledger,
        funding: f.data.accounts
          .filter((a) => a.supplementalBudgetEnabled)
          .map((a) =>
            fundingAvailable(
              ledger,
              f,
              a.id,
              today,
              addDays(today, ledger.settings.fundingDays ?? 0),
            ),
          ),
        calculations: calculateSpending(
          ledger,
          overviewRequest(ledger, month),
          today,
        ),
        requestStates: Object.fromEntries(
          ledger.requests
            .filter((r) => !r.deletedAt)
            .map((r) => [r.id, requestState(ledger, r, f, today)]),
        ),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
async function disablePending(
  r: SpendingRequest,
  tx: Tx,
  deletedAt?: Date,
) {
  for (const link of r.fundingLinks.filter((x) => !x.returnOf))
    if (
      !(await tx.transaction.findFirst({
        where: { forecastEventId: link.eventId, deletedAt: null },
      }))
    )
      await tx.recurringItem.updateMany({
        where: { id: link.recurringId, deletedAt: null },
        data: { enabled: false, ...(deletedAt ? { deletedAt } : {}) },
      });
}
async function createFunding(
  r: SpendingRequest,
  tx: Tx,
  expected: NonNullable<SpendingRequest["input"]["funding"]>,
  returnOf: string | null = null,
) {
  const accounts = await tx.account.findMany({
    where: {
      id: { in: [expected.sourceId, expected.destinationId] },
      deletedAt: null,
    },
  });
  if (
    accounts.length !== 2 ||
    accounts[0].currencyCode !== accounts[1].currencyCode
  )
    throw new BadRequestError("振替口座が無効または通貨が不一致です");
  const existing = !returnOf
    ? r.fundingLinks.find((x) => !x.returnOf)
    : undefined;
  const confirmed = existing
    ? await tx.transaction.findFirst({
        where: { forecastEventId: existing.eventId, deletedAt: null },
      })
    : null;
  if (confirmed) {
    if (fingerprint(existing?.expected) !== fingerprint(expected))
      throw new ConflictError(
        "確定済み振替は変更できません。追加分は関連申請で審査してください",
      );
    return;
  }
  const data = {
    name: `支出決裁 ${r.input.name}`.slice(0, 100),
    type: "transfer" as const,
    amount: expected.amount,
    recurrence: "monthly" as const,
    interval: 1,
    dayOfMonth: Number(expected.date.slice(8)),
    dayOfWeek: null,
    accountId: expected.sourceId,
    transferToAccountId: expected.destinationId,
    startDate: new Date(expected.date + "T00:00:00Z"),
    endDate: new Date(expected.date + "T00:00:00Z"),
    dateShiftPolicy: "none" as const,
    enabled: true,
    deletedAt: null,
    sortOrder: 0,
  };
  const item = existing
    ? await tx.recurringItem.update({
        where: { id: existing.recurringId },
        data,
      })
    : await tx.recurringItem.create({ data });
  const link = {
    id: existing?.id ?? randomUUID(),
    recurringId: item.id,
    eventId: `recurring:${item.id}:${expected.date.slice(0, 7)}`,
    expected,
    returnOf,
  };
  if (existing) Object.assign(existing, link);
  else r.fundingLinks.push(link);
}
export async function spendingCommand(version: number, cmd: SpendingCommand) {
  return mutate(version, async (l, tx) => {
    const at = now();
    if (cmd.action === "settings") {
      if (
        JSON.stringify(l.settings.ai) !== JSON.stringify(cmd.settings.ai) &&
        cmd.settings.ai?.credentialMode === "stored"
      ) {
        if (!(await spendingCredential(cmd.settings.ai, tx)))
          throw new BadRequestError("この接続先のAPIキーを設定してください");
      }
      l.settings = cmd.settings;
      return;
    }
    if (cmd.action === "budget-proposal") {
      const proposals = l.budgetProposals!;
      const original = cmd.replaceId
        ? proposals.find((p) => p.id === cmd.replaceId && !p.supersededAt)
        : undefined;
      if (cmd.replaceId && !original)
        throw new ConflictError("変更元の予算案が更新されています");
      const p = { ...cmd.proposal, id: randomUUID(), at, supersededAt: null };
      if (original) {
        if (p.from < original.from || (original.to && p.from > original.to))
          throw new BadRequestError(
            "変更開始月は元の適用期間内を指定してください",
          );
        original.supersededAt = at;
        if (original.from < p.from)
          proposals.push({
            ...original,
            id: randomUUID(),
            to: addMonthsToYearMonth(p.from, -1),
            supersededAt: null,
          });
        if (p.to && (!original.to || original.to > p.to))
          proposals.push({
            ...original,
            id: randomUUID(),
            from: addMonthsToYearMonth(p.to, 1),
            supersededAt: null,
          });
      }
      if (
        proposals.some(
          (q) =>
            !q.supersededAt &&
            q.from <= (p.to ?? "9999-12") &&
            p.from <= (q.to ?? "9999-12"),
        )
      )
        throw new ConflictError(
          "適用期間が既存の予算案と重複しています。変更元を選んでください",
        );
      proposals.push(p);
      return;
    }
    if (cmd.action === "budget") {
      legacyBudget(l, cmd.month, cmd.category, cmd.amount, cmd.reason, at);
      return;
    }
    if (cmd.action === "copy-budget") {
      if (cmd.from === cmd.to)
        throw new BadRequestError("異なる適用月を指定してください");
      const rows = budgetAt(l, cmd.from);
      if (!rows.length) throw new BadRequestError("複製元の予算がありません");
      for (const b of rows)
        legacyBudget(l, cmd.to, b.category, b.amount, cmd.reason, at);
      return;
    }
    if (cmd.action === "mapping")
      throw new BadRequestError(
        "カテゴリはMFの値を使用します。支払手段は登録済みカード・口座を選んでください",
      );
    if (cmd.action === "payment-link") {
      if (cmd.target) {
        const target =
          cmd.target.kind === "account"
            ? await tx.account.findFirst({
                where: { id: cmd.target.id, deletedAt: null },
              })
            : await tx.creditCard.findFirst({
                where: { id: cmd.target.id, deletedAt: null },
              });
        if (!target)
          throw new BadRequestError("選択した口座・カードが見つかりません");
        l.paymentLinks![cmd.source] = cmd.target;
      } else delete l.paymentLinks![cmd.source];
      return;
    }
    if (cmd.action === "request") {
      const previous = cmd.id ? requestById(l, cmd.id) : undefined;
      if (previous && previous.input.items.length > 1)
        throw new ConflictError(
          "旧形式の複数内訳申請は履歴として保持します。変更は新しい申請で行ってください",
        );
      const { amount, category, ...base } = cmd.input;
      const input = spendingInputSchema.parse({
        ...base,
        items: [
          {
            id: previous?.input.items[0].id ?? randomUUID(),
            name: base.name,
            amount,
            category,
            month: base.purchaseDate.slice(0, 7),
            forecastId: null,
            forecastAmount: 0,
          },
        ],
      });
      if (input.relatedIds.some((id) => !l.requests.some((r) => r.id === id)))
        throw new BadRequestError("関連申請が見つかりません");
      if (cmd.id) {
        const r = requestById(l, cmd.id);
        for (const link of r.fundingLinks.filter((x) => !x.returnOf))
          if (
            await tx.transaction.findFirst({
              where: { forecastEventId: link.eventId, deletedAt: null },
            })
          ) {
            if (
              fingerprint(input.funding) !== fingerprint(link.expected) ||
              input.kind !== r.input.kind ||
              input.currency !== r.input.currency ||
              input.rateToJpy !== r.input.rateToJpy ||
              (input.subcategory ?? "") !== (r.input.subcategory ?? "") ||
              input.items[0].category !== r.input.items[0].category
            )
              throw new ConflictError(
                "確定済みの振替条件は変更できません。差分は関連申請で追加審査してください",
              );
          }
        if (
          r.purchases.some((p) => !input.items.some((i) => i.id === p.itemId))
        )
          throw new ConflictError("購入済み内訳は保持してください");
        if (
          recordedPurchase(r) &&
          (r.input.kind !== input.kind ||
            r.input.currency !== input.currency ||
            r.input.rateToJpy !== input.rateToJpy ||
            (r.input.subcategory ?? "") !== (input.subcategory ?? "") ||
            r.input.items.some((i) => {
              const n = input.items.find((x) => x.id === i.id);
              return n && (n.month !== i.month || n.category !== i.category);
            }))
        )
          throw new ConflictError(
            "購入済みの予算区分・通貨・対象月・カテゴリは変更できません",
          );
        await disablePending(r, tx);
        r.history.push({
          at,
          action: "edit",
          reason: input.reason,
          input: r.input,
        });
        if (r.approvedAmount > 0 && !r.allowanceUse)
          r.allowanceUse = allowanceUse(l, r) ?? undefined;
        r.input = input;
        r.version++;
        r.status = "draft";
        r.expiresAt = null;
        r.closedRemainder = false;
      } else
        l.requests.push({
          id: randomUUID(),
          version: 1,
          input: input,
          status: "draft",
          approvedAmount: 0,
          expiresAt: null,
          purchases: [],
          closedRemainder: false,
          deletedAt: null,
          createdAt: at,
          fundingLinks: [],
          history: [{ at, action: "create", reason: input.reason }],
        });
      return;
    }
    if (cmd.action === "import-confirm") {
      const batch = l.imports.find((i) => i.id === cmd.id);
      if (!batch) throw new NotFoundError("プレビューがありません");
      if (batch.committed) return;
      if (batch.month && batch.ledgerVersion !== version)
        throw new ConflictError(
          "プレビュー後にデータが更新されました。もう一度CSVを選んでください",
        );
      if (batch.month && batch.errors.length)
        throw new BadRequestError(
          "不正行を修正してから月全体を更新してください",
        );
      if (cmd.confirmedCoverage && batch.to > getJstToday())
        throw new BadRequestError("未来の日を取込確認済みにはできません");
      if (batch.errors.length && (!cmd.acceptErrors || cmd.confirmedCoverage))
        throw new BadRequestError(
          "不正行を含むファイルは対象期間を確認済みにできません。エラーを確認してください",
        );
      const touched = new Set<string>();
      for (const row of batch.rows) {
        if (!row.detail) continue;
        const resolution = cmd.resolutions[String(row.line)];
        if (!row.existingId && row.candidates.length && !resolution)
          throw new ConflictError(`${row.line}行の重複候補を解決してください`);
        if (resolution === "skip") {
          if (batch.month)
            throw new BadRequestError("月次更新では行を省略できません");
          continue;
        }
        const id =
          row.existingId ??
          (resolution && resolution !== "new" ? resolution : null);
        if (id && !l.details.some((d) => d.id === id))
          throw new BadRequestError("対応する明細がありません");
        if (id && touched.has(id))
          throw new ConflictError("複数行を同一明細に上書きできません");
        if (id) touched.add(id);
        const existing = l.details.find((d) => d.id === id);
        if (existing) {
          if (
            rawFingerprint(existing.raw) !== rawFingerprint(row.detail.raw) ||
            existing.deletedAt
          ) {
            Object.assign(existing, {
              ...row.detail,
              id: existing.id,
              version: existing.version + 1,
              oneOff: existing.oneOff,
              classificationReason: existing.classificationReason,
              fixedId: existing.fixedId,
              refundOf: existing.refundOf,
            });
          }
        } else {
          l.details.push(row.detail);
          touched.add(row.detail.id);
        }
      }
      if (batch.month) {
        for (const d of l.details)
          if (
            !d.deletedAt &&
            d.date.startsWith(batch.month) &&
            !touched.has(d.id)
          ) {
            d.deletedAt = at;
            d.version++;
          }
        for (const previous of l.imports)
          if (
            previous.id !== batch.id &&
            previous.committed &&
            previous.from.startsWith(batch.month)
          )
            previous.supersededAt = at;
      }
      batch.committed = true;
      batch.confirmedCoverage = batch.month ? true : cmd.confirmedCoverage;
      batch.resolutions = cmd.resolutions;
      return;
    }
    if (cmd.action === "delete-detail") {
      const d = l.details.find((d) => d.id === cmd.detailId && !d.deletedAt);
      if (!d) throw new NotFoundError("明細がありません");
      d.deletedAt = at;
      d.version++;
      return;
    }
    const r = requestById(l, cmd.id);
    if (cmd.action === "answer") {
      const review = l.reviews
        .slice()
        .reverse()
        .find((v) => v.requestId === r.id);
      if (
        !review ||
        review.id !== cmd.reviewId ||
        !review.question ||
        review.requestVersion !== r.version ||
        !["held", "conditional", "denied"].includes(r.status) ||
        (r.answers ?? []).some((a) => a.reviewId === review.id)
      )
        throw new ConflictError(
          "質問が更新済み、回答済み、または回答できない申請です。最新状態を確認してください",
        );
      r.version++;
      (r.answers ??= []).push({
        reviewId: review.id,
        requestVersion: r.version,
        question: review.question,
        answer: cmd.answer,
        at,
        policyKey: review.questionPolicyKey,
        inputKey: fingerprint(r.input),
      });
      r.history.push({ at, action: "answer", reason: cmd.answer });
      return;
    }
    if (cmd.action === "cancel" || cmd.action === "delete") {
      if (
        cmd.action === "delete" &&
        (recordedPurchase(r) || r.fundingLinks.length)
      )
        throw new ConflictError(
          "実績・振替関連のある申請は削除せず取消してください",
        );
      await disablePending(r, tx, new Date(at));
      r.status = "cancelled";
      r.closedRemainder = true;
      if (cmd.action === "delete") r.deletedAt = at;
      r.history.push({ at, action: cmd.action, reason: cmd.reason });
    }
    if (cmd.action === "purchase") {
      const previous = recordedPurchase(r);
      r.history.push({
        at,
        action: previous ? "purchase-update" : "purchase",
        reason: cmd.reason,
        ...(previous ? { purchaseRecord: previous } : {}),
      });
      r.purchaseRecord = {
        amount: cmd.amount,
        date: cmd.date,
        reason: cmd.reason,
        at,
      };
      r.closedRemainder = true;
      // Funding approval remains independent of the purchase receipt.
      if (r.input.kind === "normal") r.status = "completed";
    }
    if (cmd.action === "return-funds") {
      const link = r.fundingLinks.find(
        (x) => x.id === cmd.linkId && !x.returnOf,
      );
      if (!link) throw new BadRequestError("元の資金利用がありません");
      const original = await tx.transaction.findFirst({
        where: {
          forecastEventId: link.eventId,
          deletedAt: null,
          type: "transfer",
        },
      });
      if (!original || !original.accountId || !original.transferToAccountId)
        throw new ConflictError("未確定振替には資金返却を登録できません");
      if (
        returnedFunding(r, link.id, await loadFundingFacts(tx, r)) +
          cmd.amount >
        original.amount
      )
        throw new ConflictError("返却予定合計が確定利用額を超えます");
      await createFunding(
        r,
        tx,
        {
          sourceId: original.transferToAccountId,
          destinationId: original.accountId,
          date: cmd.date,
          amount: cmd.amount,
        },
        link.id,
      );
      r.history.push({ at, action: "return-funds", reason: cmd.reason });
    }
    r.version++;
  });
}
export async function previewSpendingImport(
  version: number,
  bytes: Uint8Array,
  filename: string,
  month?: string,
) {
  return mutate(version, async (l) => {
    const batch = previewMfMonth(bytes, filename, l, getJstToday(), month);
    batch.ledgerVersion = version + 1;
    const existing = l.imports.find(
      (i) =>
        i.hash === batch.hash &&
        i.committed &&
        !i.supersededAt &&
        i.from === batch.from &&
        i.to === batch.to,
    );
    if (
      existing &&
      (!batch.month ||
        (batch.removedIds?.length === 0 &&
          batch.rows.every(
            (row) =>
              row.existingId &&
              l.details.some(
                (d) =>
                  d.id === row.existingId &&
                  !d.deletedAt &&
                  rawFingerprint(d.raw) === rawFingerprint(row.detail?.raw),
              ),
          )))
    )
      return existing;
    l.imports.push(batch);
    return batch;
  });
}

async function snapshot(l: SpendingLedger, r: SpendingRequest, tx: Tx) {
  const f = await facts(tx),
    today = getJstToday();
  const funding = r.input.funding
    ? fundingAvailable(
        l,
        f,
        r.input.funding.sourceId,
        today,
        [addDays(today, l.settings.fundingDays ?? 0), r.input.funding.date]
          .sort()
          .at(-1)!,
        r.id,
      )
    : null;
  const calculations = calculateSpending(l, r, today);
  const integrityIssues = requestState(l, r, f, today).issues;
  for (const c of calculations) c.missing.push(...integrityIssues);
  const evidence = spendingEvidence(l, r, today);
  const usedFunding = new Map(
    l.requests.flatMap((x) => {
      const amount = sum(
        x.fundingLinks
          .filter((link) => !link.returnOf)
          .map(
            (link) =>
              f.transactions.find((t) => t.forecastEventId === link.eventId)
                ?.amount ?? 0,
          ),
      );
      return amount > 0
        ? [[x.id, Math.round(amount * (x.input.rateToJpy ?? 0))] as const]
        : [];
    }),
  );
  const limits = spendingLimits(l, r, today, usedFunding);
  const policyKey = fingerprint({
    input: r.input,
    limits: limits.map((rule) => ({
      id: rule.id,
      category: rule.category,
      subcategory: rule.subcategory,
      months: rule.months,
      amount: rule.amount,
      action: rule.action,
      used: rule.used,
      requested: rule.requested,
      requestIds: rule.requestIds,
    })),
  });
  const dashboard = buildDashboardCore({
    ...f.data,
    today,
    forecastMonths: 3,
    applyOffset: true,
  });
  const context = {
    ...evidence,
    purchase: recordedPurchase(r),
    budgetPolicy:
      spendingBudgetPolicy +
      "予算実績はMFのみ。申請は参考情報。購入記録済みの今回申請は追加額を0とし、MF反映済みとは断定しない。補正予算の購入もMF実績から除外しない。",
    cashFlow: {
      label:
        "参考情報。通常購入は追加していません。補正振替は資金移動のみです。",
      minBalance: dashboard.minBalance,
      cardAssumptionTotal: sum(
        f.data.creditCards.map((c) => c.assumptionAmount),
      ),
      events: dashboard.forecast.map((e) => ({
        date: e.date,
        type: e.type,
        amountJpy: e.amountJpy,
      })),
    },
  };
  return {
    input: structuredClone(r.input),
    settings: structuredClone(l.settings),
    calculations,
    detailIds: evidence.details.map((d) => d.id),
    limits,
    policyKey,
    funding,
    fingerprint: fingerprint({
      data: f.data,
      transactions: f.transactions,
      recurring: f.recurring,
      today,
    }),
    context,
  };
}
function blockers(s: SpendingReview["snapshot"]) {
  const missing = s.calculations.flatMap((c) => c.missing);
  if (s.settings.threshold === null)
    missing.push("決裁対象金額を設定してください");
  if (s.settings.approvalDays === null)
    missing.push("承認有効日数を設定してください");
  if (s.input.kind === "supplemental" && s.settings.fundingDays === null)
    missing.push("補正予算で何日先の支払予定まで考慮するか設定してください");
  if (!s.input.rateToJpy || (s.input.currency !== "JPY" && !s.input.rateAt))
    missing.push("通貨換算の根拠が不足しています");
  if (
    s.input.kind === "normal" &&
    s.calculations.some((c) => c.remaining !== null && c.remaining < 0)
  )
    missing.push("通常予算を超過しています");
  if (s.funding) {
    missing.push(...s.funding.issues);
    if (s.funding.available < (s.input.funding?.amount ?? 0))
      missing.push("補正予算の資金が不足しています");
  }
  for (const limit of s.limits ?? []) {
    if (limit.category && limit.subcategory && !s.input.subcategory)
      missing.push("利用枠の判定のため、申請の中項目を選択してください");
    if (limit.exceeded && limit.action === "block")
      missing.push(
        `${limit.category ?? "補正予算全体"}${limit.subcategory ? "／" + limit.subcategory : ""}の直近${limit.months}か月の利用上限を超過しています`,
      );
  }
  return [...new Set(missing)];
}
async function evaluate(
  s: SpendingReview["snapshot"],
): Promise<
  Pick<
    SpendingReview,
    "decision" | "reasons" | "options" | "missing" | "question" | "assessment"
  >
> {
  const ai = s.settings.ai;
  if (!ai)
    return {
      decision: "held" as const,
      reasons: ["AI接続先とモデルを設定してください"],
      options: [],
      missing: ["AI設定"],
    };
  let credential: string | null;
  try {
    credential = await spendingCredential(ai);
  } catch {
    credential = null;
  }
  if (!credential)
    return {
      decision: "held" as const,
      reasons: ["AIのAPIキーを設定してください"],
      options: [],
      missing: ["AI認証情報"],
    };
  const sanitized = {
    ...s,
    settings: {
      threshold: s.settings.threshold,
      freshnessDays: s.settings.freshnessDays,
      approvalDays: s.settings.approvalDays,
      fundingDays: s.settings.fundingDays,
    },
    funding: s.funding
      ? {
          currencyCode: s.funding.currencyCode,
          available: s.funding.available,
          held: s.funding.held,
          through: s.funding.through,
          issues: s.funding.issues,
        }
      : null,
    input: {
      ...s.input,
      funding: s.input.funding
        ? { amount: s.input.funding.amount, date: s.input.funding.date }
        : null,
    },
  };
  try {
    const content = await requestSpendingDecision(
      ai,
      credential,
      spendingReviewSystem,
      JSON.stringify(sanitized),
    );
    const result = spendingEvaluationSchema.parse(JSON.parse(content));
    const context = s.context as ReturnType<typeof spendingEvidence>;
    const validIds = new Set([
      ...context.monthly.map((g) => g.id),
      ...context.details.map((d) => d.id),
      ...context.relatedRequests.map((r) => r.id),
    ]);
    const relevant = context.monthly.filter((g) =>
      s.input.items.some((i) => i.category === g.category),
    );
    if (
      result.assessment.evidenceIds.some((id) => !validIds.has(id)) ||
      (relevant.length > 0 &&
        !relevant.some((g) => result.assessment.evidenceIds.includes(g.id)))
    )
      throw new Error("関連するMF集計の参照が不足または不正です");
    return result;
  } catch {
    return {
      decision: "held" as const,
      reasons: ["AI接続失敗・タイムアウト・不正出力のため保留しました"],
      options: ["接続設定を確認して再審査"],
      missing: ["有効なAI審査結果"],
    };
  }
}
export async function reviewSpending(
  version: number,
  id: string,
  overrideReason: string | null = null,
) {
  const start = await mutate(version, async (l, tx, v) => {
    const r = requestById(l, id);
    if (r.status === "reviewing") throw new ConflictError("審査中です");
    if (
      ["cancelled", "expired"].includes(
        r.status === "approved" ? effectiveStatus(r, getJstToday()) : r.status,
      )
    )
      throw new ConflictError("編集して再申請してください");
    r.status = "reviewing";
    await disablePending(r, tx);
    const s = await snapshot(l, r, tx);
    const review: SpendingReview = {
      id: randomUUID(),
      requestId: id,
      requestVersion: r.version,
      ledgerVersion: v + 1,
      at: now(),
      snapshot: s,
      model: l.settings.ai?.model ?? null,
      decision: "held",
      reasons: ["審査中"],
      options: [],
      missing: [],
      overrideReason,
    };
    l.reviews.push(review);
    return review;
  });
  const result = overrideReason
    ? {
        decision: "approvable" as const,
        reasons: ["利用者による例外承認"],
        options: [],
        missing: [],
      }
    : await evaluate(start.snapshot);
  return mutate(null, async (l, tx, v) => {
    const review = l.reviews.find((x) => x.id === start.id)!;
    const r = requestById(l, id);
    Object.assign(review, result);
    const current = await snapshot(l, r, tx);
    const stale =
      v !== start.ledgerVersion ||
      r.version !== start.requestVersion ||
      r.status !== "reviewing" ||
      current.fingerprint !== start.snapshot.fingerprint;
    const blocked = blockers(current);
    const accounts = await tx.account.findMany({ where: { deletedAt: null } });
    if (r.input.funding) {
      const src = accounts.find((a) => a.id === r.input.funding?.sourceId),
        dst = accounts.find((a) => a.id === r.input.funding?.destinationId);
      if (
        !src ||
        !dst ||
        src.currencyCode !== dst.currencyCode ||
        src.currencyCode !== r.input.currency
      )
        blocked.push("振替口座が無効、または通貨が一致しません");
    }
    if (stale) {
      review.decision = "held";
      review.question = null;
      review.missing.push("審査中に根拠データが更新されました");
      if (r.status === "reviewing") r.status = "held";
      return review;
    }
    if (blocked.length) {
      review.decision = "held";
      review.question = null;
      review.missing.push(...blocked);
      if (result.decision === "approvable") review.reasons = [blocked[0]];
      r.status = "held";
      return review;
    }
    const explanation =
      current.limits?.filter(
        (rule) => rule.exceeded && rule.action === "explain",
      ) ?? [];
    if (
      explanation.length &&
      !r.answers?.some((a) => a.policyKey === current.policyKey)
    ) {
      const decision =
        result.decision === "approvable" ? "held" : result.decision;
      review.decision = decision;
      review.question =
        "補正予算の利用目安を超えています。最近の支出を踏まえ、今回も必要な理由と、減額・延期できる部分を教えてください。";
      review.questionPolicyKey = current.policyKey;
      review.reasons = [
        ...(result.decision === "approvable" ? [] : result.reasons.slice(0, 1)),
        "補正予算の利用目安を超えるため、追加説明と再審査が必要です",
      ];
      r.status = decision;
      return review;
    }
    if (explanation.length && overrideReason) {
      review.decision = "held";
      review.missing.push("利用目安の超過理由はAIで再審査してください");
      r.status = "held";
      return review;
    }
    if (result.decision === "approvable") {
      if (r.input.funding) {
        const previous = allowanceUse(l, r);
        r.allowanceUse = {
          at:
            r.allowanceUse?.at ??
            (r.approvedAmount > 0 ? previous?.at : undefined) ??
            getJstToday(),
          amountJpy: Math.round(
            sum(r.input.items.map((i) => i.amount)) * (r.input.rateToJpy ?? 0),
          ),
          category: r.input.items[0].category,
          subcategory: r.input.subcategory ?? "",
        };
      }
      if (r.input.funding) await createFunding(r, tx, r.input.funding);
      r.status = "approved";
      r.approvedAmount = sum(r.input.items.map((i) => i.amount));
      r.expiresAt = addDays(getJstToday(), l.settings.approvalDays!);
    } else
      r.status =
        result.decision === "conditional"
          ? "conditional"
          : result.decision === "denied"
            ? "denied"
            : "held";
    r.history.push({
      at: now(),
      action: overrideReason ? "override" : "review",
      reason: overrideReason ?? review.reasons.join("\n"),
    });
    return review;
  });
}

/** System expiry task. Does not confirm or reverse any financial transaction. */
export async function expireSpendingApprovals(today = getJstToday()) {
  const state = await readLedger(prisma);
  if (
    !state.ledger.requests.some(
      (r) => r.expiresAt && r.expiresAt < today && !r.closedRemainder,
    )
  )
    return;
  await mutate(null, async (l, tx) => {
    for (const r of l.requests) {
      if (!r.expiresAt || r.expiresAt >= today || r.closedRemainder) continue;
      r.closedRemainder = true;
      if (!recordedPurchase(r)) {
        await disablePending(r, tx);
        r.status = "expired";
      }
      // Purchased facts and already-confirmed transfers survive expiration.
      r.history.push({
        at: now(),
        action: "expire",
        reason: "承認期限を過ぎた未購入の承認を失効",
      });
      r.version++;
    }
  });
}

export async function getSpendingAiStatus() {
  const { ledger } = await readLedger(prisma);
  let configured = false;
  try {
    configured = Boolean(
      ledger.settings.ai && (await spendingCredential(ledger.settings.ai)),
    );
  } catch {
    /* Show setup status without secrets. */
  }
  return { configured, storageReady: credentialStorageReady() };
}
export async function saveSpendingAi(
  version: number,
  ai: NonNullable<SpendingSettings["ai"]>,
  apiKey?: string | null,
) {
  return mutate(version, async (l, tx) => {
    if (apiKey === null) {
      await tx.spendingAiCredential.deleteMany();
      l.settings.ai = { ...ai, credentialMode: "stored" };
      return;
    }
    if (apiKey) {
      await tx.spendingAiCredential.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          endpoint: ai.endpoint,
          encrypted: encryptCredential(apiKey, ai.endpoint),
        },
        update: {
          endpoint: ai.endpoint,
          encrypted: encryptCredential(apiKey, ai.endpoint),
        },
      });
      l.settings.ai = { ...ai, credentialMode: "stored" };
    } else {
      if (ai.credentialMode === "stored" && !(await spendingCredential(ai, tx)))
        throw new BadRequestError("この接続先のAPIキーを入力してください");
      l.settings.ai = ai;
    }
  });
}
export async function inspectSpendingAi(
  ai: NonNullable<SpendingSettings["ai"]>,
  apiKey: string | undefined,
  test: boolean,
) {
  let credential = apiKey;
  if (!credential) {
    const configured = (await readLedger(prisma)).ledger.settings.ai;
    // Environment credentials must only be used with the operator-persisted
    // configuration, never with an endpoint supplied solely by this request.
    if (!isDeepStrictEqual(configured, ai))
      throw new BadRequestError("この接続設定のAPIキーを入力してください");
    credential = (await spendingCredential(ai)) ?? undefined;
  }
  if (!credential) throw new BadRequestError("APIキーを入力してください");
  try {
    if (!test) return { models: await listSpendingModels(ai, credential) };
    const text = await requestSpendingDecision(
      ai,
      credential,
      'Return only JSON: {"decision":"held","reasons":["connection test"],"options":[],"missing":[],"question":null,"assessment":{"evidenceIds":[],"concentration":"synthetic history","purpose":"synthetic purpose","amount":"synthetic amount","conclusion":"synthetic test"}}',
      '{"purpose":"synthetic connection test"}',
    );
    spendingEvaluationSchema.parse(JSON.parse(text));
    return { ok: true, model: ai.model };
  } catch {
    throw new BadRequestError(
      test
        ? "接続または審査形式の確認に失敗しました。APIキー・モデル・接続先を確認してください"
        : "モデル一覧を取得できません。接続設定を確認するか、モデルIDを直接入力してください",
    );
  }
}
