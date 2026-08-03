import * as readline from "node:readline";
import { createPrismaClient } from "@sui/db";
import {
  createAccount,
  createBilling,
  createCreditCard,
  createDonation,
  createLoan,
  createRecurringItem,
  createSalaryRecord,
  createSubscription,
  createTransaction,
  resetDatabaseForE2e,
} from "@sui/db/testing";

type DbCommand =
  | { action: "resetDatabase" }
  | {
    action: "seedAccount";
    payload: {
      name?: string;
      balance?: number;
      balanceOffset?: number;
      currencyCode?: string;
      exchangeRateToJpy?: number;
      sortOrder?: number;
    };
  }
  | {
    action: "seedRecurringItem";
    payload: {
      name?: string;
      type?: "income" | "expense" | "transfer";
      amount?: number;
      dayOfMonth?: number;
      startDate?: string | null;
      endDate?: string | null;
      accountId?: string | null;
      transferToAccountId?: string | null;
      enabled?: boolean;
      sortOrder?: number;
    };
  }
  | {
    action: "seedSubscription";
    payload: {
      name?: string;
      amount?: number;
      currencyCode?: string;
      exchangeRateToJpy?: number;
      interval?: number;
      startDate?: string;
      dayOfMonth?: number;
      endDate?: string | null;
      paymentSource?: string | null;
    };
  }
  | {
    action: "seedSalary";
    payload: {
      paidOn?: string;
      kind?: "salary" | "bonus";
      name?: string | null;
      grossAmount?: number;
      healthInsurance?: number;
      pensionInsurance?: number;
      employmentInsurance?: number;
      childcareSupportLevy?: number;
      incomeTax?: number;
      residentTax?: number;
      yearEndTaxAdjustment?: number;
      employeeStockContribution?: number;
      employeeStockIncentive?: number;
      dcMatchingContribution?: number;
      otherDeductions?: number;
    };
  }
  | {
    action: "seedDonation";
    payload: {
      recipient?: string;
      amount?: number;
      memo?: string | null;
      donatedOn?: string;
    };
  }
  | {
    action: "seedCreditCard";
    payload: {
      name?: string;
      settlementDay?: number | null;
      accountId: string;
      assumptionAmount?: number;
      sortOrder?: number;
    };
  }
  | {
    action: "seedLoan";
    payload: {
      name?: string;
      totalAmount?: number;
      startDate?: string;
      paymentCount?: number;
      paymentMethod?: "account_withdrawal" | "credit_card";
      accountId: string | null;
    };
  }
  | {
    action: "seedBilling";
    payload: {
      yearMonth: string;
      items: Array<{ creditCardId: string; amount: number }>;
      settlementDate?: string | null;
    };
  }
  | {
    action: "seedTransaction";
    payload: {
      accountId: string | null;
      transferToAccountId?: string | null;
      forecastEventId?: string | null;
      date?: string;
      type?: "income" | "expense" | "transfer";
      description?: string;
      amount?: number;
    };
  }
  | {
    action: "seedTransactions";
    payload: Array<{
      accountId: string | null;
      transferToAccountId?: string | null;
      forecastEventId?: string | null;
      date?: string;
      type?: "income" | "expense" | "transfer";
      description?: string;
      amount?: number;
    }>;
  }
  | {
    action: "seedPerson";
    payload: {
      name: string;
      memo?: string | null;
      sortOrder?: number;
    };
  }
  | {
    action: "seedSplit";
    payload: {
      date: string;
      description: string;
      amount: number;
      shares: Array<{ personId: string; amount: number }>;
    };
  }
  | {
    action: "seedSettlement";
    payload: {
      kind: "transaction" | "offset";
      personId: string;
      transactionId?: string | null;
      date: string;
      note?: string | null;
      allocations: Array<{ shareId: string; amount: number }>;
    };
  };

function resolveDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }
  return url;
}

const prisma = createPrismaClient({ databaseUrl: resolveDatabaseUrl() });

async function run(command: DbCommand) {
  switch (command.action) {
    case "resetDatabase":
      await resetDatabaseForE2e(prisma);
      return null;
    case "seedAccount":
      return createAccount(prisma, {
        name: command.payload.name ?? "Main Account",
        balance: command.payload.balance ?? 0,
        balanceOffset: command.payload.balanceOffset ?? 0,
        currencyCode: command.payload.currencyCode ?? "JPY",
        exchangeRateToJpy: command.payload.exchangeRateToJpy ?? 1,
        sortOrder: command.payload.sortOrder ?? 0,
      });
    case "seedRecurringItem":
      return createRecurringItem(prisma, {
        name: command.payload.name ?? "Recurring Item",
        type: command.payload.type ?? "expense",
        amount: command.payload.amount ?? 1000,
        dayOfMonth: command.payload.dayOfMonth ?? 1,
        startDate: command.payload.startDate ? new Date(command.payload.startDate) : null,
        endDate: command.payload.endDate ? new Date(command.payload.endDate) : null,
        accountId: command.payload.accountId,
        transferToAccountId: command.payload.transferToAccountId ?? null,
        enabled: command.payload.enabled ?? true,
        sortOrder: command.payload.sortOrder ?? 0,
      });
    case "seedCreditCard":
      return createCreditCard(prisma, {
        name: command.payload.name ?? "Credit Card",
        settlementDay: command.payload.settlementDay ?? undefined,
        accountId: command.payload.accountId,
        assumptionAmount: command.payload.assumptionAmount ?? 10000,
        sortOrder: command.payload.sortOrder ?? 0,
      });
    case "seedSubscription":
      return createSubscription(prisma, {
        name: command.payload.name ?? "Subscription",
        amount: command.payload.amount ?? 1000,
        currencyCode: command.payload.currencyCode,
        exchangeRateToJpy: command.payload.exchangeRateToJpy,
        interval: command.payload.interval ?? 1,
        startDate: command.payload.startDate
          ? new Date(command.payload.startDate)
          : new Date("2026-01-01T00:00:00.000Z"),
        dayOfMonth: command.payload.dayOfMonth ?? 1,
        endDate: command.payload.endDate ? new Date(command.payload.endDate) : null,
        paymentSource: command.payload.paymentSource ?? null,
      });
    case "seedSalary":
      return createSalaryRecord(prisma, {
        paidOn: command.payload.paidOn
          ? new Date(command.payload.paidOn)
          : new Date("2026-01-01T00:00:00.000Z"),
        kind: command.payload.kind ?? "salary",
        name: command.payload.name ?? null,
        grossAmount: command.payload.grossAmount ?? 0,
        healthInsurance: command.payload.healthInsurance ?? 0,
        pensionInsurance: command.payload.pensionInsurance ?? 0,
        employmentInsurance: command.payload.employmentInsurance ?? 0,
        childcareSupportLevy: command.payload.childcareSupportLevy ?? 0,
        incomeTax: command.payload.incomeTax ?? 0,
        residentTax: command.payload.residentTax ?? 0,
        yearEndTaxAdjustment: command.payload.yearEndTaxAdjustment ?? 0,
        employeeStockContribution: command.payload.employeeStockContribution ?? 0,
        employeeStockIncentive: command.payload.employeeStockIncentive ?? 0,
        dcMatchingContribution: command.payload.dcMatchingContribution ?? 0,
        otherDeductions: command.payload.otherDeductions ?? 0,
      });
    case "seedDonation":
      return createDonation(prisma, {
        recipient: command.payload.recipient ?? "Recipient",
        amount: command.payload.amount ?? 1000,
        memo: command.payload.memo ?? null,
        donatedOn: command.payload.donatedOn
          ? new Date(command.payload.donatedOn)
          : new Date("2026-01-01T00:00:00.000Z"),
      });
    case "seedLoan":
      return createLoan(prisma, {
        name: command.payload.name ?? "Loan",
        totalAmount: command.payload.totalAmount ?? 120000,
        startDate: command.payload.startDate
          ? new Date(command.payload.startDate)
          : new Date("2026-03-20T00:00:00.000Z"),
        paymentCount: command.payload.paymentCount ?? 12,
        paymentMethod: command.payload.paymentMethod ?? "account_withdrawal",
        accountId: command.payload.accountId,
      });
    case "seedBilling":
      return createBilling(prisma, {
        yearMonth: command.payload.yearMonth,
        items: command.payload.items,
        settlementDate: command.payload.settlementDate
          ? new Date(command.payload.settlementDate)
          : null,
      });
    case "seedTransaction":
      return createTransaction(prisma, {
        accountId: command.payload.accountId,
        transferToAccountId: command.payload.transferToAccountId ?? null,
        forecastEventId: command.payload.forecastEventId ?? null,
        date: command.payload.date
          ? new Date(command.payload.date)
          : new Date("2026-03-14T00:00:00.000Z"),
        type: command.payload.type ?? "expense",
        description: command.payload.description ?? "Test transaction",
        amount: command.payload.amount ?? 1000,
      });
    case "seedTransactions":
      return Promise.all(
        command.payload.map((payload) =>
          createTransaction(prisma, {
            accountId: payload.accountId,
            transferToAccountId: payload.transferToAccountId ?? null,
            forecastEventId: payload.forecastEventId ?? null,
            date: payload.date
              ? new Date(payload.date)
              : new Date("2026-03-14T00:00:00.000Z"),
            type: payload.type ?? "expense",
            description: payload.description ?? "Test transaction",
            amount: payload.amount ?? 1000,
          }),
        ),
      );
    case "seedPerson":
      return prisma.person.create({
        data: {
          name: command.payload.name,
          memo: command.payload.memo ?? null,
          sortOrder: command.payload.sortOrder ?? 0,
        },
      });
    case "seedSplit":
      return prisma.transactionSplit.create({
        data: {
          date: new Date(command.payload.date),
          description: command.payload.description,
          amount: command.payload.amount,
          method: "amount",
          shares: {
            create: command.payload.shares.map((share) => ({
              personId: share.personId,
              amount: share.amount,
            })),
          },
        },
        include: { shares: true },
      });
    case "seedSettlement":
      return prisma.settlement.create({
        data: {
          kind: command.payload.kind,
          personId: command.payload.personId,
          transactionId: command.payload.transactionId ?? null,
          date: new Date(command.payload.date),
          note: command.payload.note ?? null,
          allocations: {
            create: command.payload.allocations.map((allocation) => ({
              shareId: allocation.shareId,
              amount: allocation.amount,
            })),
          },
        },
        include: { allocations: true },
      });
  }
}

const rl = readline.createInterface({ input: process.stdin });
let processing = Promise.resolve();

rl.on("line", (line) => {
  processing = processing
    .catch(() => undefined)
    .then(async () => {
      try {
        const command = JSON.parse(line) as DbCommand;
        const result = await run(command);
        process.stdout.write(JSON.stringify(result) + "\n");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stdout.write(JSON.stringify({ error: message }) + "\n");
      }
    });
});

rl.on("close", () => {
  processing = processing.finally(async () => {
    await prisma.$disconnect();
  });
});
