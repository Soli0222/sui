import type { PrismaClient, Prisma } from "@sui/db";
import type {
  CreateSplitPayload,
  SettlementAllocation,
  SplitListItem,
  SplitMethod,
  SplitResponse,
  SplitShareItem,
  SplitStatus,
  SplitsResponse,
} from "@sui/shared";
import { BadRequestError, ConflictError } from "../lib/http";

type UpsertSplitInput = CreateSplitPayload;

type PrismaSplitWithShares = Prisma.TransactionSplitGetPayload<{
  include: { shares: { include: { person: true; allocations: true } } };
}>;

type PrismaSplitWithTransaction = Prisma.TransactionSplitGetPayload<{
  include: {
    transaction: { include: { account: true } };
    shares: { include: { person: true; allocations: true } };
  };
}>;

type PrismaShareWithAllocations = Prisma.SplitShareGetPayload<{ include: { allocations: true; person: true } }>;

export async function setTransactionSplit(
  prisma: PrismaClient,
  transactionId: string,
  input: UpsertSplitInput,
): Promise<SplitResponse> {
  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: { account: true },
    });
    if (!transaction || transaction.deletedAt) {
      throw new BadRequestError("Transaction not found");
    }
    if (transaction.type !== "expense") {
      throw new BadRequestError("Splits are only allowed for expense transactions");
    }

    const existingSplit = await tx.transactionSplit.findUnique({
      where: { transactionId },
      include: { shares: { include: { allocations: true } } },
    });
    if (existingSplit?.shares.some((share) => share.allocations.length > 0)) {
      throw new ConflictError("Cannot edit split with existing settlements");
    }

    const memberInputs = input.shares;
    if (memberInputs.length === 0) {
      throw new BadRequestError("At least one member is required");
    }

    const personIds = memberInputs.map((share) => share.personId);
    const uniquePersonIds = new Set(personIds);
    if (uniquePersonIds.size !== personIds.length) {
      throw new BadRequestError("Duplicate person in split shares");
    }

    const people = await tx.person.findMany({
      where: { id: { in: personIds }, deletedAt: null },
    });
    if (people.length !== personIds.length) {
      throw new BadRequestError("One or more persons not found");
    }

    const calculated = calculateShareAmounts(transaction.amount, input.method, input.ownRatio ?? null, memberInputs);

    if (existingSplit) {
      await tx.transactionSplit.delete({ where: { id: existingSplit.id } });
    }

    const split = await tx.transactionSplit.create({
      data: {
        transactionId,
        method: input.method,
        ownRatio: input.ownRatio ?? null,
        shares: {
          create: calculated.map((share) => ({
            personId: share.personId,
            ratio: share.ratio,
            amount: share.amount,
          })),
        },
      },
      include: {
        shares: { include: { person: true, allocations: true } },
      },
    });

    return buildSplitResponse(split);
  });
}

export async function getTransactionSplit(
  prisma: PrismaClient,
  transactionId: string,
): Promise<SplitResponse | null> {
  const split = await prisma.transactionSplit.findUnique({
    where: { transactionId },
    include: {
      transaction: { include: { account: true } },
      shares: { include: { person: true, allocations: true } },
    },
  });
  if (!split) {
    return null;
  }
  return buildSplitResponse(split);
}

export async function deleteTransactionSplit(prisma: PrismaClient, transactionId: string): Promise<void> {
  return prisma.$transaction(async (tx) => {
    const split = await tx.transactionSplit.findUnique({
      where: { transactionId },
      include: { shares: { include: { allocations: true } } },
    });
    if (!split) {
      return;
    }
    if (split.shares.some((share) => share.allocations.length > 0)) {
      throw new ConflictError("Cannot delete split with existing settlements");
    }
    await tx.transactionSplit.delete({ where: { id: split.id } });
  });
}

export async function listSplits(
  prisma: PrismaClient,
  filters: { status?: SplitStatus; personId?: string; from?: string; to?: string } = {},
): Promise<SplitsResponse> {
  const where: Prisma.TransactionSplitWhereInput = {
    transaction: { deletedAt: null },
  };

  if (filters.personId) {
    where.shares = { some: { personId: filters.personId } };
  }

  if (filters.from || filters.to) {
    where.transaction = {
      deletedAt: null,
      date: {
        ...(filters.from ? { gte: parseDateOnly(filters.from) } : {}),
        ...(filters.to ? { lte: parseDateOnly(filters.to) } : {}),
      },
    };
  }

  const splits = await prisma.transactionSplit.findMany({
    where,
    include: {
      transaction: { include: { account: true } },
      shares: { include: { person: true, allocations: true } },
    },
    orderBy: { transaction: { date: "desc" } },
  });

  const items = splits.map((split) => buildSplitListItem(split));

  if (filters.status && filters.status !== "none") {
    return items.filter((item) => item.status === filters.status);
  }

  return items;
}

export async function getSplitStatusForTransaction(
  prisma: PrismaClient,
  transactionId: string,
): Promise<SplitStatus> {
  const split = await prisma.transactionSplit.findUnique({
    where: { transactionId },
    include: { shares: { include: { allocations: true } } },
  });
  if (!split) {
    return "none";
  }
  return computeSplitStatus(split.shares).status;
}

export async function updateSplitAmountsForTransactionChange(
  tx: Prisma.TransactionClient,
  transactionId: string,
  newAmount: number,
): Promise<void> {
  const split = await tx.transactionSplit.findUnique({
    where: { transactionId },
    include: { shares: { include: { allocations: true } } },
  });
  if (!split) {
    return;
  }

  if (split.method === "amount") {
    const totalShares = split.shares.reduce((sum, share) => sum + share.amount, 0);
    if (newAmount < totalShares) {
      throw new BadRequestError("New amount is less than sum of split shares");
    }
    return;
  }

  const memberInputs = split.shares.map((share) => ({
    personId: share.personId,
    ratio: share.ratio,
    amount: share.amount,
  }));
  const calculated = calculateShareAmounts(
    newAmount,
    split.method as SplitMethod,
    split.ownRatio,
    memberInputs,
  );

  for (let i = 0; i < split.shares.length; i++) {
    const share = split.shares[i];
    const settled = share.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
    if (calculated[i].amount < settled) {
      throw new BadRequestError("New amount would make a settled share negative");
    }
  }

  await Promise.all(
    split.shares.map((share, index) =>
      tx.splitShare.update({
        where: { id: share.id },
        data: { amount: calculated[index].amount },
      }),
    ),
  );
}

export function calculateShareAmounts(
  totalAmount: number,
  method: SplitMethod,
  ownRatio: number | null,
  memberInputs: UpsertSplitInput["shares"],
): Array<{ personId: string; ratio: number | null; amount: number }> {
  if (method === "amount") {
    let sum = 0;
    const result: Array<{ personId: string; ratio: number | null; amount: number }> = [];
    for (const input of memberInputs) {
      if (input.amount === undefined) {
        throw new BadRequestError("amount is required for amount method");
      }
      if (input.amount < 1) {
        throw new BadRequestError("Share amount must be at least 1");
      }
      sum += input.amount;
      result.push({ personId: input.personId, ratio: null, amount: input.amount });
    }
    if (sum > totalAmount) {
      throw new BadRequestError("Sum of share amounts exceeds transaction amount");
    }
    return result;
  }

  const memberCount = memberInputs.length;
  const n = memberCount + 1;

  if (method === "equal") {
    const base = Math.floor(totalAmount / n);
    const totalMember = base * memberCount;
    if (totalMember > totalAmount) {
      throw new BadRequestError("Split amount calculation overflow");
    }
    return memberInputs.map((input) => ({ personId: input.personId, ratio: null, amount: base }));
  }

  if (method === "ratio") {
    if (ownRatio === null || ownRatio < 1) {
      throw new BadRequestError("ownRatio is required and must be positive for ratio method");
    }
    let memberWeightSum = 0;
    const memberWeights: number[] = [];
    for (const input of memberInputs) {
      if (input.ratio === undefined || input.ratio === null || input.ratio < 1) {
        throw new BadRequestError("ratio is required and must be positive for ratio method");
      }
      memberWeights.push(input.ratio);
      memberWeightSum += input.ratio;
    }
    const totalWeight = ownRatio + memberWeightSum;
    let memberAmountSum = 0;
    const result: Array<{ personId: string; ratio: number | null; amount: number }> = [];
    for (let i = 0; i < memberInputs.length; i++) {
      const amount = Math.floor((totalAmount * memberWeights[i]) / totalWeight);
      memberAmountSum += amount;
      result.push({ personId: memberInputs[i].personId, ratio: memberWeights[i], amount });
    }
    if (memberAmountSum > totalAmount) {
      throw new BadRequestError("Split amount calculation overflow");
    }
    return result;
  }

  throw new BadRequestError("Unsupported split method");
}

export function computeSplitStatus(
  shares: Array<{ amount: number; allocations: Pick<SettlementAllocation, "amount">[] }>,
): { status: Exclude<SplitStatus, "none">; totalAmount: number; settledAmount: number } {
  const totalAmount = shares.reduce((sum, share) => sum + share.amount, 0);
  const settledAmount = shares.reduce(
    (sum, share) => sum + share.allocations.reduce((a, allocation) => a + allocation.amount, 0),
    0,
  );

  if (settledAmount === 0) {
    return { status: "unsettled", totalAmount, settledAmount };
  }
  if (settledAmount >= totalAmount) {
    return { status: "settled", totalAmount, settledAmount };
  }
  return { status: "partial", totalAmount, settledAmount };
}

export function getShareStatus(share: { amount: number; allocations: Pick<SettlementAllocation, "amount">[] }): Exclude<SplitStatus, "none"> {
  const settled = share.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  if (settled === 0) {
    return "unsettled";
  }
  if (settled >= share.amount) {
    return "settled";
  }
  return "partial";
}

function buildShareItem(share: PrismaShareWithAllocations): SplitShareItem {
  const settledAmount = share.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  return {
    id: share.id,
    splitId: share.splitId,
    personId: share.personId,
    personName: share.person.name,
    ratio: share.ratio,
    amount: share.amount,
    settledAmount,
    remainingAmount: Math.max(0, share.amount - settledAmount),
    status: getShareStatus(share),
  };
}

function buildSplitResponse(split: PrismaSplitWithShares): SplitResponse {
  const shares = split.shares.map((share) => buildShareItem(share));
  return {
    split: {
      id: split.id,
      transactionId: split.transactionId,
      method: split.method as SplitMethod,
      ownRatio: split.ownRatio,
      createdAt: split.createdAt.toISOString(),
      updatedAt: split.updatedAt.toISOString(),
    },
    shares,
  };
}

function buildSplitListItem(split: PrismaSplitWithTransaction): SplitListItem {
  const transaction = split.transaction;
  const shares = split.shares.map((share) => buildShareItem(share));
  const totalMemberAmount = shares.reduce((sum, share) => sum + share.amount, 0);
  const ownShare = transaction.amount - totalMemberAmount;
  const { status } = computeSplitStatus(
    shares.map((share) => ({ amount: share.amount, allocations: [{ amount: share.settledAmount }] })),
  );

  return {
    transactionId: transaction.id,
    date: transaction.date.toISOString().slice(0, 10),
    description: transaction.description,
    amount: transaction.amount,
    currencyCode: transaction.account
      ? (transaction.account.currencyCode.toUpperCase() as SplitListItem["currencyCode"])
      : "JPY",
    ownShare,
    status,
    shares,
  };
}

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
