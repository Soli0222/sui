import type { PrismaClient, Prisma } from "@sui/db";
import type { CreateSettlementPayload, SettlementListItem, SettlementsResponse } from "@sui/shared";
import { BadRequestError, NotFoundError } from "../lib/http";
import { fromDateOnlyString, isDateString } from "../lib/dates";

export async function createSettlement(
  prisma: PrismaClient,
  input: CreateSettlementPayload,
): Promise<SettlementListItem> {
  return prisma.$transaction(async (tx) => {
    const person = await tx.person.findFirst({
      where: { id: input.personId, deletedAt: null },
    });
    if (!person) {
      throw new BadRequestError("Person not found");
    }

    if (input.allocations.length === 0) {
      throw new BadRequestError("At least one allocation is required");
    }

    const shareIds = input.allocations.map((allocation) => allocation.shareId);
    const uniqueShareIds = new Set(shareIds);
    if (uniqueShareIds.size !== shareIds.length) {
      throw new BadRequestError("Duplicate share in allocations");
    }

    const shares = await tx.splitShare.findMany({
      where: { id: { in: shareIds } },
      include: { person: true, split: { include: { transaction: { include: { account: true, transferToAccount: true } } } }, allocations: true },
    });
    if (shares.length !== shareIds.length) {
      throw new BadRequestError("One or more shares not found");
    }

    const currencyCode = shares[0]?.split.transaction.account?.currencyCode ?? null;
    for (const share of shares) {
      if (share.personId !== input.personId) {
        throw new BadRequestError("Share does not belong to the specified person");
      }
      const shareCurrency = share.split.transaction.account?.currencyCode ?? null;
      if (shareCurrency !== currencyCode) {
        throw new BadRequestError("All allocations must be in the same currency");
      }
    }

    let transactionDate: Date;

    if (input.kind === "transaction") {
      if (!input.transactionId) {
        throw new BadRequestError("transactionId is required for transaction settlement");
      }
      const transaction = await tx.transaction.findUnique({
        where: { id: input.transactionId },
        include: { account: true, transferToAccount: true },
      });
      if (!transaction || transaction.deletedAt) {
        throw new BadRequestError("Transaction not found");
      }

      if (transaction.type === "income") {
        if (!transaction.accountId) {
          throw new BadRequestError("Income transaction must have an account");
        }
      } else if (transaction.type === "transfer") {
        if (transaction.accountId) {
          throw new BadRequestError("Settlement can only be linked to transfers with no source account");
        }
        if (!transaction.transferToAccountId) {
          throw new BadRequestError("Transfer must have a destination account");
        }
      } else {
        throw new BadRequestError("Settlement can only be linked to income or sourceless transfer transactions");
      }

      const transactionCurrency =
        transaction.type === "transfer"
          ? transaction.transferToAccount?.currencyCode
          : transaction.account?.currencyCode;
      if (transactionCurrency !== currencyCode) {
        throw new BadRequestError("Transaction currency does not match share currency");
      }

      transactionDate = transaction.date;

      const existingAllocations = await tx.settlementAllocation.aggregate({
        where: { settlement: { transactionId: input.transactionId } },
        _sum: { amount: true },
      });
      const existingAmount = existingAllocations._sum.amount ?? 0;
      const newAmount = input.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
      if (existingAmount + newAmount > transaction.amount) {
        throw new BadRequestError("Settlement allocations exceed transaction amount");
      }
    } else {
      if (!input.date || !isDateString(input.date)) {
        throw new BadRequestError("date is required for offset settlement");
      }
      transactionDate = fromDateOnlyString(input.date);
    }

    for (const allocation of input.allocations) {
      const share = shares.find((s) => s.id === allocation.shareId);
      if (!share) {
        throw new BadRequestError("Share not found");
      }
      const settled = share.allocations.reduce((sum, a) => sum + a.amount, 0);
      if (allocation.amount <= 0) {
        throw new BadRequestError("Allocation amount must be positive");
      }
      if (settled + allocation.amount > share.amount) {
        throw new BadRequestError("Allocation exceeds remaining share amount");
      }
    }

    const settlement = await tx.settlement.create({
      data: {
        kind: input.kind,
        personId: input.personId,
        transactionId: input.transactionId ?? null,
        date: transactionDate,
        note: input.note ?? null,
        allocations: {
          create: input.allocations.map((allocation) => ({
            shareId: allocation.shareId,
            amount: allocation.amount,
          })),
        },
      },
      include: {
        person: true,
        transaction: true,
        allocations: true,
      },
    });

    return buildSettlementListItem(settlement);
  });
}

export async function deleteSettlement(prisma: PrismaClient, id: string): Promise<void> {
  return prisma.$transaction(async (tx) => {
    const settlement = await tx.settlement.findUnique({ where: { id } });
    if (!settlement) {
      throw new NotFoundError("Settlement not found");
    }
    await tx.settlement.delete({ where: { id } });
  });
}

export async function listSettlements(
  prisma: PrismaClient,
  filters: { personId?: string; transactionId?: string } = {},
): Promise<SettlementsResponse> {
  const where: Prisma.SettlementWhereInput = {};
  if (filters.personId) {
    where.personId = filters.personId;
  }
  if (filters.transactionId) {
    where.transactionId = filters.transactionId;
  }

  const settlements = await prisma.settlement.findMany({
    where,
    include: { person: true, transaction: true, allocations: true },
    orderBy: { date: "desc" },
  });

  return settlements.map((settlement) => buildSettlementListItem(settlement));
}

export async function getSettlement(prisma: PrismaClient, id: string): Promise<SettlementListItem | null> {
  const settlement = await prisma.settlement.findUnique({
    where: { id },
    include: { person: true, transaction: true, allocations: true },
  });
  if (!settlement) {
    return null;
  }
  return buildSettlementListItem(settlement);
}

function buildSettlementListItem(
  settlement: Prisma.SettlementGetPayload<{ include: { person: true; transaction: true; allocations: true } }>,
): SettlementListItem {
  return {
    id: settlement.id,
    kind: settlement.kind,
    personId: settlement.personId,
    personName: settlement.person.name,
    transactionId: settlement.transactionId,
    transactionDescription: settlement.transaction?.description ?? null,
    date: settlement.date.toISOString().slice(0, 10),
    note: settlement.note,
    createdAt: settlement.createdAt.toISOString(),
    allocations: settlement.allocations.map((allocation) => ({
      id: allocation.id,
      settlementId: allocation.settlementId,
      shareId: allocation.shareId,
      amount: allocation.amount,
    })),
  };
}
