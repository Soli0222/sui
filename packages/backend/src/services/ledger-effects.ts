import type { Prisma, TransactionType } from "@sui/db";
import { BadRequestError } from "../lib/http";

type LedgerEntry = {
  accountId?: string | null;
  transferToAccountId?: string | null;
  type: TransactionType;
  amount: number;
};

/** An adjustment already carries its sign; every other amount is positive. */
export function balanceEffects(entry: LedgerEntry): Array<{ accountId: string; delta: number }> {
  if (entry.type === "transfer") {
    return [
      ...(entry.accountId ? [{ accountId: entry.accountId, delta: -entry.amount }] : []),
      ...(entry.transferToAccountId ? [{ accountId: entry.transferToAccountId, delta: entry.amount }] : []),
    ];
  }
  if (!entry.accountId) throw new BadRequestError("Source account not found");
  return [{ accountId: entry.accountId, delta: entry.type === "expense" ? -entry.amount : entry.amount }];
}

export async function applyBalanceEffects(tx: Prisma.TransactionClient, entry: LedgerEntry, direction: 1 | -1 = 1) {
  for (const { accountId, delta } of balanceEffects(entry)) {
    await tx.account.update({ where: { id: accountId }, data: { balance: { increment: delta * direction } } });
  }
}
