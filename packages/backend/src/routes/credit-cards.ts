import { Hono } from "hono";
import { z } from "zod";
import { isValidYearMonth } from "@sui/shared";
import { prisma } from "../lib/db";
import { getCurrentYearMonth, getJstToday } from "../lib/dates";
import { badRequest, handleRouteError, notFound } from "../lib/http";
import { int32Schema, nonNegativeInt32Schema } from "../lib/validation";
import { buildCreditCardAssumptionSuggestion } from "../services/credit-card-assumptions";

const dateShiftPolicySchema = z.enum(["none", "previous", "next"]);
const assumptionMonthSchema = z.string().refine(isValidYearMonth, "YYYY-MM の実在する年月を指定してください").nullable();

const basePayloadSchema = z.object({
  name: z.string().min(1).max(100),
  settlementDay: z.number().int().min(1).max(31).nullable().optional(),
  accountId: z.string().uuid(),
  assumptionAmount: nonNegativeInt32Schema(),
  assumptionStartMonth: assumptionMonthSchema.optional(),
  assumptionEndMonth: assumptionMonthSchema.optional(),
  sortOrder: int32Schema(),
}).refine((body) => !body.assumptionStartMonth || !body.assumptionEndMonth || body.assumptionStartMonth <= body.assumptionEndMonth, {
  message: "適用開始月は終了月以前にしてください",
  path: ["assumptionEndMonth"],
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

function buildCreditCardData(
  body: z.infer<typeof createPayloadSchema> | z.infer<typeof updatePayloadSchema>,
) {
  return {
    name: body.name,
    settlementDay: body.settlementDay,
    accountId: body.accountId,
    assumptionAmount: body.assumptionAmount,
    ...(body.assumptionStartMonth !== undefined ? { assumptionStartMonth: body.assumptionStartMonth } : {}),
    ...(body.assumptionEndMonth !== undefined ? { assumptionEndMonth: body.assumptionEndMonth } : {}),
    sortOrder: body.sortOrder,
    ...(body.dateShiftPolicy !== undefined ? { dateShiftPolicy: body.dateShiftPolicy } : {}),
  };
}

export const creditCardsRoutes = new Hono()
  .get("/", async (c) => {
    const cards = await prisma.creditCard.findMany({
      where: { deletedAt: null },
      include: { account: true },
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
      const card = await prisma.creditCard.create({ data: buildCreditCardData(body) });
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
      });
      if (!existing) {
        return notFound(c, "Credit card not found");
      }
      const startMonth = body.assumptionStartMonth === undefined ? existing.assumptionStartMonth : body.assumptionStartMonth;
      const endMonth = body.assumptionEndMonth === undefined ? existing.assumptionEndMonth : body.assumptionEndMonth;
      if (startMonth && endMonth && startMonth > endMonth) {
        return badRequest(c, "assumptionStartMonth must not exceed assumptionEndMonth");
      }

      const card = await prisma.creditCard.update({
        where: { id: existing.id },
        data: buildCreditCardData(body),
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
