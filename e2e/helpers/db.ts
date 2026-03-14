import { PrismaClient } from "@prisma/client";
import { DEFAULT_SETTINGS } from "@sui/shared";

const TEST_DATABASE_URL = "postgresql://sui_test:sui_test@localhost:5555/sui_test";

process.env.DATABASE_URL ??= TEST_DATABASE_URL;

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
});

export async function resetDatabase() {
  await prisma.$transaction([
    prisma.transaction.deleteMany(),
    prisma.creditCardItem.deleteMany(),
    prisma.creditCardBilling.deleteMany(),
    prisma.recurringItem.deleteMany(),
    prisma.creditCard.deleteMany(),
    prisma.loan.deleteMany(),
    prisma.account.deleteMany(),
    prisma.setting.deleteMany(),
  ]);

  await Promise.all(
    Object.entries(DEFAULT_SETTINGS).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      }),
    ),
  );
}

export async function seedAccount(overrides: {
  name?: string;
  balance?: number;
  sortOrder?: number;
}) {
  return prisma.account.create({
    data: {
      name: overrides.name ?? "Main Account",
      balance: overrides.balance ?? 0,
      sortOrder: overrides.sortOrder ?? 0,
    },
  });
}

export async function seedRecurringItem(overrides: {
  name?: string;
  type?: "income" | "expense";
  amount?: number;
  dayOfMonth?: number;
  startDate?: Date | null;
  endDate?: Date | null;
  accountId: string;
  enabled?: boolean;
  sortOrder?: number;
}) {
  return prisma.recurringItem.create({
    data: {
      name: overrides.name ?? "Recurring Item",
      type: overrides.type ?? "expense",
      amount: overrides.amount ?? 1000,
      dayOfMonth: overrides.dayOfMonth ?? 1,
      startDate: overrides.startDate ?? null,
      endDate: overrides.endDate ?? null,
      accountId: overrides.accountId,
      enabled: overrides.enabled ?? true,
      sortOrder: overrides.sortOrder ?? 0,
    },
  });
}

export async function seedCreditCard(overrides: {
  name?: string;
  settlementDay?: number | null;
  accountId: string;
  assumptionAmount?: number;
  sortOrder?: number;
}) {
  return prisma.creditCard.create({
    data: {
      name: overrides.name ?? "Credit Card",
      settlementDay: overrides.settlementDay ?? 27,
      accountId: overrides.accountId,
      assumptionAmount: overrides.assumptionAmount ?? 10000,
      sortOrder: overrides.sortOrder ?? 0,
    },
  });
}

export async function seedLoan(overrides: {
  name?: string;
  totalAmount?: number;
  startDate?: Date;
  paymentCount?: number;
  accountId: string;
}) {
  return prisma.loan.create({
    data: {
      name: overrides.name ?? "Loan",
      totalAmount: overrides.totalAmount ?? 120000,
      startDate: overrides.startDate ?? new Date("2026-03-20T00:00:00.000Z"),
      paymentCount: overrides.paymentCount ?? 12,
      accountId: overrides.accountId,
    },
  });
}

export async function seedBilling(
  yearMonth: string,
  items: Array<{ creditCardId: string; amount: number }>,
  settlementDate?: Date | null,
) {
  const billing = await prisma.creditCardBilling.create({
    data: {
      yearMonth,
      settlementDate: settlementDate ?? null,
    },
  });

  if (items.length > 0) {
    await prisma.creditCardItem.createMany({
      data: items.map((item) => ({
        billingId: billing.id,
        creditCardId: item.creditCardId,
        amount: item.amount,
      })),
    });
  }

  return prisma.creditCardBilling.findUniqueOrThrow({
    where: { id: billing.id },
    include: { items: true },
  });
}

export async function seedTransaction(overrides: {
  accountId: string;
  transferToAccountId?: string | null;
  forecastEventId?: string | null;
  date?: Date;
  type?: "income" | "expense" | "transfer";
  description?: string;
  amount?: number;
}) {
  return prisma.transaction.create({
    data: {
      accountId: overrides.accountId,
      transferToAccountId: overrides.transferToAccountId,
      forecastEventId: overrides.forecastEventId ?? null,
      date: overrides.date ?? new Date("2026-03-14T00:00:00.000Z"),
      type: overrides.type ?? "expense",
      description: overrides.description ?? "Test transaction",
      amount: overrides.amount ?? 1000,
    },
  });
}
