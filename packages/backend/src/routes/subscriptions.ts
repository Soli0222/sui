import { Hono } from "hono";
import { z } from "zod";
import { fromDateOnlyString, isDateString, toDateOnlyString } from "../lib/dates";
import { prisma } from "../lib/db";
import { badRequest, handleRouteError, notFound } from "../lib/http";
import { positiveInt32Schema } from "../lib/validation";

const payloadSchema = z.object({
  name: z.string().min(1).max(100),
  amount: positiveInt32Schema(),
  intervalMonths: positiveInt32Schema(),
  startDate: z.string(),
  dayOfMonth: z.number().int().min(1).max(31),
  endDate: z.string().nullable().optional(),
  paymentSource: z.string().max(100).nullable().optional(),
});

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

function serializeSubscription<T extends { startDate: Date; endDate: Date | null }>(subscription: T) {
  return {
    ...subscription,
    startDate: toDateOnlyString(subscription.startDate),
    endDate: toDateOnlyString(subscription.endDate),
  };
}

function buildSubscriptionData(body: z.infer<typeof payloadSchema>) {
  return {
    ...body,
    startDate: fromDateOnlyString(body.startDate),
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

      const subscription = await prisma.subscription.create({
        data: buildSubscriptionData(body),
      });
      return c.json(serializeSubscription(subscription), 201);
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

      const subscription = await prisma.subscription.update({
        where: { id: existing.id },
        data: buildSubscriptionData(body),
      });
      return c.json(serializeSubscription(subscription));
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
