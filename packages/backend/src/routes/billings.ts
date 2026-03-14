import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/db";
import {
  fromDateOnlyString,
  getCurrentYearMonth,
  getJstToday,
  isDateString,
  isYearMonth,
  toDateOnlyString,
} from "../lib/dates";
import { badRequest, handleRouteError } from "../lib/http";
import { nonNegativeInt32Schema } from "../lib/validation";
import { getBillingMonthOffset, resolveBillingAmount } from "../services/billings";

const payloadSchema = z.object({
  settlementDate: z.string().optional(),
  items: z.array(
    z.object({
      creditCardId: z.string().uuid(),
      amount: nonNegativeInt32Schema(),
    }),
  ),
});

export const billingsRoutes = new Hono()
  .get("/", async (c) => {
    const month = c.req.query("month");
    if (!month || !isYearMonth(month)) {
      return badRequest(c, "month query must be YYYY-MM");
    }

    const [billing, cards] = await Promise.all([
      prisma.creditCardBilling.findUnique({
        where: { yearMonth: month },
        include: { items: true },
      }),
      prisma.creditCard.findMany({
        where: { deletedAt: null },
      }),
    ]);

    const total = billing?.items.reduce((sum, item) => sum + item.amount, 0) ?? 0;
    const currentYearMonth = getCurrentYearMonth(getJstToday());
    const monthOffset = getBillingMonthOffset(currentYearMonth, month);
    const resolvedItems = cards.map((card) =>
      resolveBillingAmount({
        actualAmount: billing?.items.find((item) => item.creditCardId === card.id)?.amount ?? null,
        assumptionAmount: card.assumptionAmount,
        monthOffset,
      }),
    );
    const appliedTotal = resolvedItems.reduce((sum, item) => sum + item.amount, 0);

    const hasAnyActual = (billing?.items.length ?? 0) > 0;
    const safetyValveActive = resolvedItems.some((item) => item.safetyValveApplied);
    const sourceType = safetyValveActive ? "safety-valve" : hasAnyActual ? "actual" : "assumption";

    return c.json({
      yearMonth: month,
      settlementDate: billing?.settlementDate ? toDateOnlyString(billing.settlementDate) : null,
      resolvedSettlementDate: billing?.settlementDate ? toDateOnlyString(billing.settlementDate) : null,
      items:
        billing?.items.map((item) => ({
          creditCardId: item.creditCardId,
          amount: item.amount,
        })) ?? [],
      total,
      appliedTotal,
      safetyValveActive,
      sourceType,
      monthOffset,
    });
  })
  .put("/:yearMonth", async (c) => {
    try {
      const yearMonth = c.req.param("yearMonth");
      if (!isYearMonth(yearMonth)) {
        return badRequest(c, "yearMonth must be YYYY-MM");
      }

      const body = payloadSchema.parse(await c.req.json());
      if (body.settlementDate && !isDateString(body.settlementDate)) {
        return badRequest(c, "settlementDate must be YYYY-MM-DD");
      }

      const billing = await prisma.creditCardBilling.upsert({
        where: { yearMonth },
        update: {
          settlementDate: body.settlementDate ? fromDateOnlyString(body.settlementDate) : null,
        },
        create: {
          yearMonth,
          settlementDate: body.settlementDate ? fromDateOnlyString(body.settlementDate) : null,
        },
      });

      await prisma.$transaction([
        prisma.creditCardItem.deleteMany({
          where: { billingId: billing.id },
        }),
        ...body.items.map((item) =>
          prisma.creditCardItem.create({
            data: {
              billingId: billing.id,
              creditCardId: item.creditCardId,
              amount: item.amount,
            },
          }),
        ),
      ]);

      const currentYearMonth = getCurrentYearMonth(getJstToday());
      const monthOffset = getBillingMonthOffset(currentYearMonth, yearMonth);
      const [updated, cards] = await Promise.all([
        prisma.creditCardBilling.findUniqueOrThrow({
          where: { yearMonth },
          include: { items: true },
        }),
        prisma.creditCard.findMany({
          where: { deletedAt: null },
        }),
      ]);
      const resolvedItems = cards.map((card) =>
        resolveBillingAmount({
          actualAmount: updated.items.find((item) => item.creditCardId === card.id)?.amount ?? null,
          assumptionAmount: card.assumptionAmount,
          monthOffset,
        }),
      );
      const safetyValveActive = resolvedItems.some((item) => item.safetyValveApplied);

      return c.json({
        yearMonth,
        settlementDate: updated.settlementDate ? toDateOnlyString(updated.settlementDate) : null,
        resolvedSettlementDate: updated.settlementDate ? toDateOnlyString(updated.settlementDate) : null,
        items: updated.items.map((item) => ({
          creditCardId: item.creditCardId,
          amount: item.amount,
        })),
        total: updated.items.reduce((sum, item) => sum + item.amount, 0),
        appliedTotal: resolvedItems.reduce((sum, item) => sum + item.amount, 0),
        safetyValveActive,
        sourceType: safetyValveActive ? "safety-valve" : updated.items.length > 0 ? "actual" : "assumption",
        monthOffset,
      });
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
