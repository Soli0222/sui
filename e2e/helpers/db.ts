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
  Donation,
  Loan,
  Person,
  RecurringItem,
  SalaryRecord,
  Settlement,
  SettlementAllocation,
  SplitShare,
  Subscription,
  Transaction,
  TransactionSplit,
} from "@sui/db";

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
      incomeTax?: number;
      residentTax?: number;
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
  balanceOffset?: number;
  currencyCode?: string;
  exchangeRateToJpy?: number;
  sortOrder?: number;
} = {}): Promise<Account> {
  return runDbCommand<Account>({
    action: "seedAccount",
    payload: {
      name: overrides.name,
      balance: overrides.balance,
      balanceOffset: overrides.balanceOffset,
      currencyCode: overrides.currencyCode,
      exchangeRateToJpy: overrides.exchangeRateToJpy,
      sortOrder: overrides.sortOrder,
    },
  });
}

export async function seedRecurringItem(overrides: {
  name?: string;
  type?: "income" | "expense" | "transfer";
  amount?: number;
  dayOfMonth?: number;
  startDate?: Date | null;
  endDate?: Date | null;
  accountId?: string | null;
  transferToAccountId?: string | null;
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
      transferToAccountId: overrides.transferToAccountId,
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

export async function seedSubscription(overrides: {
  name?: string;
  amount?: number;
  currencyCode?: string;
  exchangeRateToJpy?: number;
  interval?: number;
  startDate?: Date;
  dayOfMonth?: number;
  endDate?: Date | null;
  paymentSource?: string | null;
} = {}): Promise<Subscription> {
  return runDbCommand<Subscription>({
    action: "seedSubscription",
    payload: {
      name: overrides.name,
      amount: overrides.amount,
      currencyCode: overrides.currencyCode,
      exchangeRateToJpy: overrides.exchangeRateToJpy,
      interval: overrides.interval,
      startDate: serializeOptionalDate(overrides.startDate),
      dayOfMonth: overrides.dayOfMonth,
      endDate: serializeNullableDate(overrides.endDate),
      paymentSource: overrides.paymentSource,
    },
  });
}

export async function seedSalary(overrides: {
  paidOn?: Date;
  kind?: "salary" | "bonus";
  name?: string | null;
  grossAmount?: number;
  healthInsurance?: number;
  pensionInsurance?: number;
  employmentInsurance?: number;
  incomeTax?: number;
  residentTax?: number;
  otherDeductions?: number;
} = {}): Promise<SalaryRecord> {
  return runDbCommand<SalaryRecord>({
    action: "seedSalary",
    payload: {
      paidOn: serializeOptionalDate(overrides.paidOn),
      kind: overrides.kind,
      name: overrides.name ?? null,
      grossAmount: overrides.grossAmount,
      healthInsurance: overrides.healthInsurance,
      pensionInsurance: overrides.pensionInsurance,
      employmentInsurance: overrides.employmentInsurance,
      incomeTax: overrides.incomeTax,
      residentTax: overrides.residentTax,
      otherDeductions: overrides.otherDeductions,
    },
  });
}

export async function seedDonation(overrides: {
  recipient?: string;
  amount?: number;
  memo?: string | null;
  donatedOn?: Date;
} = {}): Promise<Donation> {
  return runDbCommand<Donation>({
    action: "seedDonation",
    payload: {
      recipient: overrides.recipient,
      amount: overrides.amount,
      memo: overrides.memo,
      donatedOn: serializeOptionalDate(overrides.donatedOn),
    },
  });
}

export async function seedLoan(overrides: {
  name?: string;
  totalAmount?: number;
  startDate?: Date;
  paymentCount?: number;
  paymentMethod?: "account_withdrawal" | "credit_card";
  accountId: string | null;
}): Promise<Loan> {
  return runDbCommand<Loan>({
    action: "seedLoan",
    payload: {
      name: overrides.name,
      totalAmount: overrides.totalAmount,
      startDate: serializeOptionalDate(overrides.startDate),
      paymentCount: overrides.paymentCount,
      paymentMethod: overrides.paymentMethod,
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
  accountId: string | null;
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
    accountId: string | null;
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

export type SplitWithShares = TransactionSplit & { shares: SplitShare[] };
export type SettlementWithAllocations = Settlement & { allocations: SettlementAllocation[] };

export async function seedPerson(overrides: {
  name: string;
  memo?: string | null;
  sortOrder?: number;
}): Promise<Person> {
  return runDbCommand<Person>({
    action: "seedPerson",
    payload: {
      name: overrides.name,
      memo: overrides.memo ?? null,
      sortOrder: overrides.sortOrder ?? 0,
    },
  });
}

export async function seedSplit(overrides: {
  date: Date;
  description: string;
  amount: number;
  shares: Array<{ personId: string; amount: number }>;
}): Promise<SplitWithShares> {
  return runDbCommand<SplitWithShares>({
    action: "seedSplit",
    payload: {
      date: serializeOptionalDate(overrides.date) as string,
      description: overrides.description,
      amount: overrides.amount,
      shares: overrides.shares,
    },
  });
}

export async function seedSettlement(overrides: {
  kind: "transaction" | "offset";
  personId: string;
  transactionId?: string | null;
  date: Date;
  note?: string | null;
  allocations: Array<{ shareId: string; amount: number }>;
}): Promise<SettlementWithAllocations> {
  return runDbCommand<SettlementWithAllocations>({
    action: "seedSettlement",
    payload: {
      kind: overrides.kind,
      personId: overrides.personId,
      transactionId: overrides.transactionId ?? null,
      date: serializeOptionalDate(overrides.date) as string,
      note: overrides.note ?? null,
      allocations: overrides.allocations,
    },
  });
}
