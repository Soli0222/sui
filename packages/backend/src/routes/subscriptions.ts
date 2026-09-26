import { amountChangeSchema, payloadSchema } from "../schemas/subscriptions";
import { getMonthlySummary, isValidYearMonth, resolveDatedAmount } from "@sui/shared";
import { Hono } from "hono";
import { z } from "zod";
import { Prisma, type Subscription } from "@sui/db";
import { formatCurrencyFields } from "../lib/currency";
import { fromDateOnlyString, getJstToday, isDateString, toDateOnlyString } from "../lib/dates";
import { prisma } from "../lib/db";
import { badRequest, handleRouteError, notFound } from "../lib/http";

type SubscriptionPayload = z.infer<typeof payloadSchema>;

type SubscriptionRecord = Pick<Subscription, "recurrence" | "interval" | "dayOfMonth" | "dayOfWeek" | "currencyCode" | "exchangeRateToJpy">;

function resolveSubscriptionFields(body: SubscriptionPayload, existing?: SubscriptionRecord) {
  const inferredRecurrence =
    body.dayOfWeek != null
      ? "weekly"
      : body.dayOfMonth != null || body.interval != null
        ? "monthly"
        : undefined;
  const recurrence = body.recurrence ?? inferredRecurrence ?? existing?.recurrence ?? "monthly";

  if (recurrence === "weekly") {
    return {
      recurrence,
      interval: body.interval ?? existing?.interval ?? 1,
      dayOfMonth: null,
      dayOfWeek: body.dayOfWeek ?? existing?.dayOfWeek ?? null,
    };
  }

  return {
    recurrence,
    interval: body.interval ?? existing?.interval ?? 1,
    dayOfMonth: body.dayOfMonth ?? existing?.dayOfMonth ?? null,
    dayOfWeek: null,
  };
}

function validateSubscriptionFields(body: SubscriptionPayload, existing?: SubscriptionRecord): string | null {
  const { recurrence, dayOfMonth, dayOfWeek } = resolveSubscriptionFields(body, existing);

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

function validatePeriod(startDate: string, endDate: string | null | undefined) {
  if (!isDateString(startDate)) {
    return "startDate must be YYYY-MM-DD";
  }

  if (endDate !== undefined && endDate !== null && !isDateString(endDate)) {
    return "endDate must be YYYY-MM-DD or null";
  }

  if (endDate && startDate > endDate) {
    return "startDate must be less than or equal to endDate";
  }

  return null;
}

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined || value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

type AmountChangeRecord = { id: string; subscriptionId: string; effectiveFrom: Date; amount: number; createdAt: Date; updatedAt: Date };

function serializeAmountChange(change: AmountChangeRecord) {
  return { ...change, effectiveFrom: toDateOnlyString(change.effectiveFrom)!, createdAt: change.createdAt.toISOString(), updatedAt: change.updatedAt.toISOString() };
}

function amountChangeError(c: Parameters<typeof badRequest>[0], error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return c.json({ error: "An amount change already exists for this date" }, 409);
  }
  return handleRouteError(c, error);
}

function serializeSubscription<T extends { startDate: Date; endDate: Date | null; amount: number; amountChanges: AmountChangeRecord[]; currencyCode: string; exchangeRateToJpy: number; exchangeRateUpdatedAt: Date; deletedAt: Date | null; createdAt: Date; updatedAt: Date }>(subscription: T) {
  const normalized = formatCurrencyFields(subscription);
  const amountChanges = normalized.amountChanges.map(serializeAmountChange);
  return {
    ...normalized,
    amountChanges,
    effectiveAmount: resolveDatedAmount(normalized.amount, amountChanges, getJstToday()),
    startDate: toDateOnlyString(normalized.startDate)!,
    endDate: toDateOnlyString(normalized.endDate),
    exchangeRateUpdatedAt: normalized.exchangeRateUpdatedAt.toISOString(),
    deletedAt: normalized.deletedAt?.toISOString() ?? null,
    createdAt: normalized.createdAt.toISOString(),
    updatedAt: normalized.updatedAt.toISOString(),
  };
}

function buildSubscriptionData(body: SubscriptionPayload, existing?: SubscriptionRecord) {
  const { recurrence, interval, dayOfMonth, dayOfWeek } = resolveSubscriptionFields(body, existing);
  return {
    name: body.name,
    amount: body.amount,
    currencyCode: body.currencyCode,
    exchangeRateToJpy: body.exchangeRateToJpy,
    recurrence,
    interval,
    startDate: fromDateOnlyString(body.startDate),
    dayOfMonth,
    dayOfWeek,
    endDate: body.endDate ? fromDateOnlyString(body.endDate) : null,
    paymentSource: normalizeOptionalText(body.paymentSource),
  };
}

export const subscriptionsRoutes = new Hono()
  .get("/", async (c) => {
    const subscriptions = await prisma.subscription.findMany({
      where: { deletedAt: null },
      include: { amountChanges: { orderBy: { effectiveFrom: "asc" } } },
      orderBy: [{ createdAt: "asc" }],
    });
    return c.json(subscriptions.map(serializeSubscription));
  })
  .get("/monthly/:yearMonth", async (c) => {
    const yearMonth = c.req.param("yearMonth");
    if (!isValidYearMonth(yearMonth)) return badRequest(c, "yearMonth must be YYYY-MM");
    const subscriptions = await prisma.subscription.findMany({
      where: { deletedAt: null },
      include: { amountChanges: { orderBy: { effectiveFrom: "asc" } } },
      orderBy: [{ createdAt: "asc" }],
    });
    return c.json(getMonthlySummary(subscriptions.map(serializeSubscription), yearMonth));
  })
  .get("/:id", async (c) => {
    const subscription = await prisma.subscription.findFirst({
      where: { id: c.req.param("id"), deletedAt: null },
      include: { amountChanges: { orderBy: { effectiveFrom: "asc" } } },
    });
    if (!subscription) return notFound(c, "Subscription not found");
    return c.json(serializeSubscription(subscription));
  })
  .post("/", async (c) => {
    try {
      const body = payloadSchema.parse(await c.req.json());
      const periodError = validatePeriod(body.startDate, body.endDate);
      if (periodError) {
        return badRequest(c, periodError);
      }
      const fieldError = validateSubscriptionFields(body);
      if (fieldError) {
        return badRequest(c, fieldError);
      }

      const subscription = await prisma.subscription.create({
        data: buildSubscriptionData(body),
        include: { amountChanges: true },
      });
      return c.json(serializeSubscription(subscription as typeof subscription), 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .put("/:id", async (c) => {
    try {
      const body = payloadSchema.parse(await c.req.json());
      const periodError = validatePeriod(body.startDate, body.endDate);
      if (periodError) {
        return badRequest(c, periodError);
      }

      const existing = await prisma.subscription.findFirst({
        where: { id: c.req.param("id"), deletedAt: null },
      });
      if (!existing) {
        return notFound(c, "Subscription not found");
      }

      const fieldError = validateSubscriptionFields(body, existing);
      if (fieldError) {
        return badRequest(c, fieldError);
      }

      const earlierChange = await prisma.subscriptionAmountChange.findFirst({
        where: { subscriptionId: existing.id, effectiveFrom: { lte: fromDateOnlyString(body.startDate) } },
        select: { id: true },
      });
      if (earlierChange) {
        return badRequest(c, "startDate must be before every amount change date");
      }

      const baseData = buildSubscriptionData(body, existing);
      const subscription = await prisma.subscription.update({
        where: { id: existing.id },
        include: { amountChanges: { orderBy: { effectiveFrom: "asc" } } },
        data: {
          ...baseData,
          exchangeRateUpdatedAt:
            baseData.currencyCode !== existing.currencyCode ||
            baseData.exchangeRateToJpy !== existing.exchangeRateToJpy
              ? new Date()
              : undefined,
        },
      });
      return c.json(serializeSubscription(subscription as typeof subscription));
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id", async (c) => {
    const existing = await prisma.subscription.findFirst({
      where: { id: c.req.param("id"), deletedAt: null },
    });
    if (!existing) {
      return notFound(c, "Subscription not found");
    }

    await prisma.subscription.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    return c.body(null, 204);
  })
  .get("/:id/amount-changes", async (c) => {
    const parent = await prisma.subscription.findFirst({ where: { id: c.req.param("id"), deletedAt: null } });
    if (!parent) return notFound(c, "Subscription not found");
    const changes = await prisma.subscriptionAmountChange.findMany({
      where: { subscriptionId: parent.id }, orderBy: { effectiveFrom: "asc" },
    });
    return c.json(changes.map(serializeAmountChange));
  })
  .post("/:id/amount-changes", async (c) => {
    try {
      const body = amountChangeSchema.parse(await c.req.json());
      const parent = await prisma.subscription.findFirst({ where: { id: c.req.param("id"), deletedAt: null } });
      if (!parent) return notFound(c, "Subscription not found");
      if (body.effectiveFrom <= toDateOnlyString(parent.startDate)!) {
        return badRequest(c, "effectiveFrom must be after subscription startDate");
      }
      const change = await prisma.subscriptionAmountChange.create({
        data: { subscriptionId: parent.id, effectiveFrom: fromDateOnlyString(body.effectiveFrom), amount: body.amount },
      });
      return c.json(serializeAmountChange(change), 201);
    } catch (error) { return amountChangeError(c, error); }
  })
  .put("/:id/amount-changes/:changeId", async (c) => {
    try {
      const body = amountChangeSchema.parse(await c.req.json());
      const parent = await prisma.subscription.findFirst({ where: { id: c.req.param("id"), deletedAt: null } });
      if (!parent) return notFound(c, "Subscription not found");
      const existing = await prisma.subscriptionAmountChange.findFirst({ where: { id: c.req.param("changeId"), subscriptionId: parent.id } });
      if (!existing) return notFound(c, "Amount change not found");
      if (body.effectiveFrom <= toDateOnlyString(parent.startDate)!) {
        return badRequest(c, "effectiveFrom must be after subscription startDate");
      }
      const change = await prisma.subscriptionAmountChange.update({
        where: { id: existing.id }, data: { effectiveFrom: fromDateOnlyString(body.effectiveFrom), amount: body.amount },
      });
      return c.json(serializeAmountChange(change));
    } catch (error) { return amountChangeError(c, error); }
  })
  .delete("/:id/amount-changes/:changeId", async (c) => {
    const parent = await prisma.subscription.findFirst({ where: { id: c.req.param("id"), deletedAt: null } });
    if (!parent) return notFound(c, "Subscription not found");
    const result = await prisma.subscriptionAmountChange.deleteMany({ where: { id: c.req.param("changeId"), subscriptionId: parent.id } });
    if (result.count === 0) return notFound(c, "Amount change not found");
    return c.body(null, 204);
  });
