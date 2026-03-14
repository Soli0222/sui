import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __suiPrisma__: PrismaClient | undefined;
}

export const prisma =
  globalThis.__suiPrisma__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__suiPrisma__ = prisma;
}

