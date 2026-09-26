import { transactionTypeSchema, uuidSchema } from "../schemas/fields";
import { Hono } from "hono";
import type { Prisma } from "@sui/db";
import { z } from "zod";
import { prisma } from "../lib/db";
import { normalizeCurrencyCode, toJpy } from "../lib/currency";
import { fromDateOnlyString, getJstToday, isDateString } from "../lib/dates";
import { badRequest, handleRouteError, notFound } from "../lib/http";
import { transactionPayloadSchema as payloadSchema, type TransactionPayload } from "../schemas/transactions";
import { createTransaction, deleteTransaction, updateTransaction } from "../services/transactions";
import { getBalanceHistory } from "../services/balance-history";

const listQuerySchema = z
  .object({
    id: uuidSchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100, "limit must be less than or equal to 100").default(20),
    accountId: uuidSchema.optional(),
    type: transactionTypeSchema.optional(),
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
    accountId: uuidSchema.optional(),
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
      if (validationError) return badRequest(c, validationError);
      return c.json(await createTransaction(body), 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .put("/:id", async (c) => {
    try {
      const body = payloadSchema.parse(await c.req.json());
      const validationError = validatePayload(body);
      if (validationError) return badRequest(c, validationError);
      return c.json(await updateTransaction(c.req.param("id"), body));
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id", async (c) => {
    try {
      await deleteTransaction(c.req.param("id"));
      return c.body(null, 204);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
