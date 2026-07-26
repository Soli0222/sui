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
import { BadRequestError, ConflictError, NotFoundError } from "../lib/http";
import { fromDateOnlyString } from "../lib/dates";

type UpsertSplitInput = CreateSplitPayload;

type PrismaShareWithAllocations = Prisma.SplitShareGetPayload<{
  include: { allocations: true; person: true; split: true };
}>;

type PrismaSplitWithShares = Prisma.TransactionSplitGetPayload<{
  include: { shares: { include: { allocations: true; person: true } } };
}>;

export async function createSplit(
  prisma: PrismaClient,
  input: UpsertSplitInput,
): Promise<SplitResponse> {
  return prisma.$transaction(async (tx) => {
    const { date, description, memo, amount, method, ownRatio, shares: memberInputs } = validateInput(input);

    const personIds = memberInputs.map((share) => share.personId);
    const people = await tx.person.findMany({
      where: { id: { in: personIds }, deletedAt: null },
    });
    if (people.length !== personIds.length) {
      throw new BadRequestError("One or more persons not found");
    }

    const calculated = calculateShareAmounts(amount, method, ownRatio, memberInputs);

    const split = await tx.transactionSplit.create({
      data: {
        date,
        description,
        memo,
        amount,
        method,
        ownRatio,
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

export async function getSplit(prisma: PrismaClient, id: string): Promise<SplitResponse | null> {
  const split = await prisma.transactionSplit.findUnique({
    where: { id },
    include: {
      shares: { include: { person: true, allocations: true } },
    },
  });
  if (!split) {
    return null;
  }
  return buildSplitResponse(split);
}

export async function updateSplit(
  prisma: PrismaClient,
  id: string,
  input: UpsertSplitInput,
): Promise<SplitResponse> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.transactionSplit.findUnique({
      where: { id },
      include: { shares: { include: { allocations: true } } },
    });
    if (!existing) {
      throw new NotFoundError("Split not found");
    }
    if (existing.shares.some((share) => share.allocations.length > 0)) {
      throw new ConflictError("Cannot edit split with existing settlements");
    }

    const { date, description, memo, amount, method, ownRatio, shares: memberInputs } = validateInput(input);

    const personIds = memberInputs.map((share) => share.personId);
    const people = await tx.person.findMany({
      where: { id: { in: personIds }, deletedAt: null },
    });
    if (people.length !== personIds.length) {
      throw new BadRequestError("One or more persons not found");
    }

    const calculated = calculateShareAmounts(amount, method, ownRatio, memberInputs);

    await tx.splitShare.deleteMany({ where: { splitId: id } });
    const split = await tx.transactionSplit.update({
      where: { id },
      data: {
        date,
        description,
        memo,
        amount,
        method,
        ownRatio,
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

export async function deleteSplit(prisma: PrismaClient, id: string): Promise<void> {
  return prisma.$transaction(async (tx) => {
    const split = await tx.transactionSplit.findUnique({
      where: { id },
      include: { shares: { include: { allocations: true } } },
    });
    if (!split) {
      throw new NotFoundError("Split not found");
    }
    if (split.shares.some((share) => share.allocations.length > 0)) {
      throw new ConflictError("Cannot delete split with existing settlements");
    }
    await tx.transactionSplit.delete({ where: { id } });
  });
}

export async function listSplits(
  prisma: PrismaClient,
  filters: { status?: SplitStatus; personId?: string; from?: string; to?: string } = {},
): Promise<SplitsResponse> {
  const where: Prisma.TransactionSplitWhereInput = {};

  if (filters.personId) {
    where.shares = { some: { personId: filters.personId } };
  }

  if (filters.from || filters.to) {
    where.date = {
      ...(filters.from ? { gte: parseDateOnly(filters.from) } : {}),
      ...(filters.to ? { lte: parseDateOnly(filters.to) } : {}),
    };
  }

  const splits = await prisma.transactionSplit.findMany({
    where,
    include: {
      shares: { include: { person: true, allocations: true } },
    },
    orderBy: { date: "desc" },
  });

  const items = splits.map((split) => buildSplitListItem(split));

  if (filters.status && filters.status !== "none") {
    return items.filter((item) => item.status === filters.status);
  }

  return items;
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
      throw new BadRequestError("Sum of share amounts exceeds total amount");
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

function validateInput(input: UpsertSplitInput) {
  const date = fromDateOnlyString(input.date);
  const description = input.description.trim();
  if (!description) {
    throw new BadRequestError("Description is required");
  }
  if (input.amount < 1) {
    throw new BadRequestError("Amount must be positive");
  }
  const memo = input.memo?.trim() || null;
  if (memo && memo.length > 200) {
    throw new BadRequestError("Memo must be at most 200 characters");
  }
  if (input.shares.length === 0) {
    throw new BadRequestError("At least one member is required");
  }
  const personIds = input.shares.map((share) => share.personId);
  const uniquePersonIds = new Set(personIds);
  if (uniquePersonIds.size !== personIds.length) {
    throw new BadRequestError("Duplicate person in split shares");
  }
  const ownRatio = input.ownRatio ?? null;
  return { ...input, date, description, memo, ownRatio };
}

function buildShareItem(share: PrismaShareWithAllocations): SplitShareItem {
  const settledAmount = share.allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
  return {
    id: share.id,
    splitId: share.splitId,
    splitDescription: share.split.description,
    splitDate: share.split.date.toISOString().slice(0, 10),
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
  const shares = split.shares.map((share) =>
    buildShareItem({ ...share, split } as unknown as PrismaShareWithAllocations),
  );
  return {
    split: {
      id: split.id,
      date: split.date.toISOString().slice(0, 10),
      description: split.description,
      memo: split.memo,
      amount: split.amount,
      method: split.method as SplitMethod,
      ownRatio: split.ownRatio,
      createdAt: split.createdAt.toISOString(),
      updatedAt: split.updatedAt.toISOString(),
    },
    shares,
  };
}

function buildSplitListItem(split: PrismaSplitWithShares): SplitListItem {
  const shares = split.shares.map((share) =>
    buildShareItem({ ...share, split } as unknown as PrismaShareWithAllocations),
  );
  const totalMemberAmount = shares.reduce((sum, share) => sum + share.amount, 0);
  const ownShare = split.amount - totalMemberAmount;
  const { status } = computeSplitStatus(
    shares.map((share) => ({ amount: share.amount, allocations: [{ amount: share.settledAmount }] })),
  );

  return {
    id: split.id,
    date: split.date.toISOString().slice(0, 10),
    description: split.description,
    memo: split.memo,
    amount: split.amount,
    method: split.method as SplitMethod,
    ownRatio: split.ownRatio,
    ownShare,
    status,
    shares,
    createdAt: split.createdAt.toISOString(),
    updatedAt: split.updatedAt.toISOString(),
  };
}

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
