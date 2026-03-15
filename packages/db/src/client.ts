import { PrismaPg } from "@prisma/adapter-pg";

import { Prisma, PrismaClient } from "./generated/prisma/client.mts";

export type CreatePrismaClientOptions = Omit<Prisma.PrismaClientOptions, "adapter" | "accelerateUrl"> & {
  databaseUrl?: string;
};

export function createPrismaAdapter(databaseUrl = process.env.DATABASE_URL) {
  return new PrismaPg(
    databaseUrl
      ? { connectionString: databaseUrl }
      : {},
  );
}

export function createPrismaClient({
  databaseUrl = process.env.DATABASE_URL,
  ...options
}: CreatePrismaClientOptions = {}) {
  return new PrismaClient({
    ...options,
    adapter: createPrismaAdapter(databaseUrl),
  });
}
