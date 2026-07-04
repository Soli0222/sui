import { Hono } from "hono";
import { DEFAULT_CURRENCY_CODE, DEFAULT_EXCHANGE_RATE_TO_JPY, INT4_MAX, INT4_MIN } from "@sui/shared";
import { z } from "zod";
import { prisma } from "../lib/db";
import { currencyCodeSchema, normalizeExchangeRateToJpy } from "../lib/currency";
import { fromDateOnlyString, getJstToday } from "../lib/dates";
import { BadRequestError, handleRouteError, notFound } from "../lib/http";
import { int32Schema } from "../lib/validation";

const payloadSchema = z.object({
  name: z.string().min(1).max(100),
  balance: int32Schema(),
  balanceOffset: int32Schema().default(0),
  currencyCode: z
    .preprocess((value) => (typeof value === "string" ? value.toUpperCase() : value), currencyCodeSchema)
    .default(DEFAULT_CURRENCY_CODE),
  exchangeRateToJpy: z.coerce.number().finite().positive().default(DEFAULT_EXCHANGE_RATE_TO_JPY),
  sortOrder: int32Schema(),
}).transform((value) => ({
  ...value,
  exchangeRateToJpy: normalizeExchangeRateToJpy(value.currencyCode, value.exchangeRateToJpy),
}));

const reconcilePayloadSchema = z.object({
  actualBalance: int32Schema(),
});

function serializeAdjustment(
  adjustment: {
    date: Date;
    createdAt: Date;
    deletedAt: Date | null;
  } & Record<string, unknown>,
) {
  return {
    ...adjustment,
    date: adjustment.date.toISOString().slice(0, 10),
    createdAt: adjustment.createdAt.toISOString(),
    deletedAt: adjustment.deletedAt?.toISOString() ?? null,
  };
}

function assertAdjustmentAmount(amount: number) {
  if (amount < INT4_MIN || amount > INT4_MAX) {
    throw new BadRequestError("Adjustment amount must fit in int32");
  }
}

export const accountsRoutes = new Hono()
  .get("/", async (c) => {
    const accounts = await prisma.account.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return c.json(accounts);
  })
  .post("/", async (c) => {
    try {
      const body = payloadSchema.parse(await c.req.json());
      const account = await prisma.account.create({ data: body });
      return c.json(account, 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .post("/:id/reconcile", async (c) => {
    try {
      const body = reconcilePayloadSchema.parse(await c.req.json());
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.account.findFirst({
          where: { id: c.req.param("id"), deletedAt: null },
        });
        if (!existing) {
          return null;
        }

        const diff = body.actualBalance - existing.balance;
        let adjustment = null;
        if (diff !== 0) {
          assertAdjustmentAmount(diff);
          adjustment = await tx.transaction.create({
            data: {
              accountId: existing.id,
              transferToAccountId: null,
              date: fromDateOnlyString(getJstToday()),
              type: "adjustment",
              description: "残高照合",
              amount: diff,
            },
          });
        }
        const account = await tx.account.update({
          where: { id: existing.id },
          data: {
            balance: body.actualBalance,
            lastReconciledAt: new Date(),
          },
        });

        return {
          account,
          adjustment: adjustment ? serializeAdjustment(adjustment) : null,
          diff,
        };
      });

      if (!result) {
        return notFound(c, "Account not found");
      }

      return c.json(result);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .put("/:id", async (c) => {
    try {
      const body = payloadSchema.parse(await c.req.json());
      const account = await prisma.$transaction(async (tx) => {
        const existing = await tx.account.findFirst({
          where: { id: c.req.param("id"), deletedAt: null },
        });
        if (!existing) {
          return null;
        }

        const diff = body.balance - existing.balance;
        if (diff !== 0) {
          assertAdjustmentAmount(diff);
          await tx.transaction.create({
            data: {
              accountId: existing.id,
              transferToAccountId: null,
              date: fromDateOnlyString(getJstToday()),
              type: "adjustment",
              description: "残高調整（口座編集）",
              amount: diff,
            },
          });
        }

        return tx.account.update({
          where: { id: existing.id },
          data: {
            ...body,
            exchangeRateUpdatedAt:
              body.currencyCode !== existing.currencyCode ||
              body.exchangeRateToJpy !== existing.exchangeRateToJpy
                ? new Date()
                : undefined,
          },
        });
      });
      if (!account) {
        return notFound(c, "Account not found");
      }

      return c.json(account);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id", async (c) => {
    const existing = await prisma.account.findFirst({
      where: { id: c.req.param("id"), deletedAt: null },
    });
    if (!existing) {
      return notFound(c, "Account not found");
    }

    await prisma.account.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    return c.body(null, 204);
  });
