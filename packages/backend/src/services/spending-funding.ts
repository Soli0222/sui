import type { Prisma, RecurringItem, Transaction } from "@sui/db";
import type { ForecastEvent, SpendingLedger, SpendingRequest } from "@sui/shared";
import { getJstToday } from "../lib/dates";
import { ConflictError } from "../lib/http";
import { migrateSpending } from "./spending-budget";
import { recordedPurchase } from "./spending-core";

type Tx = Prisma.TransactionClient;
type Link = SpendingRequest["fundingLinks"][number];
export type FundingFacts = { recurring: RecurringItem[]; transactions: Transaction[] };

export function hasFundingApproval(r: SpendingRequest, today: string) {
  const approved = r.status === "approved" ||
    (["purchased", "completed"].includes(r.status) && r.approvedAmount > 0);
  return !r.deletedAt && approved &&
    (recordedPurchase(r) !== null || !r.expiresAt || r.expiresAt >= today);
}

/** History links are retained; only actual returns and live reservations consume capacity. */
export function returnedFunding(r: SpendingRequest, originalId: string, facts: FundingFacts, excludeId?: string) {
  return r.fundingLinks.filter(link => link.returnOf === originalId && link.id !== excludeId)
    .reduce((total, link) => {
      const actual = facts.transactions.find(t => !t.deletedAt && t.forecastEventId === link.eventId);
      const item = facts.recurring.find(i => i.id === link.recurringId);
      return total + (actual ? actual.amount : item && item.enabled && !item.deletedAt ? item.amount : 0);
    }, 0);
}

// Use the same first lock as approval/cancellation, and retain it until the financial write commits.
export async function lockSpendingLedger(tx: Tx) {
  await tx.$queryRaw`SELECT id FROM spending_ledgers WHERE id = 1 FOR UPDATE`;
}

export async function guardSpendingFunding(
  tx: Tx,
  recurringId: string,
  proposed: Pick<RecurringItem, "enabled" | "type" | "amount" | "accountId" | "transferToAccountId">,
  event?: ForecastEvent,
) {
  await lockSpendingLedger(tx);
  const row = await tx.spendingLedger.findUnique({ where: { id: 1 } });
  if (!row) return;
  const ledger = migrateSpending(row.data as unknown as SpendingLedger);
  let linked = false;
  for (const request of ledger.requests) {
    for (const link of request.fundingLinks.filter(l => l.recurringId === recurringId)) {
      linked = true;
      if (!proposed.enabled && !event) continue;
      if (request.deletedAt || (!link.returnOf && !hasFundingApproval(request, getJstToday()))) {
        throw new ConflictError("支出決裁を編集して再承認してから振替を有効化・確定してください");
      }
      if (proposed.type !== "transfer" || (event && event.id !== link.eventId)) {
        throw new ConflictError("支出決裁に関連する振替条件を再確認してください");
      }
      if (event) {
        const item = await tx.recurringItem.findUnique({ where: { id: recurringId } });
        if (!item || item.deletedAt || !item.enabled || item.type !== event.type ||
          item.accountId !== event.accountId || item.transferToAccountId !== event.transferToAccountId ||
          item.amount !== event.amount || item.startDate?.toISOString().slice(0, 10) !== event.date ||
          item.endDate?.toISOString().slice(0, 10) !== event.date) {
          throw new ConflictError("振替予定が変更・取消されました。再読込してください");
        }
      }
      if (link.returnOf) await assertReturnCapacity(tx, request, link, proposed);
    }
  }
  // Cancellation/approval use SERIALIZABLE snapshots. A row lock alone would let
  // them miss a newly committed actual transfer if their snapshot predates it.
  // Updating the shared row forces that stale writer to retry with fresh facts.
  if (linked) await tx.spendingLedger.update({
    where: { id: 1 }, data: { version: { increment: 1 } },
  });
}

async function assertReturnCapacity(tx: Tx, request: SpendingRequest, link: Link,
  proposed: Pick<RecurringItem, "amount" | "accountId" | "transferToAccountId">) {
  const originalLink = request.fundingLinks.find(l => l.id === link.returnOf && !l.returnOf);
  const original = originalLink && await tx.transaction.findFirst({
    where: { forecastEventId: originalLink.eventId, deletedAt: null, type: "transfer" },
  });
  if (!original || proposed.accountId !== original.transferToAccountId || proposed.transferToAccountId !== original.accountId) {
    throw new ConflictError("返却元の確定振替と口座を確認してください");
  }
  const facts = await loadFundingFacts(tx, request);
  if (returnedFunding(request, link.returnOf!, facts, link.id) + proposed.amount > original.amount) {
    throw new ConflictError("返却予定合計が確定利用額を超えます");
  }
}

export async function loadFundingFacts(tx: Tx, request: SpendingRequest): Promise<FundingFacts> {
  const [recurring, transactions] = await Promise.all([
    tx.recurringItem.findMany({ where: { id: { in: request.fundingLinks.map(l => l.recurringId) } } }),
    tx.transaction.findMany({ where: { deletedAt: null, forecastEventId: { in: request.fundingLinks.map(l => l.eventId) } } }),
  ]);
  return { recurring, transactions };
}

/** Apply cancellation cleanup on replace imports, including backups made before #583. */
export async function cleanupCancelledSpendingSchedules(tx: Tx, ledger: SpendingLedger) {
  for (const request of ledger.requests.filter(r => r.status === "cancelled" || r.deletedAt)) {
    const facts = await loadFundingFacts(tx, request);
    const ids = request.fundingLinks.filter(link => !link.returnOf &&
      !facts.transactions.some(t => t.forecastEventId === link.eventId)).map(link => link.recurringId);
    await tx.recurringItem.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { enabled: false, deletedAt: new Date() },
    });
  }
}
