import type { PrismaClient, Prisma } from "@sui/db";
import type { Person, PersonSummaryResponse, SettlementListItem, SplitShareItem } from "@sui/shared";
import { ConflictError } from "../lib/http";
import { getShareStatus } from "./splits";

type PersonCreateInput = {
  name: string;
  memo?: string | null;
  sortOrder?: number;
};

type PrismaPerson = Awaited<ReturnType<PrismaClient["person"]["create"]>>;

type PrismaShare = Prisma.SplitShareGetPayload<{
  include: { person: true; allocations: true; split: true };
}>;

type PrismaSettlement = Prisma.SettlementGetPayload<{
  include: { person: true; transaction: true; allocations: true };
}>;

type PersonWithOptionalShares = PrismaPerson & { shares?: PrismaShare[] };

export async function listPeople(
  prisma: PrismaClient,
  { includeDeleted = false }: { includeDeleted?: boolean } = {},
): Promise<Person[]> {
  const people = await prisma.person.findMany({
    where: includeDeleted ? undefined : { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      shares: {
        include: {
          person: true,
          allocations: true,
          split: true,
        },
      },
    },
  });
  return people.map((person) => serializePerson(person));
}

export async function createPerson(prisma: PrismaClient, input: PersonCreateInput): Promise<Person> {
  const person = await prisma.person.create({
    data: {
      name: input.name,
      memo: input.memo ?? null,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  return serializePerson(person);
}

export async function updatePerson(
  prisma: PrismaClient,
  id: string,
  input: PersonCreateInput,
): Promise<Person | null> {
  const existing = await prisma.person.findFirst({
    where: { id, deletedAt: null },
  });
  if (!existing) {
    return null;
  }

  const person = await prisma.person.update({
    where: { id },
    data: {
      name: input.name,
      memo: input.memo ?? null,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  return serializePerson(person);
}

export async function deletePerson(prisma: PrismaClient, id: string): Promise<Person | null> {
  const existing = await prisma.person.findFirst({
    where: { id, deletedAt: null },
    include: {
      shares: { include: { allocations: true } },
    },
  });
  if (!existing) {
    return null;
  }

  const outstanding = calculateOutstandingForShares(existing.shares as unknown as PrismaShare[]);
  if (outstanding > 0) {
    throw new ConflictError("Cannot delete person with outstanding balance");
  }

  const person = await prisma.person.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  return serializePerson(person);
}

export async function getPersonSummary(prisma: PrismaClient, id: string): Promise<PersonSummaryResponse | null> {
  const person = await prisma.person.findUnique({
    where: { id },
    include: {
      shares: {
        include: {
          person: true,
          allocations: true,
          split: true,
        },
      },
      settlements: {
        include: { allocations: true, transaction: true },
        orderBy: { date: "desc" },
      },
    },
  });
  if (!person) {
    return null;
  }

  return {
    person: serializePerson(person),
    outstandingAmount: { JPY: calculateOutstandingForShares((person.shares as unknown as PrismaShare[]) ?? []) },
    shares: ((person.shares as unknown as PrismaShare[]) ?? []).map(buildSplitShareItem),
    settlements: person.settlements.map((settlement) =>
      buildSettlementListItem(settlement as unknown as PrismaSettlement),
    ),
  };
}

function calculateOutstandingForShares(
  shares: Array<{ amount: number; allocations: Array<{ amount: number }> }>,
): number {
  return shares.reduce((sum, share) => {
    const settled = share.allocations.reduce((s, allocation) => s + allocation.amount, 0);
    return sum + Math.max(0, share.amount - settled);
  }, 0);
}

function serializePerson(person: PersonWithOptionalShares): Person {
  const outstanding = person.shares ? calculateOutstandingForShares(person.shares) : 0;
  return {
    id: person.id,
    name: person.name,
    memo: person.memo,
    sortOrder: person.sortOrder,
    outstandingAmount: { JPY: outstanding },
    deletedAt: person.deletedAt?.toISOString() ?? null,
    createdAt: person.createdAt.toISOString(),
    updatedAt: person.updatedAt.toISOString(),
  };
}

function buildSplitShareItem(share: PrismaShare): SplitShareItem {
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

function buildSettlementListItem(settlement: PrismaSettlement): SettlementListItem {
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
