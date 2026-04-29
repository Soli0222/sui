import { Hono } from "hono";
import { z } from "zod";
import { fromDateOnlyString, isDateString, toDateOnlyString } from "../lib/dates";
import { prisma } from "../lib/db";
import { badRequest, handleRouteError, notFound } from "../lib/http";
import { int32Schema, nonNegativeInt32Schema } from "../lib/validation";

const dateShiftPolicySchema = z.enum(["none", "previous", "next"]);

const basePayloadSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["income", "expense"]),
  amount: nonNegativeInt32Schema(),
  dayOfMonth: z.number().int().min(1).max(31),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  accountId: z.string().uuid(),
  enabled: z.boolean(),
  sortOrder: int32Schema(),
});

const createPayloadSchema = basePayloadSchema.extend({
  dateShiftPolicy: dateShiftPolicySchema.optional().default("none"),
});

const updatePayloadSchema = basePayloadSchema.extend({
  dateShiftPolicy: dateShiftPolicySchema.optional(),
});

function isOptionalDateString(value: string | null) {
  return value === null || isDateString(value);
}

function validatePeriod(startDate: string | null, endDate: string | null) {
  if (!isOptionalDateString(startDate)) {
    return "startDate must be YYYY-MM-DD or null";
  }

  if (!isOptionalDateString(endDate)) {
    return "endDate must be YYYY-MM-DD or null";
  }

  if (startDate && endDate && startDate > endDate) {
    return "startDate must be less than or equal to endDate";
  }

  return null;
}

function serializeRecurringItem<T extends { startDate: Date | null; endDate: Date | null }>(item: T) {
  return {
    ...item,
    startDate: toDateOnlyString(item.startDate),
    endDate: toDateOnlyString(item.endDate),
  };
}

function buildRecurringItemData(
  body: z.infer<typeof createPayloadSchema> | z.infer<typeof updatePayloadSchema>,
) {
  return {
    name: body.name,
    type: body.type,
    amount: body.amount,
    dayOfMonth: body.dayOfMonth,
    startDate: body.startDate ? fromDateOnlyString(body.startDate) : null,
    endDate: body.endDate ? fromDateOnlyString(body.endDate) : null,
    accountId: body.accountId,
    enabled: body.enabled,
    sortOrder: body.sortOrder,
    ...(body.dateShiftPolicy !== undefined ? { dateShiftPolicy: body.dateShiftPolicy } : {}),
  };
}

export const recurringItemsRoutes = new Hono()
  .get("/", async (c) => {
    const items = await prisma.recurringItem.findMany({
      where: { deletedAt: null },
      include: { account: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return c.json(items.map(serializeRecurringItem));
  })
  .post("/", async (c) => {
    try {
      const body = createPayloadSchema.parse(await c.req.json());
      const periodError = validatePeriod(body.startDate, body.endDate);
      if (periodError) {
        return badRequest(c, periodError);
      }

      const item = await prisma.recurringItem.create({ data: buildRecurringItemData(body) });
      return c.json(serializeRecurringItem(item), 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .put("/:id", async (c) => {
    try {
      const body = updatePayloadSchema.parse(await c.req.json());
      const periodError = validatePeriod(body.startDate, body.endDate);
      if (periodError) {
        return badRequest(c, periodError);
      }

      const existing = await prisma.recurringItem.findFirst({
        where: { id: c.req.param("id"), deletedAt: null },
      });
      if (!existing) {
        return notFound(c, "Recurring item not found");
      }

      const item = await prisma.recurringItem.update({
        where: { id: existing.id },
        data: buildRecurringItemData(body),
      });
      return c.json(serializeRecurringItem(item));
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id", async (c) => {
    const existing = await prisma.recurringItem.findFirst({
      where: { id: c.req.param("id"), deletedAt: null },
    });
    if (!existing) {
      return notFound(c, "Recurring item not found");
    }

    await prisma.recurringItem.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    return c.body(null, 204);
  });
