import { Hono } from "hono";
import { Prisma } from "@sui/db";
import { z } from "zod";
import { prisma } from "../lib/db";
import { normalizeCurrencyCode } from "../lib/currency";
import { BadRequestError, ConflictError, handleRouteError, notFound } from "../lib/http";
import { positiveInt32Schema } from "../lib/validation";
import { buildDashboard } from "../services/forecast";

const payloadSchema = z.object({
  forecastEventId: z.string().min(1),
  amount: positiveInt32Schema(),
  accountId: z.string().uuid().optional(),
});

const eventsQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(3),
  applyOffset: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
});

const dashboardQuerySchema = z.object({
  applyOffset: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
});

function isPrismaUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export const dashboardRoutes = new Hono()
  .get("/", async (c) => {
    const { applyOffset } = dashboardQuerySchema.parse(c.req.query());
    const dashboard = await buildDashboard(prisma, { applyOffset });
    return c.json(dashboard);
  })
  .get("/events", async (c) => {
    const { months, applyOffset } = eventsQuerySchema.parse(c.req.query());
    const dashboard = await buildDashboard(prisma, { forecastMonths: months, applyOffset });

    return c.json({
      forecast: dashboard.forecast,
      accountForecasts: dashboard.accountForecasts.map(({ accountId, accountName, events }) => ({
        accountId,
        accountName,
        events,
      })),
    });
  })
  .post("/confirm", async (c) => {
    try {
      const body = payloadSchema.parse(await c.req.json());
      const dashboard = await buildDashboard(prisma);
      const event =
        dashboard.forecast.find((item) => item.id === body.forecastEventId) ??
        dashboard.overdueForecast.find((item) => item.id === body.forecastEventId);

      if (!event) {
        const existingTransaction = await prisma.transaction.findUnique({
          where: { forecastEventId: body.forecastEventId },
        });
        if (existingTransaction) {
          return c.json({ error: "Forecast event already confirmed" }, 409);
        }
        return notFound(c, "Forecast event not found");
      }
      const resolvedAccountId = body.accountId ?? event.accountId ?? undefined;
      if (!resolvedAccountId) {
        return c.json({ error: "Account is required for this forecast event" }, 400);
      }

      const transaction = await prisma.$transaction(async (tx) => {
        const account = await tx.account.findFirst({
          where: { id: resolvedAccountId, deletedAt: null },
        });

        if (!account) {
          throw new BadRequestError("Account not found");
        }
        if (normalizeCurrencyCode(account.currencyCode) !== event.currencyCode) {
          throw new BadRequestError("Forecast event currency does not match the selected account");
        }

        await tx.account.update({
          where: { id: account.id },
          data: {
            balance:
              event.type === "income"
                ? { increment: body.amount }
                : { decrement: body.amount },
          },
        });

        return tx.transaction.create({
          data: {
            accountId: account.id,
            forecastEventId: event.id,
            date: new Date(`${event.date}T00:00:00.000Z`),
            type: event.type,
            description: event.description,
            amount: body.amount,
          },
        });
      });

      return c.json(transaction, 201);
    } catch (error) {
      if (isPrismaUniqueConstraintError(error)) {
        return handleRouteError(c, new ConflictError("Forecast event already confirmed"));
      }

      return handleRouteError(c, error);
    }
  });
