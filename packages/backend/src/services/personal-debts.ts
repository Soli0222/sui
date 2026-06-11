import type {
  PersonalDebtDirection,
  PersonalDebtOrigin,
  PersonalDebtStatus,
  PersonalDebtSourceType,
  SplitBillMethod,
  SplitBillPayerType,
  SplitBillStatus,
} from "@sui/db";
import type { Prisma, PrismaClient, TransactionType } from "@sui/db";
import { fromDateOnlyString, isDateString, toDateOnlyString } from "../lib/dates";

type Db = PrismaClient | Prisma.TransactionClient;

const debtInclude = {
  account: true,
  settlements: {
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  },
} satisfies Prisma.PersonalDebtInclude;

const splitBillInclude = {
  account: true,
  participants: {
    orderBy: [{ sortOrder: "asc" }],
    include: {
      personalDebt: {
        include: debtInclude,
      },
    },
  },
} satisfies Prisma.SplitBillInclude;

type DebtWithRelations = Prisma.PersonalDebtGetPayload<{ include: typeof debtInclude }>;
type SplitBillWithRelations = Prisma.SplitBillGetPayload<{ include: typeof splitBillInclude }>;

export type ParticipantInput = {
  name: string;
  isSelf?: boolean;
  sortOrder?: number;
};

export type CreatePersonalDebtInput = {
  direction: PersonalDebtDirection;
  origin?: PersonalDebtOrigin;
  counterpartyName: string;
  title: string;
  principalAmount: number;
  openedDate: string;
  dueDate?: string | null;
  accountId: string;
  memo?: string | null;
};

export type CreateSettlementInput = {
  date: string;
  amount: number;
  accountId?: string;
  memo?: string | null;
};

export type CreateSplitBillInput = {
  title: string;
  totalAmount: number;
  paidDate: string;
  payerType: SplitBillPayerType;
  payerName?: string | null;
  accountId: string;
  splitMethod?: SplitBillMethod;
  dueDate?: string | null;
  memo?: string | null;
  participants: ParticipantInput[];
};

function assertDate(value: string, fieldName: string) {
  if (!isDateString(value)) {
    throw new Error(`${fieldName} must be YYYY-MM-DD`);
  }
}

function serializeDate(value: Date | null) {
  return value ? toDateOnlyString(value) : null;
}

function sumSettlements(debt: { settlements: Array<{ amount: number }> }) {
  return debt.settlements.reduce((sum, settlement) => sum + settlement.amount, 0);
}

export function getDebtRemainingAmount(debt: { principalAmount: number; settlements: Array<{ amount: number }> }) {
  return Math.max(debt.principalAmount - sumSettlements(debt), 0);
}

function serializeSettlement(settlement: DebtWithRelations["settlements"][number]) {
  return {
    ...settlement,
    date: serializeDate(settlement.date),
    createdAt: settlement.createdAt.toISOString(),
    updatedAt: settlement.updatedAt.toISOString(),
  };
}

export function serializeDebt(debt: DebtWithRelations) {
  const settledAmount = sumSettlements(debt);

  return {
    ...debt,
    openedDate: serializeDate(debt.openedDate),
    dueDate: serializeDate(debt.dueDate),
    createdAt: debt.createdAt.toISOString(),
    updatedAt: debt.updatedAt.toISOString(),
    settledAmount,
    remainingAmount: Math.max(debt.principalAmount - settledAmount, 0),
    settlements: debt.settlements.map(serializeSettlement),
  };
}

export function serializeSplitBill(splitBill: SplitBillWithRelations) {
  const participants = splitBill.participants.map((participant) => ({
    ...participant,
    personalDebt: participant.personalDebt ? serializeDebt(participant.personalDebt) : null,
  }));
  const selfShareAmount = participants.find((participant) => participant.isSelf)?.shareAmount ?? 0;
  const outstandingAmount = participants.reduce(
    (sum, participant) => sum + (participant.personalDebt?.remainingAmount ?? 0),
    0,
  );

  return {
    ...splitBill,
    paidDate: serializeDate(splitBill.paidDate),
    dueDate: serializeDate(splitBill.dueDate),
    createdAt: splitBill.createdAt.toISOString(),
    updatedAt: splitBill.updatedAt.toISOString(),
    selfShareAmount,
    outstandingAmount,
    participants,
  };
}

async function ensureAccount(tx: Db, accountId: string) {
  const account = await tx.account.findFirst({ where: { id: accountId, deletedAt: null } });
  if (!account) {
    throw new Error("Account not found");
  }

  return account;
}

function openingTransactionType(direction: PersonalDebtDirection): TransactionType {
  return direction === "lent" ? "expense" : "income";
}

function settlementTransactionType(direction: PersonalDebtDirection): TransactionType {
  return direction === "lent" ? "income" : "expense";
}

async function applyTransactionEffect(
  tx: Db,
  transaction: { accountId: string; type: TransactionType; amount: number },
) {
  await tx.account.update({
    where: { id: transaction.accountId },
    data: {
      balance:
        transaction.type === "income"
          ? { increment: transaction.amount }
          : { decrement: transaction.amount },
    },
  });
}

async function revertTransactionEffect(
  tx: Db,
  transaction: { accountId: string; type: TransactionType; amount: number },
) {
  await tx.account.update({
    where: { id: transaction.accountId },
    data: {
      balance:
        transaction.type === "income"
          ? { decrement: transaction.amount }
          : { increment: transaction.amount },
    },
  });
}

async function createAccountingTransaction(
  tx: Db,
  input: {
    accountId: string;
    date: string;
    type: TransactionType;
    description: string;
    amount: number;
    forecastEventId?: string | null;
  },
) {
  await ensureAccount(tx, input.accountId);
  await applyTransactionEffect(tx, input);

  return tx.transaction.create({
    data: {
      accountId: input.accountId,
      forecastEventId: input.forecastEventId ?? null,
      date: fromDateOnlyString(input.date),
      type: input.type,
      description: input.description,
      amount: input.amount,
    },
  });
}

function debtTransactionDescription(input: { title: string; counterpartyName: string }) {
  return `貸し借り: ${input.title} (${input.counterpartyName})`;
}

function settlementTransactionDescription(debt: { title: string; counterpartyName: string }) {
  return `精算: ${debt.title} (${debt.counterpartyName})`;
}

export function previewEqualSplit(totalAmount: number, participants: ParticipantInput[]) {
  if (totalAmount <= 0) {
    throw new Error("totalAmount must be positive");
  }

  const normalized = normalizeParticipants(participants);
  const base = Math.floor(totalAmount / normalized.length);
  let remainder = totalAmount % normalized.length;

  return normalized.map((participant) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return {
      ...participant,
      shareAmount: base + extra,
    };
  });
}

function normalizeParticipants(participants: ParticipantInput[]) {
  const trimmed = participants
    .map((participant, index) => ({
      name: participant.name.trim(),
      isSelf: participant.isSelf ?? false,
      sortOrder: participant.sortOrder ?? index,
    }))
    .filter((participant) => participant.name.length > 0);

  if (!trimmed.some((participant) => participant.isSelf)) {
    trimmed.unshift({ name: "自分", isSelf: true, sortOrder: -1 });
  }

  const selfCount = trimmed.filter((participant) => participant.isSelf).length;
  if (selfCount !== 1) {
    throw new Error("participants must include exactly one self participant");
  }

  if (trimmed.length < 2) {
    throw new Error("participants must include at least two people");
  }

  return [...trimmed].sort((left, right) => left.sortOrder - right.sortOrder);
}

export async function listPersonalDebts(prisma: PrismaClient, status?: string) {
  const where: Prisma.PersonalDebtWhereInput = { deletedAt: null };
  if (status && status !== "all") {
    where.status = status as PersonalDebtStatus;
  }

  const debts = await prisma.personalDebt.findMany({
    where,
    include: debtInclude,
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { openedDate: "desc" }, { createdAt: "desc" }],
  });

  return debts.map(serializeDebt);
}

export async function getPersonalDebt(prisma: PrismaClient, id: string) {
  const debt = await prisma.personalDebt.findFirst({
    where: { id, deletedAt: null },
    include: debtInclude,
  });

  return debt ? serializeDebt(debt) : null;
}

export async function createPersonalDebt(prisma: PrismaClient, input: CreatePersonalDebtInput) {
  assertDate(input.openedDate, "openedDate");
  if (input.dueDate) {
    assertDate(input.dueDate, "dueDate");
  }

  return prisma.$transaction(async (tx) => {
    const origin = input.origin ?? "cash_loan";
    const openingTransaction = origin === "cash_loan"
      ? await createAccountingTransaction(tx, {
          accountId: input.accountId,
          date: input.openedDate,
          type: openingTransactionType(input.direction),
          description: debtTransactionDescription(input),
          amount: input.principalAmount,
        })
      : null;

    const debt = await tx.personalDebt.create({
      data: {
        direction: input.direction,
        origin,
        counterpartyName: input.counterpartyName,
        title: input.title,
        principalAmount: input.principalAmount,
        openedDate: fromDateOnlyString(input.openedDate),
        dueDate: input.dueDate ? fromDateOnlyString(input.dueDate) : null,
        accountId: input.accountId,
        sourceType: "manual",
        openingTransactionId: openingTransaction?.id ?? null,
        memo: input.memo ?? null,
      },
      include: debtInclude,
    });

    return serializeDebt(debt);
  });
}

export async function updatePersonalDebt(prisma: PrismaClient, id: string, input: CreatePersonalDebtInput & { status?: string }) {
  assertDate(input.openedDate, "openedDate");
  if (input.dueDate) {
    assertDate(input.dueDate, "dueDate");
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.personalDebt.findFirst({
      where: { id, deletedAt: null },
      include: debtInclude,
    });
    if (!existing) {
      return null;
    }

    if (existing.settlements.length > 0) {
      const coreChanged =
        existing.direction !== input.direction ||
        existing.principalAmount !== input.principalAmount ||
        existing.accountId !== input.accountId ||
        serializeDate(existing.openedDate) !== input.openedDate;
      if (coreChanged) {
        throw new Error("Cannot change amount, direction, account, or opened date after settlements");
      }
    }

    if (existing.openingTransactionId && existing.settlements.length === 0) {
      const opening = await tx.transaction.findUnique({ where: { id: existing.openingTransactionId } });
      if (opening) {
        await revertTransactionEffect(tx, opening);
        const nextOpening = {
          accountId: input.accountId,
          type: openingTransactionType(input.direction),
          amount: input.principalAmount,
        };
        await applyTransactionEffect(tx, nextOpening);
        await tx.transaction.update({
          where: { id: opening.id },
          data: {
            accountId: nextOpening.accountId,
            date: fromDateOnlyString(input.openedDate),
            type: nextOpening.type,
            description: debtTransactionDescription(input),
            amount: nextOpening.amount,
          },
        });
      }
    }

    const updated = await tx.personalDebt.update({
      where: { id },
      data: {
        direction: input.direction,
        origin: input.origin ?? existing.origin,
        counterpartyName: input.counterpartyName,
        title: input.title,
        principalAmount: input.principalAmount,
        openedDate: fromDateOnlyString(input.openedDate),
        dueDate: input.dueDate ? fromDateOnlyString(input.dueDate) : null,
        accountId: input.accountId,
        status: (input.status ?? existing.status) as PersonalDebtStatus,
        memo: input.memo ?? null,
      },
      include: debtInclude,
    });

    return serializeDebt(updated);
  });
}

export async function cancelPersonalDebt(prisma: PrismaClient, id: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.personalDebt.findFirst({
      where: { id, deletedAt: null },
      include: debtInclude,
    });
    if (!existing) {
      return null;
    }
    if (existing.settlements.length > 0) {
      throw new Error("Cannot cancel a debt with settlements");
    }

    if (existing.openingTransactionId) {
      const opening = await tx.transaction.findUnique({ where: { id: existing.openingTransactionId } });
      if (opening && !opening.deletedAt) {
        await revertTransactionEffect(tx, opening);
        await tx.transaction.update({
          where: { id: opening.id },
          data: { deletedAt: new Date() },
        });
      }
    }

    const canceled = await tx.personalDebt.update({
      where: { id },
      data: { status: "canceled", deletedAt: new Date() },
      include: debtInclude,
    });
    return serializeDebt(canceled);
  });
}

export async function settlePersonalDebt(
  prisma: PrismaClient,
  debtId: string,
  input: CreateSettlementInput,
  options?: { forecastEventId?: string | null },
) {
  assertDate(input.date, "date");

  return prisma.$transaction(async (tx) => {
    const debt = await tx.personalDebt.findFirst({
      where: { id: debtId, deletedAt: null },
      include: debtInclude,
    });
    if (!debt) {
      return null;
    }
    if (debt.status === "canceled") {
      throw new Error("Cannot settle a canceled debt");
    }

    const remainingAmount = getDebtRemainingAmount(debt);
    if (input.amount > remainingAmount) {
      throw new Error("Settlement amount exceeds remaining amount");
    }

    const accountId = input.accountId ?? debt.accountId;
    const transaction = await createAccountingTransaction(tx, {
      accountId,
      date: input.date,
      type: settlementTransactionType(debt.direction),
      description: settlementTransactionDescription(debt),
      amount: input.amount,
      forecastEventId: options?.forecastEventId ?? null,
    });

    await tx.personalDebtSettlement.create({
      data: {
        debtId: debt.id,
        date: fromDateOnlyString(input.date),
        amount: input.amount,
        accountId,
        transactionId: transaction.id,
        memo: input.memo ?? null,
      },
    });

    await tx.personalDebt.update({
      where: { id: debt.id },
      data: { status: input.amount === remainingAmount ? "settled" : "open" },
    });

    if (debt.splitBillId) {
      await refreshSplitBillStatus(tx, debt.splitBillId);
    }

    const updatedDebt = await tx.personalDebt.findUniqueOrThrow({
      where: { id: debt.id },
      include: debtInclude,
    });
    return { debt: serializeDebt(updatedDebt), transaction };
  });
}

export async function updatePersonalDebtSettlement(
  prisma: PrismaClient,
  debtId: string,
  settlementId: string,
  input: CreateSettlementInput,
) {
  assertDate(input.date, "date");

  return prisma.$transaction(async (tx) => {
    const settlement = await tx.personalDebtSettlement.findFirst({
      where: { id: settlementId, debtId },
      include: { debt: { include: debtInclude }, transaction: true },
    });
    if (!settlement) {
      return null;
    }

    const available = getDebtRemainingAmount(settlement.debt) + settlement.amount;
    if (input.amount > available) {
      throw new Error("Settlement amount exceeds remaining amount");
    }

    const accountId = input.accountId ?? settlement.debt.accountId;
    const nextTransaction = {
      accountId,
      type: settlementTransactionType(settlement.debt.direction),
      amount: input.amount,
    };

    await revertTransactionEffect(tx, settlement.transaction);
    await applyTransactionEffect(tx, nextTransaction);
    await tx.transaction.update({
      where: { id: settlement.transactionId },
      data: {
        accountId,
        date: fromDateOnlyString(input.date),
        type: nextTransaction.type,
        description: settlementTransactionDescription(settlement.debt),
        amount: input.amount,
      },
    });

    await tx.personalDebtSettlement.update({
      where: { id: settlement.id },
      data: {
        date: fromDateOnlyString(input.date),
        amount: input.amount,
        accountId,
        memo: input.memo ?? null,
      },
    });

    const updatedDebt = await refreshDebtStatus(tx, debtId);
    if (updatedDebt?.splitBillId) {
      await refreshSplitBillStatus(tx, updatedDebt.splitBillId);
    }

    return updatedDebt ? serializeDebt(updatedDebt) : null;
  });
}

export async function deletePersonalDebtSettlement(prisma: PrismaClient, debtId: string, settlementId: string) {
  return prisma.$transaction(async (tx) => {
    const settlement = await tx.personalDebtSettlement.findFirst({
      where: { id: settlementId, debtId },
      include: { debt: true, transaction: true },
    });
    if (!settlement) {
      return null;
    }

    await revertTransactionEffect(tx, settlement.transaction);
    await tx.transaction.update({
      where: { id: settlement.transactionId },
      data: { deletedAt: new Date() },
    });
    await tx.personalDebtSettlement.delete({ where: { id: settlement.id } });

    const updatedDebt = await refreshDebtStatus(tx, debtId);
    if (updatedDebt?.splitBillId) {
      await refreshSplitBillStatus(tx, updatedDebt.splitBillId);
    }

    return updatedDebt ? serializeDebt(updatedDebt) : null;
  });
}

async function refreshDebtStatus(tx: Db, debtId: string) {
  const debt = await tx.personalDebt.findUnique({
    where: { id: debtId },
    include: debtInclude,
  });
  if (!debt || debt.status === "canceled") {
    return debt;
  }

  return tx.personalDebt.update({
    where: { id: debt.id },
    data: { status: getDebtRemainingAmount(debt) === 0 ? "settled" : "open" },
    include: debtInclude,
  });
}

async function refreshSplitBillStatus(tx: Db, splitBillId: string) {
  const splitBill = await tx.splitBill.findUnique({
    where: { id: splitBillId },
    include: {
      personalDebts: {
        where: { deletedAt: null },
        include: { settlements: true },
      },
    },
  });
  if (!splitBill || splitBill.status === "canceled") {
    return;
  }

  const isSettled =
    splitBill.personalDebts.length === 0 ||
    splitBill.personalDebts.every((debt) => getDebtRemainingAmount(debt) === 0);
  await tx.splitBill.update({
    where: { id: splitBillId },
    data: { status: isSettled ? "settled" : "open" },
  });
}

export async function listSplitBills(prisma: PrismaClient, status?: string) {
  const where: Prisma.SplitBillWhereInput = { deletedAt: null };
  if (status && status !== "all") {
    where.status = status as SplitBillStatus;
  }

  const splitBills = await prisma.splitBill.findMany({
    where,
    include: splitBillInclude,
    orderBy: [{ status: "asc" }, { paidDate: "desc" }, { createdAt: "desc" }],
  });

  return splitBills.map(serializeSplitBill);
}

export async function getSplitBill(prisma: PrismaClient, id: string) {
  const splitBill = await prisma.splitBill.findFirst({
    where: { id, deletedAt: null },
    include: splitBillInclude,
  });

  return splitBill ? serializeSplitBill(splitBill) : null;
}

export async function createSplitBill(prisma: PrismaClient, input: CreateSplitBillInput) {
  assertDate(input.paidDate, "paidDate");
  if (input.dueDate) {
    assertDate(input.dueDate, "dueDate");
  }

  return prisma.$transaction(async (tx) => {
    const splitMethod = input.splitMethod ?? "equal";
    if (splitMethod !== "equal") {
      throw new Error("Only equal split is supported");
    }
    const shares = previewEqualSplit(input.totalAmount, input.participants);
    const selfShare = shares.find((participant) => participant.isSelf);
    if (!selfShare) {
      throw new Error("Self participant is required");
    }
    if (input.payerType === "other" && !input.payerName?.trim()) {
      throw new Error("payerName is required when another person paid");
    }

    const paymentTransaction = input.payerType === "self"
      ? await createAccountingTransaction(tx, {
          accountId: input.accountId,
          date: input.paidDate,
          type: "expense",
          description: `割り勘: ${input.title}`,
          amount: input.totalAmount,
        })
      : null;

    const splitBill = await tx.splitBill.create({
      data: {
        title: input.title,
        totalAmount: input.totalAmount,
        paidDate: fromDateOnlyString(input.paidDate),
        payerType: input.payerType,
        payerName: input.payerType === "other" ? input.payerName?.trim() : null,
        accountId: input.accountId,
        splitMethod,
        dueDate: input.dueDate ? fromDateOnlyString(input.dueDate) : null,
        paymentTransactionId: paymentTransaction?.id ?? null,
        memo: input.memo ?? null,
      },
    });

    for (const participant of shares) {
      let personalDebtId: string | null = null;
      if (input.payerType === "self" && !participant.isSelf) {
        const debt = await tx.personalDebt.create({
          data: splitGeneratedDebtData({
            direction: "lent",
            counterpartyName: participant.name,
            title: input.title,
            principalAmount: participant.shareAmount,
            openedDate: input.paidDate,
            dueDate: input.dueDate ?? null,
            accountId: input.accountId,
            splitBillId: splitBill.id,
          }),
        });
        personalDebtId = debt.id;
      }
      if (input.payerType === "other" && participant.isSelf) {
        const debt = await tx.personalDebt.create({
          data: splitGeneratedDebtData({
            direction: "borrowed",
            counterpartyName: input.payerName!.trim(),
            title: input.title,
            principalAmount: participant.shareAmount,
            openedDate: input.paidDate,
            dueDate: input.dueDate ?? null,
            accountId: input.accountId,
            splitBillId: splitBill.id,
          }),
        });
        personalDebtId = debt.id;
      }

      await tx.splitBillParticipant.create({
        data: {
          splitBillId: splitBill.id,
          name: participant.name,
          isSelf: participant.isSelf,
          sortOrder: participant.sortOrder,
          shareAmount: participant.shareAmount,
          personalDebtId,
        },
      });
    }

    await refreshSplitBillStatus(tx, splitBill.id);
    const created = await tx.splitBill.findUniqueOrThrow({
      where: { id: splitBill.id },
      include: splitBillInclude,
    });
    return serializeSplitBill(created);
  });
}

function splitGeneratedDebtData(input: {
  direction: PersonalDebtDirection;
  counterpartyName: string;
  title: string;
  principalAmount: number;
  openedDate: string;
  dueDate: string | null;
  accountId: string;
  splitBillId: string;
}): Prisma.PersonalDebtUncheckedCreateInput {
  return {
    direction: input.direction,
    origin: "reimbursement",
    counterpartyName: input.counterpartyName,
    title: input.title,
    principalAmount: input.principalAmount,
    openedDate: fromDateOnlyString(input.openedDate),
    dueDate: input.dueDate ? fromDateOnlyString(input.dueDate) : null,
    accountId: input.accountId,
    sourceType: "split_bill" satisfies PersonalDebtSourceType,
    splitBillId: input.splitBillId,
  };
}

export async function updateSplitBill(prisma: PrismaClient, id: string, input: CreateSplitBillInput & { status?: string }) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.splitBill.findFirst({
      where: { id, deletedAt: null },
      include: {
        personalDebts: { include: { settlements: true } },
      },
    });
    if (!existing) {
      return null;
    }

    const hasSettlements = existing.personalDebts.some((debt) => debt.settlements.length > 0);
    if (hasSettlements) {
      throw new Error("Cannot update a split bill after settlements have been recorded");
    }

    const updated = await tx.splitBill.update({
      where: { id },
      data: {
        title: input.title,
        dueDate: input.dueDate ? fromDateOnlyString(input.dueDate) : null,
        memo: input.memo ?? null,
        status: (input.status ?? existing.status) as SplitBillStatus,
      },
      include: splitBillInclude,
    });
    return serializeSplitBill(updated);
  });
}

export async function cancelSplitBill(prisma: PrismaClient, id: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.splitBill.findFirst({
      where: { id, deletedAt: null },
      include: {
        personalDebts: { include: { settlements: true } },
      },
    });
    if (!existing) {
      return null;
    }
    if (existing.personalDebts.some((debt) => debt.settlements.length > 0)) {
      throw new Error("Cannot cancel a split bill after settlements have been recorded");
    }

    if (existing.paymentTransactionId) {
      const payment = await tx.transaction.findUnique({ where: { id: existing.paymentTransactionId } });
      if (payment && !payment.deletedAt) {
        await revertTransactionEffect(tx, payment);
        await tx.transaction.update({
          where: { id: payment.id },
          data: { deletedAt: new Date() },
        });
      }
    }

    await tx.personalDebt.updateMany({
      where: { splitBillId: id },
      data: { status: "canceled", deletedAt: new Date() },
    });
    const canceled = await tx.splitBill.update({
      where: { id },
      data: { status: "canceled", deletedAt: new Date() },
      include: splitBillInclude,
    });
    return serializeSplitBill(canceled);
  });
}

export async function getDebtDueForecastEvents(prisma: PrismaClient) {
  const debts = await prisma.personalDebt.findMany({
    where: {
      deletedAt: null,
      status: "open",
      dueDate: { not: null },
    },
    include: debtInclude,
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });

  return debts
    .map((debt) => ({
      id: `personal-debt:${debt.id}:${serializeDate(debt.dueDate)}`,
      date: serializeDate(debt.dueDate)!,
      type: debt.direction === "lent" ? "income" as const : "expense" as const,
      description: `精算予定: ${debt.title} (${debt.counterpartyName})`,
      amount: getDebtRemainingAmount(debt),
      accountId: debt.accountId,
      debtId: debt.id,
    }))
    .filter((event) => event.amount > 0);
}
