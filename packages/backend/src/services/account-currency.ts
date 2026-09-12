import type { Prisma } from "@sui/db";
import { BadRequestError } from "../lib/http";
import { normalizeCurrencyCode } from "../lib/currency";

export async function assertRecurringTransferCurrency(tx: Prisma.TransactionClient, accountId: string, currencyCode: string) {
  const transfers = await tx.recurringItem.findMany({
    where: { deletedAt: null, type: "transfer", OR: [{ accountId }, { transferToAccountId: accountId }] },
    include: { account: true, transferToAccount: true },
  });
  for (const transfer of transfers) {
    const other = transfer.accountId === accountId ? transfer.transferToAccount : transfer.account;
    if (other && normalizeCurrencyCode(other.currencyCode) !== currencyCode) {
      throw new BadRequestError("Currency change would invalidate a recurring transfer; update or remove the transfer first");
    }
  }
}
