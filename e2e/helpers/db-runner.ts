import * as readline from "node:readline";
import { createPrismaClient } from "@sui/db";
import {
  createAccount,
  createBilling,
  createCreditCard,
  createLoan,
  createRecurringItem,
  createTransaction,
  resetDatabase,
} from "@sui/db/testing";

const TEST_DATABASE_URL = "postgresql://sui_test:sui_test@localhost:5555/sui_test";

type DbCommand =
  | { action: "resetDatabase" }
  | {
    action: "seedAccount";
    payload: {
      name?: string;
      balance?: number;
      balanceOffset?: number;
      sortOrder?: number;
    };
  }
  | {
    action: "seedRecurringItem";
    payload: {
      name?: string;
      type?: "income" | "expense";
      amount?: number;
      dayOfMonth?: number;
      startDate?: string | null;
      endDate?: string | null;
      accountId: string;
      enabled?: boolean;
      sortOrder?: number;
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
      accountId: string;
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
      accountId: string;
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
      accountId: string;
      transferToAccountId?: string | null;
      forecastEventId?: string | null;
      date?: string;
      type?: "income" | "expense" | "transfer";
      description?: string;
      amount?: number;
    }>;
  };

function resolveDatabaseUrl() {
  return process.env.DATABASE_URL ?? TEST_DATABASE_URL;
}

const prisma = createPrismaClient({ databaseUrl: resolveDatabaseUrl() });

async function run(command: DbCommand) {
  switch (command.action) {
    case "resetDatabase":
      await resetDatabase(prisma);
      return null;
    case "seedAccount":
      return createAccount(prisma, {
        name: command.payload.name ?? "Main Account",
        balance: command.payload.balance ?? 0,
        balanceOffset: command.payload.balanceOffset ?? 0,
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
    case "seedLoan":
      return createLoan(prisma, {
        name: command.payload.name ?? "Loan",
        totalAmount: command.payload.totalAmount ?? 120000,
        startDate: command.payload.startDate
          ? new Date(command.payload.startDate)
          : new Date("2026-03-20T00:00:00.000Z"),
        paymentCount: command.payload.paymentCount ?? 12,
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
