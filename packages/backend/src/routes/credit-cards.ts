import { Hono } from "hono";
import { z } from "zod";
import { hasOverlappingAssumptions, isValidYearMonth } from "@sui/shared";
import { prisma } from "../lib/db";
import { getCurrentYearMonth, getJstToday } from "../lib/dates";
import { badRequest, handleRouteError, notFound } from "../lib/http";
import { int32Schema, nonNegativeInt32Schema } from "../lib/validation";
import { buildCreditCardAssumptionSuggestion } from "../services/credit-card-assumptions";

const dateShiftPolicySchema = z.enum(["none", "previous", "next"]);
const assumptionMonthSchema = z.string().refine(isValidYearMonth, "YYYY-MM の実在する年月を指定してください").nullable();
const assumptionSchema = z.object({
  amount: nonNegativeInt32Schema(),
  startMonth: assumptionMonthSchema,
  endMonth: assumptionMonthSchema,
}).refine((period) => !period.startMonth || !period.endMonth || period.startMonth <= period.endMonth, {
  message: "開始月は終了月以前にしてください",
  path: ["endMonth"],
});

const basePayloadSchema = z.object({
  name: z.string().min(1).max(100),
  settlementDay: z.number().int().min(1).max(31).nullable().optional(),
  accountId: z.string().uuid(),
  assumptionAmount: nonNegativeInt32Schema().optional(),
  assumptions: z.array(assumptionSchema).refine((periods) => !hasOverlappingAssumptions(periods), "同じカードの適用期間は重複できません").optional(),
  sortOrder: int32Schema(),
});

const createPayloadSchema = basePayloadSchema.safeExtend({
  dateShiftPolicy: dateShiftPolicySchema.optional().default("none"),
});

const updatePayloadSchema = basePayloadSchema.safeExtend({
  dateShiftPolicy: dateShiftPolicySchema.optional(),
});

const suggestionQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(60).optional().default(6),
});

function buildCreditCardData(body: z.infer<typeof createPayloadSchema> | z.infer<typeof updatePayloadSchema>, legacyAmount: number) {
  return {
    name: body.name,
    settlementDay: body.settlementDay,
    accountId: body.accountId,
    assumptionAmount: legacyAmount,
    sortOrder: body.sortOrder,
    ...(body.dateShiftPolicy !== undefined ? { dateShiftPolicy: body.dateShiftPolicy } : {}),
  };
}

function assumptionRecords(periods: z.infer<typeof assumptionSchema>[]) {
  return periods.map((period, sortOrder) => ({ ...period, sortOrder }));
}

export const creditCardsRoutes = new Hono()
  .get("/", async (c) => {
    const cards = await prisma.creditCard.findMany({
      where: { deletedAt: null },
      include: { account: true, assumptions: { orderBy: { sortOrder: "asc" } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return c.json(cards);
  })
  .get("/:id/assumption-suggestion", async (c) => {
    try {
      const card = await prisma.creditCard.findFirst({
        where: { id: c.req.param("id"), deletedAt: null },
        select: { id: true },
      });
      if (!card) {
        return notFound(c, "Credit card not found");
      }

      const query = suggestionQuerySchema.parse({
        months: c.req.query("months") ?? undefined,
      });
      const suggestion = await buildCreditCardAssumptionSuggestion(prisma, {
        creditCardId: card.id,
        currentYearMonth: getCurrentYearMonth(getJstToday()),
        months: query.months,
      });

      return c.json(suggestion);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .post("/", async (c) => {
    try {
      const body = createPayloadSchema.parse(await c.req.json());
      if (body.assumptions === undefined && body.assumptionAmount === undefined) {
        return c.json({ error: "assumptions or assumptionAmount is required" }, 400);
      }
      const periods = body.assumptions ?? [{ amount: body.assumptionAmount ?? 0, startMonth: null, endMonth: null }];
      const card = await prisma.creditCard.create({
        data: { ...buildCreditCardData(body, periods[0]?.amount ?? 0), assumptions: { create: assumptionRecords(periods) } },
        include: { assumptions: { orderBy: { sortOrder: "asc" } } },
      });
      return c.json(card, 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .put("/:id", async (c) => {
    try {
      const body = updatePayloadSchema.parse(await c.req.json());
      const existing = await prisma.creditCard.findFirst({
        where: { id: c.req.param("id"), deletedAt: null },
        include: { assumptions: { orderBy: { sortOrder: "asc" } } },
      });
      if (!existing) {
        return notFound(c, "Credit card not found");
      }
      if (body.assumptions === undefined && body.assumptionAmount !== undefined
        && existing.assumptions.length > 1 && body.assumptionAmount !== existing.assumptionAmount) {
        return badRequest(c, "複数の仮定額を変更するには assumptions を指定してください");
      }
      const periods = body.assumptions ?? (body.assumptionAmount !== undefined && existing.assumptions.length <= 1
        ? [{ amount: body.assumptionAmount, startMonth: existing.assumptions[0]?.startMonth ?? null, endMonth: existing.assumptions[0]?.endMonth ?? null }]
        : undefined);

      const card = await prisma.creditCard.update({
        where: { id: existing.id },
        data: {
          ...buildCreditCardData(body, periods ? (periods[0]?.amount ?? 0) : existing.assumptionAmount),
          ...(periods ? { assumptions: { deleteMany: {}, create: assumptionRecords(periods) } } : {}),
        },
        include: { assumptions: { orderBy: { sortOrder: "asc" } } },
      });
      return c.json(card);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id", async (c) => {
    const existing = await prisma.creditCard.findFirst({
      where: { id: c.req.param("id"), deletedAt: null },
    });
    if (!existing) {
      return notFound(c, "Credit card not found");
    }

    await prisma.creditCard.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    return c.body(null, 204);
  });
