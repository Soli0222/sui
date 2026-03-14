import { PrismaClient } from "@prisma/client";

export const testPrisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});

export async function cleanDatabase() {
  await testPrisma.$transaction([
    testPrisma.transaction.deleteMany(),
    testPrisma.creditCardItem.deleteMany(),
    testPrisma.creditCardBilling.deleteMany(),
    testPrisma.recurringItem.deleteMany(),
    testPrisma.creditCard.deleteMany(),
    testPrisma.loan.deleteMany(),
    testPrisma.account.deleteMany(),
    testPrisma.setting.deleteMany(),
  ]);
}

export async function resetDatabase() {
  await cleanDatabase();
}
