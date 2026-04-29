import type { Prisma, PrismaClient, TransactionType } from "./generated/prisma/client.mts";

export type TestPrisma = PrismaClient | Prisma.TransactionClient;

export async function createAccount(
  prisma: TestPrisma,
  data: Partial<Prisma.AccountCreateInput> & Pick<Prisma.AccountCreateInput, "name">,
) {
  return prisma.account.create({
    data: {
      name: data.name,
      balance: data.balance ?? 0,
      balanceOffset: data.balanceOffset ?? 0,
      sortOrder: data.sortOrder ?? 0,
      deletedAt: data.deletedAt ?? null,
    },
  });
}

export async function createRecurringItem(
  prisma: TestPrisma,
  data: {
    name: string;
    type?: "income" | "expense";
    amount?: number;
    dayOfMonth?: number;
    startDate?: Date | null;
    endDate?: Date | null;
    dateShiftPolicy?: "none" | "previous" | "next";
    accountId: string;
    enabled?: boolean;
    sortOrder?: number;
    deletedAt?: Date | null;
  },
) {
  return prisma.recurringItem.create({
    data: {
      name: data.name,
      type: data.type ?? "expense",
      amount: data.amount ?? 0,
      dayOfMonth: data.dayOfMonth ?? 1,
      startDate: data.startDate ?? null,
      endDate: data.endDate ?? null,
      dateShiftPolicy: data.dateShiftPolicy ?? "none",
      accountId: data.accountId,
      enabled: data.enabled ?? true,
      sortOrder: data.sortOrder ?? 0,
      deletedAt: data.deletedAt ?? null,
    },
  });
}

export async function createCreditCard(
  prisma: TestPrisma,
  data: {
    name: string;
    accountId: string;
    settlementDay?: number | null;
    assumptionAmount?: number;
    dateShiftPolicy?: "none" | "previous" | "next";
    sortOrder?: number;
    deletedAt?: Date | null;
  },
) {
  return prisma.creditCard.create({
    data: {
      name: data.name,
      accountId: data.accountId,
      settlementDay: data.settlementDay ?? null,
      assumptionAmount: data.assumptionAmount ?? 10000,
      dateShiftPolicy: data.dateShiftPolicy ?? "none",
      sortOrder: data.sortOrder ?? 0,
      deletedAt: data.deletedAt ?? null,
    },
  });
}

export async function createSubscription(
  prisma: TestPrisma,
  data: {
    name: string;
    amount?: number;
    intervalMonths?: number;
    startDate?: Date;
    dayOfMonth?: number;
    endDate?: Date | null;
    paymentSource?: string | null;
    deletedAt?: Date | null;
  },
) {
  return prisma.subscription.create({
    data: {
      name: data.name,
      amount: data.amount ?? 0,
      intervalMonths: data.intervalMonths ?? 1,
      startDate: data.startDate ?? new Date("2026-01-01T00:00:00.000Z"),
      dayOfMonth: data.dayOfMonth ?? 1,
      endDate: data.endDate ?? null,
      paymentSource: data.paymentSource ?? null,
      deletedAt: data.deletedAt ?? null,
    },
  });
}

export async function createBilling(
  prisma: TestPrisma,
  data: {
    yearMonth: string;
    settlementDate?: Date | null;
    items?: Array<{ creditCardId: string; amount: number }>;
  },
) {
  const billing = await prisma.creditCardBilling.create({
    data: {
      yearMonth: data.yearMonth,
      settlementDate: data.settlementDate ?? null,
    },
  });

  if (data.items?.length) {
    await prisma.creditCardItem.createMany({
      data: data.items.map((item) => ({
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

export async function createLoan(
  prisma: TestPrisma,
  data: {
    name: string;
    totalAmount?: number;
    paymentCount?: number;
    startDate?: Date;
    dateShiftPolicy?: "none" | "previous" | "next";
    accountId: string;
    deletedAt?: Date | null;
  },
) {
  return prisma.loan.create({
    data: {
      name: data.name,
      totalAmount: data.totalAmount ?? 1000,
      paymentCount: data.paymentCount ?? 1,
      startDate: data.startDate ?? new Date("2026-01-01T00:00:00.000Z"),
      dateShiftPolicy: data.dateShiftPolicy ?? "none",
      accountId: data.accountId,
      deletedAt: data.deletedAt ?? null,
    },
  });
}

export async function createTransaction(
  prisma: TestPrisma,
  data: {
    accountId: string;
    transferToAccountId?: string | null;
    forecastEventId?: string | null;
    date?: Date;
    type?: TransactionType;
    description?: string;
    amount?: number;
    deletedAt?: Date | null;
  },
) {
  return prisma.transaction.create({
    data: {
      accountId: data.accountId,
      transferToAccountId: data.transferToAccountId,
      forecastEventId: data.forecastEventId ?? null,
      date: data.date ?? new Date("2026-03-14T00:00:00.000Z"),
      type: data.type ?? "expense",
      description: data.description ?? "Test transaction",
      amount: data.amount ?? 1000,
      deletedAt: data.deletedAt ?? null,
    },
  });
}
