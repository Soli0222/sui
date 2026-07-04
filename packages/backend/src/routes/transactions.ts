import { Hono } from "hono";
import type { Prisma, TransactionType } from "@sui/db";
import { z } from "zod";
import { prisma } from "../lib/db";
import { normalizeCurrencyCode, toJpy } from "../lib/currency";
import { fromDateOnlyString, getJstToday, isDateString, toDateOnlyString } from "../lib/dates";
import { BadRequestError, badRequest, handleRouteError, notFound } from "../lib/http";
import { positiveInt32Schema } from "../lib/validation";

const payloadSchema = z.object({
  accountId: z.string().uuid().nullish(),
  transferToAccountId: z.string().uuid().nullish(),
  date: z.string(),
  type: z.enum(["income", "expense", "transfer"]),
  description: z.string().min(1).max(200),
  amount: positiveInt32Schema(),
});

const listQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100, "limit must be less than or equal to 100").default(20),
    accountId: z.string().uuid().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && !isDateString(value.startDate)) {
      ctx.addIssue({
        code: "custom",
        message: "startDate must be YYYY-MM-DD",
        path: ["startDate"],
      });
    }

    if (value.endDate && !isDateString(value.endDate)) {
      ctx.addIssue({
        code: "custom",
        message: "endDate must be YYYY-MM-DD",
        path: ["endDate"],
      });
    }

    if (
      value.startDate &&
      value.endDate &&
      isDateString(value.startDate) &&
      isDateString(value.endDate) &&
      value.startDate > value.endDate
    ) {
      ctx.addIssue({
        code: "custom",
        message: "startDate must be less than or equal to endDate",
        path: ["startDate"],
      });
    }
  });

const balanceHistoryQuerySchema = z
  .object({
    accountId: z.string().uuid().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    applyOffset: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && !isDateString(value.startDate)) {
      ctx.addIssue({
        code: "custom",
        message: "startDate must be YYYY-MM-DD",
        path: ["startDate"],
      });
    }

    if (value.endDate && !isDateString(value.endDate)) {
      ctx.addIssue({
        code: "custom",
        message: "endDate must be YYYY-MM-DD",
        path: ["endDate"],
      });
    }

    if (
      value.startDate &&
      value.endDate &&
      isDateString(value.startDate) &&
      isDateString(value.endDate) &&
      value.startDate > value.endDate
    ) {
      ctx.addIssue({
        code: "custom",
        message: "startDate must be less than or equal to endDate",
        path: ["startDate"],
      });
    }
  });

type BalanceHistoryTransaction = {
  accountId: string | null;
  transferToAccountId: string | null;
  date: Date;
  type: TransactionType;
  description: string;
  amount: number;
  createdAt: Date;
  account: CurrencyAccount | null;
  transferToAccount: CurrencyAccount | null;
};

type CurrencyAccount = {
  currencyCode: string;
  exchangeRateToJpy: number;
};

type TransactionPayload = z.infer<typeof payloadSchema>;

const fallbackCurrencyAccount: CurrencyAccount = {
  currencyCode: "JPY",
  exchangeRateToJpy: 1,
};

function getTransactionCurrencyAccount(transaction: {
  account?: CurrencyAccount | null;
  transferToAccount?: CurrencyAccount | null;
}) {
  return transaction.account ?? transaction.transferToAccount ?? fallbackCurrencyAccount;
}

function validatePayload(body: TransactionPayload) {
  if (!isDateString(body.date)) {
    return "date must be YYYY-MM-DD";
  }

  if (body.type === "transfer") {
    if (!body.accountId && !body.transferToAccountId) {
      return "accountId or transferToAccountId is required for transfer";
    }
  } else {
    if (!body.accountId) {
      return "accountId is required";
    }
    if (body.transferToAccountId) {
      return "transferToAccountId is only allowed for transfer";
    }
  }

  if (body.accountId && body.accountId === body.transferToAccountId) {
    return "transfer accounts must be different";
  }

  return null;
}

function buildBalanceHistoryScope(accountId?: string): Prisma.TransactionWhereInput {
  if (!accountId) {
    return {};
  }

  return {
    OR: [
      { accountId },
      { transferToAccountId: accountId },
    ],
  };
}

function revertBalanceFromTransaction(
  balance: number,
  transaction: BalanceHistoryTransaction,
  accountId?: string,
) {
  const amount = accountId
    ? transaction.amount
    : toJpy(transaction.amount, getTransactionCurrencyAccount(transaction));

  if (!accountId) {
    if (transaction.type === "adjustment") {
      return balance - amount;
    }

    if (transaction.type === "income") {
      return balance - amount;
    }

    if (transaction.type === "expense") {
      return balance + amount;
    }

    if (!transaction.accountId) {
      return balance - amount;
    }

    if (!transaction.transferToAccountId) {
      return balance + amount;
    }

    return balance;
  }

  if (transaction.type === "adjustment") {
    return transaction.accountId === accountId ? balance - amount : balance;
  }

  if (transaction.type === "income") {
    return transaction.accountId === accountId ? balance - amount : balance;
  }

  if (transaction.type === "expense") {
    return transaction.accountId === accountId ? balance + amount : balance;
  }

  if (transaction.accountId === accountId) {
    return balance + amount;
  }

  if (transaction.transferToAccountId === accountId) {
    return balance - amount;
  }

  return balance;
}

function summarizeTransactions(transactions: BalanceHistoryTransaction[]) {
  if (transactions.length === 0) {
    return "";
  }

  const [first] = transactions;
  return transactions.length === 1
    ? first.description
    : `${first.description} 他${transactions.length - 1}件`;
}

async function ensureActiveAccount(
  tx: Prisma.TransactionClient,
  accountId: string | null | undefined,
  missingMessage: string,
) {
  if (!accountId) {
    throw new BadRequestError(missingMessage);
  }

  const account = await tx.account.findFirst({
    where: { id: accountId, deletedAt: null },
  });
  if (!account) {
    throw new BadRequestError(missingMessage);
  }

  return account;
}

async function applyBalanceEffect(
  tx: Prisma.TransactionClient,
  transaction: {
    accountId?: string | null;
    transferToAccountId?: string | null;
    type: TransactionType;
    amount: number;
  },
) {
  if (transaction.type === "adjustment") {
    if (!transaction.accountId) {
      throw new BadRequestError("Source account not found");
    }
    await tx.account.update({
      where: { id: transaction.accountId },
      data: { balance: { increment: transaction.amount } },
    });
    return;
  }

  if (transaction.type === "income") {
    if (!transaction.accountId) {
      throw new BadRequestError("Source account not found");
    }
    await tx.account.update({
      where: { id: transaction.accountId },
      data: { balance: { increment: transaction.amount } },
    });
    return;
  }

  if (transaction.type === "expense") {
    if (!transaction.accountId) {
      throw new BadRequestError("Source account not found");
    }
    await tx.account.update({
      where: { id: transaction.accountId },
      data: { balance: { decrement: transaction.amount } },
    });
    return;
  }

  if (transaction.accountId) {
    await tx.account.update({
      where: { id: transaction.accountId },
      data: { balance: { decrement: transaction.amount } },
    });
  }

  if (transaction.transferToAccountId) {
    await tx.account.update({
      where: { id: transaction.transferToAccountId },
      data: { balance: { increment: transaction.amount } },
    });
  }
}

async function revertBalanceEffect(
  tx: Prisma.TransactionClient,
  transaction: {
    accountId?: string | null;
    transferToAccountId?: string | null;
    type: TransactionType;
    amount: number;
  },
) {
  if (transaction.type === "adjustment") {
    if (!transaction.accountId) {
      throw new BadRequestError("Source account not found");
    }
    await tx.account.update({
      where: { id: transaction.accountId },
      data: { balance: { increment: -transaction.amount } },
    });
    return;
  }

  if (transaction.type === "income") {
    if (!transaction.accountId) {
      throw new BadRequestError("Source account not found");
    }
    await tx.account.update({
      where: { id: transaction.accountId },
      data: { balance: { decrement: transaction.amount } },
    });
    return;
  }

  if (transaction.type === "expense") {
    if (!transaction.accountId) {
      throw new BadRequestError("Source account not found");
    }
    await tx.account.update({
      where: { id: transaction.accountId },
      data: { balance: { increment: transaction.amount } },
    });
    return;
  }

  if (transaction.accountId) {
    await tx.account.update({
      where: { id: transaction.accountId },
      data: { balance: { increment: transaction.amount } },
    });
  }

  if (transaction.transferToAccountId) {
    await tx.account.update({
      where: { id: transaction.transferToAccountId },
      data: { balance: { decrement: transaction.amount } },
    });
  }
}

export const transactionsRoutes = new Hono()
  .get("/", async (c) => {
    try {
      const { page, limit, accountId, startDate, endDate } = listQuerySchema.parse({
        page: c.req.query("page"),
        limit: c.req.query("limit"),
        accountId: c.req.query("accountId"),
        startDate: c.req.query("startDate"),
        endDate: c.req.query("endDate"),
      });

      const where: Prisma.TransactionWhereInput = { deletedAt: null };
      if (accountId) {
        where.OR = [
          { accountId },
          { transferToAccountId: accountId },
        ];
      }
      if (startDate || endDate) {
        where.date = {
          ...(startDate ? { gte: fromDateOnlyString(startDate) } : {}),
          ...(endDate ? { lte: fromDateOnlyString(endDate) } : {}),
        };
      }

      const [items, total] = await Promise.all([
        prisma.transaction.findMany({
          where,
          include: {
            account: true,
            transferToAccount: true,
          },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.transaction.count({ where }),
      ]);

      return c.json({
        items: items.map((item) => ({
          ...item,
          date: item.date.toISOString().slice(0, 10),
          createdAt: item.createdAt.toISOString(),
          currencyCode: normalizeCurrencyCode(getTransactionCurrencyAccount(item).currencyCode),
          amountJpy: toJpy(item.amount, getTransactionCurrencyAccount(item)),
          accountName: item.account?.name ?? null,
          transferToAccountCurrencyCode: item.transferToAccount
            ? normalizeCurrencyCode(item.transferToAccount.currencyCode)
            : null,
          transferToAccountName: item.transferToAccount?.name ?? null,
        })),
        page,
        limit,
        total,
      });
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .get("/balance-history", async (c) => {
    try {
      const { accountId, startDate, endDate, applyOffset } = balanceHistoryQuerySchema.parse({
        accountId: c.req.query("accountId"),
        startDate: c.req.query("startDate"),
        endDate: c.req.query("endDate"),
        applyOffset: c.req.query("applyOffset"),
      });

      const resolvedEndDate = endDate ?? getJstToday();
      const account = accountId
        ? await prisma.account.findFirst({
            where: { id: accountId, deletedAt: null },
            select: {
              id: true,
              balance: true,
              balanceOffset: true,
              currencyCode: true,
              exchangeRateToJpy: true,
            },
          })
        : null;

      if (accountId && !account) {
        return notFound(c, "Account not found");
      }

      const currentBalance = account
        ? account.balance - (applyOffset ? account.balanceOffset : 0)
        : await prisma.account.findMany({
            where: { deletedAt: null },
            select: {
              balance: true,
              balanceOffset: true,
              currencyCode: true,
              exchangeRateToJpy: true,
            },
          }).then((accounts) =>
            accounts.reduce(
              (sum, item) => sum + toJpy(item.balance - (applyOffset ? item.balanceOffset : 0), item),
              0,
            ));
      const responseCurrencyCode = account ? normalizeCurrencyCode(account.currencyCode) : "JPY";
      const scope = buildBalanceHistoryScope(accountId);
      const [transactionsAfterRange, transactionsInRange] = await Promise.all([
        prisma.transaction.findMany({
          where: {
            deletedAt: null,
            ...scope,
            date: { gt: fromDateOnlyString(resolvedEndDate) },
          },
          select: {
            accountId: true,
            transferToAccountId: true,
            date: true,
            type: true,
            description: true,
            amount: true,
            createdAt: true,
            account: {
              select: {
                currencyCode: true,
                exchangeRateToJpy: true,
              },
            },
            transferToAccount: {
              select: {
                currencyCode: true,
                exchangeRateToJpy: true,
              },
            },
          },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        }),
        prisma.transaction.findMany({
          where: {
            deletedAt: null,
            ...scope,
            date: {
              ...(startDate ? { gte: fromDateOnlyString(startDate) } : {}),
              lte: fromDateOnlyString(resolvedEndDate),
            },
          },
          select: {
            accountId: true,
            transferToAccountId: true,
            date: true,
            type: true,
            description: true,
            amount: true,
            createdAt: true,
            account: {
              select: {
                currencyCode: true,
                exchangeRateToJpy: true,
              },
            },
            transferToAccount: {
              select: {
                currencyCode: true,
                exchangeRateToJpy: true,
              },
            },
          },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        }),
      ]);

      let balance = transactionsAfterRange.reduce(
        (current, transaction) => revertBalanceFromTransaction(current, transaction, accountId),
        currentBalance,
      );
      const points: Array<{
        date: string;
        balance: number;
        balanceJpy: number;
        currencyCode: ReturnType<typeof normalizeCurrencyCode>;
        description: string;
      }> = [];
      let currentDate: string | null = null;
      let dayTransactions: BalanceHistoryTransaction[] = [];

      const flushDay = () => {
        if (!currentDate || dayTransactions.length === 0) {
          return;
        }

        const chronologicalTransactions = [...dayTransactions].reverse();
        points.push({
          date: currentDate,
          balance,
          balanceJpy: account ? toJpy(balance, account) : balance,
          currencyCode: responseCurrencyCode,
          description: summarizeTransactions(chronologicalTransactions),
        });

        for (const transaction of dayTransactions) {
          balance = revertBalanceFromTransaction(balance, transaction, accountId);
        }

        dayTransactions = [];
      };

      for (const transaction of transactionsInRange) {
        const transactionDate = toDateOnlyString(transaction.date);
        if (!transactionDate) {
          continue;
        }

        if (currentDate !== transactionDate) {
          flushDay();
          currentDate = transactionDate;
        }

        dayTransactions.push(transaction);
      }

      flushDay();

      return c.json({
        points: points.reverse(),
      });
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .post("/", async (c) => {
    try {
      const body = payloadSchema.parse(await c.req.json());
      const validationError = validatePayload(body);
      if (validationError) {
        return badRequest(c, validationError);
      }

      const date = new Date(`${body.date}T00:00:00.000Z`);

      const transaction = await prisma.$transaction(async (tx) => {
        const sourceAccount = body.accountId
          ? await ensureActiveAccount(tx, body.accountId, "Source account not found")
          : null;
        const destinationAccount = body.transferToAccountId
          ? await ensureActiveAccount(tx, body.transferToAccountId, "Destination account not found")
          : null;
        if (body.type === "transfer" && sourceAccount && destinationAccount) {
          if (
            normalizeCurrencyCode(sourceAccount.currencyCode) !==
            normalizeCurrencyCode(destinationAccount.currencyCode)
          ) {
            throw new BadRequestError("Cross-currency transfers are not supported");
          }
        }

        await applyBalanceEffect(tx, body);

        return tx.transaction.create({
          data: {
            accountId: body.accountId ?? null,
            transferToAccountId: body.transferToAccountId ?? null,
            date,
            type: body.type,
            description: body.description,
            amount: body.amount,
          },
        });
      });

      return c.json(transaction, 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .put("/:id", async (c) => {
    try {
      const existing = await prisma.transaction.findFirst({
        where: { id: c.req.param("id"), deletedAt: null },
      });
      if (!existing) {
        return notFound(c, "Transaction not found");
      }
      if (existing.type === "adjustment") {
        return badRequest(c, "Adjustment transactions cannot be edited");
      }

      const body = payloadSchema.parse(await c.req.json());
      const validationError = validatePayload(body);
      if (validationError) {
        return badRequest(c, validationError);
      }

      const date = new Date(`${body.date}T00:00:00.000Z`);

      const transaction = await prisma.$transaction(async (tx) => {
        const sourceAccount = body.accountId
          ? await ensureActiveAccount(tx, body.accountId, "Source account not found")
          : null;
        const destinationAccount = body.transferToAccountId
          ? await ensureActiveAccount(tx, body.transferToAccountId, "Destination account not found")
          : null;
        if (body.type === "transfer" && sourceAccount && destinationAccount) {
          if (
            normalizeCurrencyCode(sourceAccount.currencyCode) !==
            normalizeCurrencyCode(destinationAccount.currencyCode)
          ) {
            throw new BadRequestError("Cross-currency transfers are not supported");
          }
        }

        await revertBalanceEffect(tx, existing);
        await applyBalanceEffect(tx, body);

        return tx.transaction.update({
          where: { id: existing.id },
          data: {
            accountId: body.accountId ?? null,
            transferToAccountId: body.transferToAccountId ?? null,
            date,
            type: body.type,
            description: body.description,
            amount: body.amount,
          },
        });
      });

      return c.json(transaction);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id", async (c) => {
    try {
      const existing = await prisma.transaction.findFirst({
        where: { id: c.req.param("id"), deletedAt: null },
      });
      if (!existing) {
        return notFound(c, "Transaction not found");
      }
      if (existing.forecastEventId !== null) {
        return c.json({ error: "Forecast-confirmed transactions cannot be deleted" }, 403);
      }

      await prisma.$transaction(async (tx) => {
        await revertBalanceEffect(tx, existing);
        await tx.transaction.update({
          where: { id: existing.id },
          data: { deletedAt: new Date() },
        });
      });

      return c.body(null, 204);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
