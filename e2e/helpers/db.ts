import {
  spawn,
  type ChildProcessByStdio,
} from "node:child_process";
import path from "node:path";
import * as readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import type {
  Account,
  CreditCard,
  CreditCardBilling,
  Loan,
  RecurringItem,
  Transaction,
} from "@sui/db";

type DbCommand =
  | { action: "resetDatabase" }
  | {
    action: "seedAccount";
    payload: {
      name?: string;
      balance?: number;
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

const runnerPath = path.resolve(process.cwd(), "e2e/helpers/db-runner.ts");
const tsxPath = path.resolve(process.cwd(), "packages/backend/node_modules/.bin/tsx");

type DbRunnerProcess = ChildProcessByStdio<Writable, Readable, null>;

let child: DbRunnerProcess | null = null;
let lineQueue: Array<{ resolve: (line: string) => void; reject: (error: Error) => void }> = [];
let commandQueue = Promise.resolve();

function resetRunner() {
  child = null;
  lineQueue = [];
}

function rejectPendingLines(error: Error) {
  const pending = lineQueue;
  lineQueue = [];
  pending.forEach(({ reject }) => reject(error));
}

function ensureRunner() {
  if (child) {
    return child;
  }

  const nextChild = spawn(tsxPath, [runnerPath], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "inherit"],
  });

  const nextRl = readline.createInterface({ input: nextChild.stdout });

  nextRl.on("line", (line) => {
    const pending = lineQueue.shift();
    if (pending) {
      pending.resolve(line);
    }
  });

  nextChild.on("error", (error) => {
    rejectPendingLines(error);
    nextRl.close();
    resetRunner();
  });

  nextChild.on("exit", (code, signal) => {
    rejectPendingLines(
      new Error(
        `DB runner exited before responding (code=${code ?? "null"}, signal=${signal ?? "null"})`,
      ),
    );
    nextRl.close();
    resetRunner();
  });

  child = nextChild;
  return nextChild;
}

function sendCommand(command: DbCommand): Promise<string> {
  return new Promise((resolve, reject) => {
    commandQueue = commandQueue
      .catch(() => undefined)
      .then(async () => {
        const currentChild = ensureRunner();

        const line = await new Promise<string>((resolveLine, rejectLine) => {
          lineQueue.push({ resolve: resolveLine, reject: rejectLine });

          currentChild.stdin.write(JSON.stringify(command) + "\n", (error) => {
            if (!error) {
              return;
            }

            const pendingIndex = lineQueue.findIndex((entry) => entry.resolve === resolveLine);
            if (pendingIndex >= 0) {
              const [pending] = lineQueue.splice(pendingIndex, 1);
              pending.reject(error);
            } else {
              rejectLine(error);
            }
          });
        });

        resolve(line);
      })
      .catch((error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
        throw error;
      });
  });
}

async function runDbCommand<T>(command: DbCommand): Promise<T> {
  const line = await sendCommand(command);
  const result: unknown = JSON.parse(line);

  if (
    result &&
    typeof result === "object" &&
    "error" in result &&
    typeof result.error === "string"
  ) {
    throw new Error(result.error);
  }

  return result as T;
}

function serializeNullableDate(date: Date | null | undefined): string | null | undefined {
  if (date === undefined) {
    return undefined;
  }

  return date === null ? null : date.toISOString();
}

function serializeOptionalDate(date: Date | undefined): string | undefined {
  return date?.toISOString();
}

process.once("exit", () => {
  if (child && !child.killed) {
    child.stdin.end();
  }
});

export async function resetDatabase() {
  await runDbCommand<null>({ action: "resetDatabase" });
}

export async function seedAccount(overrides: {
  name?: string;
  balance?: number;
  sortOrder?: number;
} = {}): Promise<Account> {
  return runDbCommand<Account>({
    action: "seedAccount",
    payload: {
      name: overrides.name,
      balance: overrides.balance,
      sortOrder: overrides.sortOrder,
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
}): Promise<RecurringItem> {
  return runDbCommand<RecurringItem>({
    action: "seedRecurringItem",
    payload: {
      name: overrides.name,
      type: overrides.type,
      amount: overrides.amount,
      dayOfMonth: overrides.dayOfMonth,
      startDate: serializeNullableDate(overrides.startDate),
      endDate: serializeNullableDate(overrides.endDate),
      accountId: overrides.accountId,
      enabled: overrides.enabled,
      sortOrder: overrides.sortOrder,
    },
  });
}

export async function seedCreditCard(overrides: {
  name?: string;
  settlementDay?: number | null;
  accountId: string;
  assumptionAmount?: number;
  sortOrder?: number;
}): Promise<CreditCard> {
  return runDbCommand<CreditCard>({
    action: "seedCreditCard",
    payload: {
      name: overrides.name,
      settlementDay: overrides.settlementDay,
      accountId: overrides.accountId,
      assumptionAmount: overrides.assumptionAmount,
      sortOrder: overrides.sortOrder,
    },
  });
}

export async function seedLoan(overrides: {
  name?: string;
  totalAmount?: number;
  startDate?: Date;
  paymentCount?: number;
  accountId: string;
}): Promise<Loan> {
  return runDbCommand<Loan>({
    action: "seedLoan",
    payload: {
      name: overrides.name,
      totalAmount: overrides.totalAmount,
      startDate: serializeOptionalDate(overrides.startDate),
      paymentCount: overrides.paymentCount,
      accountId: overrides.accountId,
    },
  });
}

export async function seedBilling(
  yearMonth: string,
  items: Array<{ creditCardId: string; amount: number }>,
  settlementDate?: Date | null,
): Promise<CreditCardBilling> {
  return runDbCommand<CreditCardBilling>({
    action: "seedBilling",
    payload: {
      yearMonth,
      items,
      settlementDate: serializeNullableDate(settlementDate),
    },
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
}): Promise<Transaction> {
  return runDbCommand<Transaction>({
    action: "seedTransaction",
    payload: {
      accountId: overrides.accountId,
      transferToAccountId: overrides.transferToAccountId,
      forecastEventId: overrides.forecastEventId,
      date: serializeOptionalDate(overrides.date),
      type: overrides.type,
      description: overrides.description,
      amount: overrides.amount,
    },
  });
}

export async function seedTransactions(
  overridesList: Array<{
    accountId: string;
    transferToAccountId?: string | null;
    forecastEventId?: string | null;
    date?: Date;
    type?: "income" | "expense" | "transfer";
    description?: string;
    amount?: number;
  }>,
): Promise<Transaction[]> {
  return runDbCommand<Transaction[]>({
    action: "seedTransactions",
    payload: overridesList.map((overrides) => ({
      accountId: overrides.accountId,
      transferToAccountId: overrides.transferToAccountId,
      forecastEventId: overrides.forecastEventId,
      date: serializeOptionalDate(overrides.date),
      type: overrides.type,
      description: overrides.description,
      amount: overrides.amount,
    })),
  });
}
