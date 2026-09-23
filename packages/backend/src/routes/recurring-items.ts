import { guardSpendingFunding, lockSpendingLedger } from "../services/spending-funding";
import { Hono } from "hono";
import { z } from "zod";
import { Prisma, type RecurringItem } from "@sui/db";
import { isOneTimeSchedule, resolveDatedAmount } from "@sui/shared";
import { normalizeCurrencyCode } from "../lib/currency";
import { fromDateOnlyString, getJstToday, isDateString, toDateOnlyString } from "../lib/dates";
import { prisma } from "../lib/db";
import { BadRequestError, badRequest, handleRouteError, notFound } from "../lib/http";
import { int32Schema, nonNegativeInt32Schema } from "../lib/validation";

const dateShiftPolicySchema = z.enum(["none", "previous", "next"]);

const basePayloadSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["income", "expense", "transfer"]),
  amount: nonNegativeInt32Schema(),
  recurrence: z.enum(["monthly", "weekly"]).optional(),
  interval: z.number().int().min(1).optional(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  accountId: z.string().uuid().nullish(),
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

type RecurringItemRecord = Pick<RecurringItem, "recurrence" | "interval" | "dayOfMonth" | "dayOfWeek">;

function resolveRecurringFields(body: RecurringPayload, existing?: RecurringItemRecord) {
  const inferredRecurrence =
    body.dayOfWeek != null ? "weekly" : body.dayOfMonth != null ? "monthly" : undefined;
  const recurrence = body.recurrence ?? inferredRecurrence ?? existing?.recurrence ?? "monthly";
  const interval = body.interval ?? existing?.interval ?? 1;

  if (recurrence === "weekly") {
    return {
      recurrence,
      interval,
      dayOfMonth: null,
      dayOfWeek: body.dayOfWeek ?? existing?.dayOfWeek ?? null,
    };
  }

  return {
    recurrence,
    interval,
    dayOfMonth: body.dayOfMonth ?? existing?.dayOfMonth ?? null,
    dayOfWeek: null,
  };
}

function validateRecurringFields(body: RecurringPayload, existing?: RecurringItemRecord): string | null {
  const { recurrence, interval, dayOfMonth, dayOfWeek } = resolveRecurringFields(body, existing);

  if (body.dayOfMonth != null && body.dayOfWeek != null) {
    return "dayOfMonth and dayOfWeek are mutually exclusive";
  }

  if (interval > 1 && body.startDate === null) {
    return "startDate is required when interval is greater than 1";
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

type AmountChangeRecord = { id: string; recurringItemId: string; effectiveFrom: Date; amount: number; createdAt: Date; updatedAt: Date };

const amountChangeSchema = z.object({
  effectiveFrom: z.string().refine(isDateString, "effectiveFrom must be YYYY-MM-DD"),
  amount: nonNegativeInt32Schema(),
}).strict();

function serializeAmountChange(change: AmountChangeRecord) {
  return { ...change, effectiveFrom: toDateOnlyString(change.effectiveFrom)! };
}

function isOneTimeItem(item: RecurringItem) {
  return isOneTimeSchedule({ ...item, startDate: toDateOnlyString(item.startDate), endDate: toDateOnlyString(item.endDate) });
}

function amountChangeError(c: Parameters<typeof badRequest>[0], error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return c.json({ error: "An amount change already exists for this date" }, 409);
  }
  return handleRouteError(c, error);
}

function serializeRecurringItem<T extends { startDate: Date | null; endDate: Date | null; amount: number; amountChanges: AmountChangeRecord[] }>(item: T) {
  const amountChanges = item.amountChanges.map(serializeAmountChange);
  return {
    ...item,
    amountChanges,
    effectiveAmount: resolveDatedAmount(item.amount, amountChanges, getJstToday()),
    startDate: toDateOnlyString(item.startDate),
    endDate: toDateOnlyString(item.endDate),
  };
}

function buildRecurringItemData(
  body: RecurringPayload,
  existing?: RecurringItemRecord,
) {
  const { recurrence, interval, dayOfMonth, dayOfWeek } = resolveRecurringFields(body, existing);
  return {
    name: body.name,
    type: body.type,
    amount: body.amount,
    recurrence,
    interval,
    dayOfMonth,
    dayOfWeek,
    startDate: body.startDate ? fromDateOnlyString(body.startDate) : null,
    endDate: body.endDate ? fromDateOnlyString(body.endDate) : null,
    accountId: body.accountId ?? null,
    transferToAccountId: body.type === "transfer" ? (body.transferToAccountId ?? null) : null,
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
    if (!body.accountId) {
      return "accountId is required";
    }
    const account = await prisma.account.findFirst({ where: { id: body.accountId, deletedAt: null } });
    if (!account) {
      return "Account not found";
    }
    return null;
  }

  if (!body.accountId && !body.transferToAccountId) {
    return "accountId or transferToAccountId is required for transfer";
  }

  if (body.accountId && body.accountId === body.transferToAccountId) {
    return "transfer accounts must be different";
  }

  if (body.accountId && body.transferToAccountId) {
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

  if (body.accountId) {
    const sourceAccount = await prisma.account.findFirst({
      where: { id: body.accountId, deletedAt: null },
    });
    if (!sourceAccount) {
      return "Source account not found";
    }
    return null;
  }

  if (body.transferToAccountId) {
    const destinationAccount = await prisma.account.findFirst({
      where: { id: body.transferToAccountId, deletedAt: null },
    });
    if (!destinationAccount) {
      return "Destination account not found";
    }
  }

  return null;
}

export const recurringItemsRoutes = new Hono()
  .get("/", async (c) => {
    const items = await prisma.recurringItem.findMany({
      where: { deletedAt: null },
      include: { account: true, transferToAccount: true, amountChanges: { orderBy: { effectiveFrom: "asc" } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return c.json(items.map(serializeRecurringItem));
  })
  .get("/:id", async (c) => {
    const item = await prisma.recurringItem.findFirst({
      where: { id: c.req.param("id"), deletedAt: null },
      include: { account: true, transferToAccount: true, amountChanges: { orderBy: { effectiveFrom: "asc" } } },
    });
    if (!item) return notFound(c, "Recurring item not found");
    return c.json(serializeRecurringItem(item));
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
        include: { account: true, transferToAccount: true, amountChanges: true },
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

      const item = await prisma.$transaction(async (tx) => {
        await lockSpendingLedger(tx);
        const existing = await tx.recurringItem.findFirst({
          where: { id: c.req.param("id"), deletedAt: null },
        });
        if (!existing) return null;
        if (body.startDate) {
          const earlierChange = await tx.recurringItemAmountChange.findFirst({
            where: { recurringItemId: existing.id, effectiveFrom: { lte: fromDateOnlyString(body.startDate) } },
          });
          if (earlierChange) throw new BadRequestError("startDate must be before every amount change date");
        }
        if (isOneTimeSchedule({ ...body, ...resolveRecurringFields(body, existing) }) &&
            await tx.recurringItemAmountChange.count({ where: { recurringItemId: existing.id } }) > 0) {
          throw new BadRequestError("One-time items cannot have amount changes");
        }
        const validationError = await validateRecurringPayload(body, existing);
        if (validationError) throw new BadRequestError(validationError);
        const data = buildRecurringItemData(body, existing);
        await guardSpendingFunding(tx, existing.id, data);
        return tx.recurringItem.update({
          where: { id: existing.id }, data,
          include: { account: true, transferToAccount: true, amountChanges: { orderBy: { effectiveFrom: "asc" } } },
        });
      });
      if (!item) return notFound(c, "Recurring item not found");
      return c.json(serializeRecurringItem(item));
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id", async (c) => {
    try {
      const deleted = await prisma.$transaction(async (tx) => {
        await lockSpendingLedger(tx);
        const existing = await tx.recurringItem.findFirst({
          where: { id: c.req.param("id"), deletedAt: null },
        });
        if (!existing) return { count: 0 };
        await guardSpendingFunding(tx, existing.id, { ...existing, enabled: false });
        return tx.recurringItem.updateMany({
          where: { id: existing.id, deletedAt: null },
          data: { deletedAt: new Date() },
        });
      });
      if (!deleted.count) return notFound(c, "Recurring item not found");
      return c.body(null, 204);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .get("/:id/amount-changes", async (c) => {
    const parent = await prisma.recurringItem.findFirst({ where: { id: c.req.param("id"), deletedAt: null } });
    if (!parent) return notFound(c, "Recurring item not found");
    const changes = await prisma.recurringItemAmountChange.findMany({ where: { recurringItemId: parent.id }, orderBy: { effectiveFrom: "asc" } });
    return c.json(changes.map(serializeAmountChange));
  })
  .post("/:id/amount-changes", async (c) => {
    try {
      const body = amountChangeSchema.parse(await c.req.json());
      const parent = await prisma.recurringItem.findFirst({ where: { id: c.req.param("id"), deletedAt: null } });
      if (!parent) return notFound(c, "Recurring item not found");
      if (isOneTimeItem(parent)) return badRequest(c, "One-time items cannot have amount changes");
      if (parent.startDate && body.effectiveFrom <= toDateOnlyString(parent.startDate)!) return badRequest(c, "effectiveFrom must be after startDate");
      const change = await prisma.recurringItemAmountChange.create({ data: { recurringItemId: parent.id, effectiveFrom: fromDateOnlyString(body.effectiveFrom), amount: body.amount } });
      return c.json(serializeAmountChange(change), 201);
    } catch (error) { return amountChangeError(c, error); }
  })
  .put("/:id/amount-changes/:changeId", async (c) => {
    try {
      const body = amountChangeSchema.parse(await c.req.json());
      const parent = await prisma.recurringItem.findFirst({ where: { id: c.req.param("id"), deletedAt: null } });
      if (!parent) return notFound(c, "Recurring item not found");
      const existing = await prisma.recurringItemAmountChange.findFirst({ where: { id: c.req.param("changeId"), recurringItemId: parent.id } });
      if (!existing) return notFound(c, "Amount change not found");
      if (isOneTimeItem(parent)) return badRequest(c, "One-time items cannot have amount changes");
      if (parent.startDate && body.effectiveFrom <= toDateOnlyString(parent.startDate)!) return badRequest(c, "effectiveFrom must be after startDate");
      const change = await prisma.recurringItemAmountChange.update({ where: { id: existing.id }, data: { effectiveFrom: fromDateOnlyString(body.effectiveFrom), amount: body.amount } });
      return c.json(serializeAmountChange(change));
    } catch (error) { return amountChangeError(c, error); }
  })
  .delete("/:id/amount-changes/:changeId", async (c) => {
    const parent = await prisma.recurringItem.findFirst({ where: { id: c.req.param("id"), deletedAt: null } });
    if (!parent) return notFound(c, "Recurring item not found");
    const result = await prisma.recurringItemAmountChange.deleteMany({ where: { id: c.req.param("changeId"), recurringItemId: parent.id } });
    if (!result.count) return notFound(c, "Amount change not found");
    return c.body(null, 204);
  });
