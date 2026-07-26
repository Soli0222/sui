import type { PrismaClient } from "@sui/db";
import type { Person } from "@sui/shared";

type PersonCreateInput = {
  name: string;
  memo?: string | null;
  sortOrder?: number;
};

type PrismaPerson = Awaited<ReturnType<PrismaClient["person"]["create"]>>;

export async function listPeople(
  prisma: PrismaClient,
  { includeDeleted = false }: { includeDeleted?: boolean } = {},
): Promise<Person[]> {
  const people = await prisma.person.findMany({
    where: includeDeleted ? undefined : { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return people.map(serializePerson);
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
  });
  if (!existing) {
    return null;
  }

  const person = await prisma.person.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
  return serializePerson(person);
}

function serializePerson(person: PrismaPerson): Person {
  return {
    id: person.id,
    name: person.name,
    memo: person.memo,
    sortOrder: person.sortOrder,
    outstandingAmount: {},
    deletedAt: person.deletedAt?.toISOString() ?? null,
    createdAt: person.createdAt.toISOString(),
    updatedAt: person.updatedAt.toISOString(),
  };
}
