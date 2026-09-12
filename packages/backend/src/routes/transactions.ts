import { Hono } from "hono";
import type { Prisma, TransactionType } from "@sui/db";
import { z } from "zod";
import { prisma } from "../lib/db";
import { normalizeCurrencyCode, toJpy } from "../lib/currency";
import { fromDateOnlyString, getJstToday, isDateString } from "../lib/dates";
import { BadRequestError, HttpError, NotFoundError, badRequest, handleRouteError, notFound } from "../lib/http";
import { positiveInt32Schema } from "../lib/validation";
import { getBalanceHistory } from "../services/balance-history";
import { mutateLedger } from "../services/ledger-transaction";

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
    id: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100, "limit must be less than or equal to 100").default(20),
    accountId: z.string().uuid().optional(),
    type: z.enum(["income", "expense", "transfer"]).optional(),
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
      const { id, page, limit, accountId, type, startDate, endDate } = listQuerySchema.parse({
        id: c.req.query("id"),
        page: c.req.query("page"),
        limit: c.req.query("limit"),
        accountId: c.req.query("accountId"),
        type: c.req.query("type"),
        startDate: c.req.query("startDate"),
        endDate: c.req.query("endDate"),
      });

      const where: Prisma.TransactionWhereInput = { deletedAt: null, ...(id ? { id } : {}) };
      if (type) {
        where.type = type;
      }
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
            settlements: { include: { allocations: true } },
          },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.transaction.count({ where }),
      ]);

      return c.json({
        items: items.map((item) => {
          const { settlements, ...rest } = item;
          const settlementAllocatedAmount = settlements.reduce(
            (sum, settlement) =>
              sum + settlement.allocations.reduce((a, allocation) => a + allocation.amount, 0),
            0,
          );
          const settlementRemainingAmount = Math.max(0, rest.amount - settlementAllocatedAmount);
          return {
            ...rest,
            date: rest.date.toISOString().slice(0, 10),
            createdAt: rest.createdAt.toISOString(),
            currencyCode: normalizeCurrencyCode(getTransactionCurrencyAccount(item).currencyCode),
            amountJpy: toJpy(rest.amount, getTransactionCurrencyAccount(item)),
            accountName: rest.account?.name ?? null,
            transferToAccountCurrencyCode: rest.transferToAccount
              ? normalizeCurrencyCode(rest.transferToAccount.currencyCode)
              : null,
            transferToAccountName: rest.transferToAccount?.name ?? null,
            settlementLinked: settlementAllocatedAmount > 0,
            settlementAllocatedAmount,
            settlementRemainingAmount,
          };
        }),
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

      const result = await getBalanceHistory(accountId, startDate, endDate ?? getJstToday(), applyOffset);
      if (!result) return notFound(c, "Account not found");
      return c.json(result);
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

      const transaction = await mutateLedger(async (tx) => {
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
      const body = payloadSchema.parse(await c.req.json());
      const validationError = validatePayload(body);
      if (validationError) {
        return badRequest(c, validationError);
      }

      const date = new Date(`${body.date}T00:00:00.000Z`);

      const transaction = await mutateLedger(async (tx) => {
        const existing = await tx.transaction.findFirst({
          where: { id: c.req.param("id"), deletedAt: null },
          include: {
            settlements: { include: { allocations: true } },
          },
        });
        if (!existing) {
          throw new NotFoundError("Transaction not found");
        }
        if (existing.type === "adjustment") {
          throw new BadRequestError("Adjustment transactions cannot be edited");
        }

        if (existing.settlements.length > 0 && body.type !== existing.type) {
          throw new BadRequestError("Transaction type cannot be changed while linked to a settlement");
        }
        if (existing.settlements.length > 0 && existing.type === "transfer" && !existing.accountId && body.accountId) {
          throw new BadRequestError("Cannot add a source account to a settlement-linked transfer");
        }

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

        const settledAmountForTransaction = existing.settlements.reduce(
          (sum, settlement) => sum + settlement.allocations.reduce((a, allocation) => a + allocation.amount, 0),
          0,
        );
        if (body.amount < settledAmountForTransaction) {
          throw new BadRequestError("New amount is less than linked settlement allocations");
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
      await mutateLedger(async (tx) => {
        const existing = await tx.transaction.findFirst({
          where: { id: c.req.param("id"), deletedAt: null },
          include: {
            settlements: true,
          },
        });
        if (!existing) {
          throw new NotFoundError("Transaction not found");
        }
        if (existing.forecastEventId !== null) {
          throw new HttpError(403, "Forecast-confirmed transactions cannot be deleted");
        }
        if (existing.settlements.length > 0) {
          throw new HttpError(409, "Transactions linked to settlements cannot be deleted");
        }

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
