import { Hono } from "hono";
import { z } from "zod";
import type { RecurringItem } from "@sui/db";
import { normalizeCurrencyCode } from "../lib/currency";
import { fromDateOnlyString, isDateString, toDateOnlyString } from "../lib/dates";
import { prisma } from "../lib/db";
import { BadRequestError, badRequest, handleRouteError, notFound } from "../lib/http";
import { int32Schema, nonNegativeInt32Schema } from "../lib/validation";

const dateShiftPolicySchema = z.enum(["none", "previous", "next"]);

const basePayloadSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["income", "expense", "transfer"]),
  amount: nonNegativeInt32Schema(),
  recurrence: z.enum(["monthly", "weekly"]).optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  accountId: z.string().uuid(),
  transferToAccountId: z.string().uuid().nullish(),
  enabled: z.boolean(),
  sortOrder: int32Schema(),
});

const createPayloadSchema = basePayloadSchema.extend({
  dateShiftPolicy: dateShiftPolicySchema.optional().default("none"),
});

const updatePayloadSchema = basePayloadSchema.extend({
  dateShiftPolicy: dateShiftPolicySchema.optional(),
});

type RecurringPayload = z.infer<typeof createPayloadSchema> | z.infer<typeof updatePayloadSchema>;

type RecurringItemRecord = Pick<RecurringItem, "recurrence" | "dayOfMonth" | "dayOfWeek">;

function resolveRecurringFields(body: RecurringPayload, existing?: RecurringItemRecord) {
  const inferredRecurrence =
    body.dayOfWeek != null ? "weekly" : body.dayOfMonth != null ? "monthly" : undefined;
  const recurrence = body.recurrence ?? inferredRecurrence ?? existing?.recurrence ?? "monthly";

  if (recurrence === "weekly") {
    return {
      recurrence,
      dayOfMonth: null,
      dayOfWeek: body.dayOfWeek ?? existing?.dayOfWeek ?? null,
    };
  }

  return {
    recurrence,
    dayOfMonth: body.dayOfMonth ?? existing?.dayOfMonth ?? null,
    dayOfWeek: null,
  };
}

function validateRecurringFields(body: RecurringPayload, existing?: RecurringItemRecord): string | null {
  const { recurrence, dayOfMonth, dayOfWeek } = resolveRecurringFields(body, existing);

  if (body.dayOfMonth != null && body.dayOfWeek != null) {
    return "dayOfMonth and dayOfWeek are mutually exclusive";
  }

  if (recurrence === "monthly") {
    if (dayOfMonth == null) {
      return "dayOfMonth is required for monthly recurrence";
    }
    if (body.dayOfWeek != null) {
      return "dayOfWeek must be null for monthly recurrence";
    }
    return null;
  }

  if (dayOfWeek == null) {
    return "dayOfWeek is required for weekly recurrence";
  }
  if (body.dayOfMonth != null) {
    return "dayOfMonth must be null for weekly recurrence";
  }
  return null;
}

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
  body: RecurringPayload,
  existing?: RecurringItemRecord,
) {
  const { recurrence, dayOfMonth, dayOfWeek } = resolveRecurringFields(body, existing);
  return {
    name: body.name,
    type: body.type,
    amount: body.amount,
    recurrence,
    dayOfMonth,
    dayOfWeek,
    startDate: body.startDate ? fromDateOnlyString(body.startDate) : null,
    endDate: body.endDate ? fromDateOnlyString(body.endDate) : null,
    accountId: body.accountId,
    transferToAccountId: body.type === "transfer" ? body.transferToAccountId : null,
    enabled: body.enabled,
    sortOrder: body.sortOrder,
    ...(body.dateShiftPolicy !== undefined ? { dateShiftPolicy: body.dateShiftPolicy } : {}),
  };
}

async function validateRecurringPayload(body: RecurringPayload, existing?: RecurringItemRecord) {
  const fieldError = validateRecurringFields(body, existing);
  if (fieldError) {
    return fieldError;
  }

  if (body.type !== "transfer") {
    if (body.transferToAccountId) {
      return "transferToAccountId is only allowed for transfer";
    }
    return null;
  }

  if (!body.transferToAccountId) {
    return "transferToAccountId is required for transfer";
  }

  if (body.accountId === body.transferToAccountId) {
    return "transfer accounts must be different";
  }

  const [sourceAccount, destinationAccount] = await Promise.all([
    prisma.account.findFirst({ where: { id: body.accountId, deletedAt: null } }),
    prisma.account.findFirst({ where: { id: body.transferToAccountId, deletedAt: null } }),
  ]);
  if (!sourceAccount) {
    return "Source account not found";
  }
  if (!destinationAccount) {
    return "Destination account not found";
  }
  if (
    normalizeCurrencyCode(sourceAccount.currencyCode) !==
    normalizeCurrencyCode(destinationAccount.currencyCode)
  ) {
    throw new BadRequestError("Cross-currency transfers are not supported");
  }

  return null;
}

export const recurringItemsRoutes = new Hono()
  .get("/", async (c) => {
    const items = await prisma.recurringItem.findMany({
      where: { deletedAt: null },
      include: { account: true, transferToAccount: true },
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
      const validationError = await validateRecurringPayload(body);
      if (validationError) {
        return badRequest(c, validationError);
      }

      const item = await prisma.recurringItem.create({
        data: buildRecurringItemData(body),
        include: { account: true, transferToAccount: true },
      });
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

      const validationError = await validateRecurringPayload(body, existing);
      if (validationError) {
        return badRequest(c, validationError);
      }

      const item = await prisma.recurringItem.update({
        where: { id: existing.id },
        data: buildRecurringItemData(body, existing),
        include: { account: true, transferToAccount: true },
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
