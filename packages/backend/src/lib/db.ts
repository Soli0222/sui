import { PrismaClient, createPrismaClient } from "@sui/db";

declare global {
  var __suiPrisma__: PrismaClient | undefined;
}

export const prisma =
  globalThis.__suiPrisma__ ??
  createPrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__suiPrisma__ = prisma;
}
