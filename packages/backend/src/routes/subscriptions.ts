import { DEFAULT_CURRENCY_CODE, DEFAULT_EXCHANGE_RATE_TO_JPY } from "@sui/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { Subscription } from "@sui/db";
import { currencyCodeSchema, formatCurrencyFields, normalizeExchangeRateToJpy } from "../lib/currency";
import { fromDateOnlyString, isDateString, toDateOnlyString } from "../lib/dates";
import { prisma } from "../lib/db";
import { badRequest, handleRouteError, notFound } from "../lib/http";
import { positiveInt32Schema } from "../lib/validation";

const payloadSchema = z.object({
  name: z.string().min(1).max(100),
  amount: positiveInt32Schema(),
  currencyCode: z
    .preprocess((value) => (typeof value === "string" ? value.toUpperCase() : value), currencyCodeSchema)
    .default(DEFAULT_CURRENCY_CODE),
  exchangeRateToJpy: z.coerce.number().finite().positive().default(DEFAULT_EXCHANGE_RATE_TO_JPY),
  recurrence: z.enum(["monthly", "weekly"]).optional(),
  interval: z.number().int().min(1).optional(),
  startDate: z.string(),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  endDate: z.string().nullable().optional(),
  paymentSource: z.string().max(100).nullable().optional(),
}).strict().transform((value) => ({
  ...value,
  exchangeRateToJpy: normalizeExchangeRateToJpy(value.currencyCode, value.exchangeRateToJpy),
}));

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

function serializeSubscription<T extends { startDate: Date; endDate: Date | null; currencyCode: string; exchangeRateToJpy: number }>(subscription: T) {
  const normalized = formatCurrencyFields(subscription);
  return {
    ...normalized,
    startDate: toDateOnlyString(normalized.startDate),
    endDate: toDateOnlyString(normalized.endDate),
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
      orderBy: [{ createdAt: "asc" }],
    });
    return c.json(subscriptions.map(serializeSubscription));
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

      const baseData = buildSubscriptionData(body, existing);
      const subscription = await prisma.subscription.update({
        where: { id: existing.id },
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
  });
