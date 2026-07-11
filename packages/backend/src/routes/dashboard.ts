import { Hono } from "hono";
import { Prisma } from "@sui/db";
import type {
  DashboardExplainResponse,
  DashboardExplainSourceTotals,
  DashboardSimulationResponse,
  ForecastEvent,
} from "@sui/shared";
import { DEFAULT_SETTINGS } from "@sui/shared";
import { z } from "zod";
import { prisma } from "../lib/db";
import { normalizeCurrencyCode } from "../lib/currency";
import { addMonthsToYearMonth, getCurrentYearMonth, getJstToday } from "../lib/dates";
import { BadRequestError, ConflictError, handleRouteError, notFound } from "../lib/http";
import { positiveInt32Schema } from "../lib/validation";
import { buildDashboard, loadDashboardCoreData, type DashboardCoreData } from "../services/forecast";
import { buildDashboardCore } from "../services/forecast-core";

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

const dateQuerySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD形式で指定してください");

const optionalUuidQuerySchema = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().uuid().optional(),
);

const explainQuerySchema = dashboardQuerySchema.extend({
  date: dateQuerySchema,
  accountId: optionalUuidQuerySchema,
});

const simulatePayloadSchema = z.object({
  months: z.number().int().min(1).max(24).default(Number(DEFAULT_SETTINGS.forecast_months)),
  applyOffset: z.boolean().default(true),
  exclude: z.object({
    recurringItemIds: z.array(z.string().uuid()).optional(),
    loanIds: z.array(z.string().uuid()).optional(),
    creditCardIds: z.array(z.string().uuid()).optional(),
  }).default({}),
  cardAssumptionOverrides: z.array(z.object({
    creditCardId: z.string().uuid(),
    assumptionAmount: positiveInt32Schema(),
  })).default([]),
});

function isPrismaUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function getLastDayOfYearMonth(yearMonth: string) {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function getForecastRangeEnd(today: string, months: number, events: ForecastEvent[]) {
  const horizonYearMonth = addMonthsToYearMonth(getCurrentYearMonth(today), months - 1);
  const horizonEnd = `${horizonYearMonth}-${String(getLastDayOfYearMonth(horizonYearMonth)).padStart(2, "0")}`;

  return events.reduce((latest, event) => event.date > latest ? event.date : latest, horizonEnd);
}

function getEventContributionJpy(event: ForecastEvent, accountId: string | null) {
  if (event.type === "income") {
    return event.amountJpy;
  }

  if (event.type === "expense") {
    return -event.amountJpy;
  }

  if (accountId) {
    if (event.accountId === accountId) {
      return -event.amountJpy;
    }

    if (event.transferToAccountId === accountId) {
      return event.amountJpy;
    }

    return 0;
  }

  const hasSource = event.accountId != null;
  const hasDestination = event.transferToAccountId != null;

  if (hasSource && hasDestination) {
    return 0;
  }

  if (hasSource) {
    return -event.amountJpy;
  }

  if (hasDestination) {
    return event.amountJpy;
  }

  return 0;
}

function createEmptySourceTotals(): DashboardExplainSourceTotals {
  return {
    recurringIncomeJpy: 0,
    recurringExpenseJpy: 0,
    creditCardJpy: 0,
    loanJpy: 0,
    transferJpy: 0,
  };
}

function addSourceTotal(
  totals: DashboardExplainSourceTotals,
  event: ForecastEvent,
  contributionJpy: number,
) {
  if (event.source === "recurring") {
    if (event.type === "income") {
      totals.recurringIncomeJpy += contributionJpy;
    } else {
      totals.recurringExpenseJpy += contributionJpy;
    }
    return;
  }

  if (event.source === "credit-card") {
    totals.creditCardJpy += contributionJpy;
    return;
  }

  if (event.source === "loan") {
    totals.loanJpy += contributionJpy;
    return;
  }

  totals.transferJpy += contributionJpy;
}

function buildExplainResponse({
  date,
  accountId,
  today,
  dashboard,
}: {
  date: string;
  accountId?: string;
  today: string;
  dashboard: Awaited<ReturnType<typeof buildDashboard>>;
}): DashboardExplainResponse {
  const forecastMonths = Number(DEFAULT_SETTINGS.forecast_months);
  const target = accountId
    ? dashboard.accountForecasts.find((forecast) => forecast.accountId === accountId)
    : null;

  if (accountId && !target) {
    throw new BadRequestError("Account not found");
  }

  const sourceEvents = target?.events ?? dashboard.forecast;
  const rangeEnd = getForecastRangeEnd(today, forecastMonths, sourceEvents);
  if (date < today || date > rangeEnd) {
    throw new BadRequestError("date is outside forecast range");
  }

  const startBalance = target?.currentBalanceJpy ?? dashboard.totalBalance;
  const events = sourceEvents.filter((event) => event.date <= date);
  const sourceTotals = createEmptySourceTotals();

  for (const event of events) {
    addSourceTotal(sourceTotals, event, getEventContributionJpy(event, target?.accountId ?? null));
  }

  return {
    date,
    accountId: target?.accountId ?? null,
    startBalance,
    events: events.map((event) => ({
      id: event.id,
      date: event.date,
      description: event.description,
      type: event.type,
      source: event.source,
      isAssumption: event.isAssumption,
      amountJpy: event.amountJpy,
      runningBalance: event.balanceJpy,
    })),
    sourceTotals,
    finalBalance: events.at(-1)?.balanceJpy ?? startBalance,
    assumptionEventCount: events.filter((event) => event.isAssumption).length,
  };
}

function findMissingIds(ids: string[] | undefined, knownIds: Set<string>) {
  return [...new Set(ids ?? [])].filter((id) => !knownIds.has(id));
}

function assertNoMissingIds(label: string, ids: string[] | undefined, knownIds: Set<string>) {
  const missingIds = findMissingIds(ids, knownIds);
  if (missingIds.length > 0) {
    throw new BadRequestError(`${label} not found: ${missingIds.join(", ")}`);
  }
}

function applySimulationPayload(
  data: DashboardCoreData,
  body: z.infer<typeof simulatePayloadSchema>,
): DashboardCoreData {
  const recurringItemIds = new Set(body.exclude.recurringItemIds ?? []);
  const loanIds = new Set(body.exclude.loanIds ?? []);
  const creditCardIds = new Set(body.exclude.creditCardIds ?? []);
  const assumptionOverrides = new Map(
    body.cardAssumptionOverrides.map((override) => [override.creditCardId, override.assumptionAmount]),
  );

  return {
    ...data,
    recurringItems: data.recurringItems.filter((item) => !recurringItemIds.has(item.id)),
    loans: data.loans.filter((loan) => !loanIds.has(loan.id)),
    creditCards: data.creditCards
      .filter((card) => !creditCardIds.has(card.id))
      .map((card) => {
        const assumptionAmount = assumptionOverrides.get(card.id);
        return assumptionAmount === undefined ? card : { ...card, assumptionAmount };
      }),
  };
}

function buildSimulationSummary(dashboard: Awaited<ReturnType<typeof buildDashboard>>) {
  const minEvent = dashboard.forecast.reduce<ForecastEvent | null>((current, event) => {
    if (!current || event.balanceJpy < current.balanceJpy) {
      return event;
    }
    return current;
  }, null);
  const finalEvent = dashboard.forecast.at(-1);

  return {
    minBalance: dashboard.minBalance,
    minBalanceDate: minEvent && minEvent.balanceJpy <= dashboard.totalBalance ? minEvent.date : null,
    finalBalance: finalEvent?.balanceJpy ?? dashboard.totalBalance,
    warningAccountCount: dashboard.accountForecasts.filter((forecast) => forecast.warningLevel !== "none").length,
  };
}

function buildSimulationResponse({
  baseline,
  simulated,
}: {
  baseline: Awaited<ReturnType<typeof buildDashboard>>;
  simulated: Awaited<ReturnType<typeof buildDashboard>>;
}): DashboardSimulationResponse {
  const baselineSummary = buildSimulationSummary(baseline);
  const simulatedSummary = buildSimulationSummary(simulated);

  return {
    baseline: baselineSummary,
    simulated: simulatedSummary,
    delta: {
      minBalance: simulatedSummary.minBalance - baselineSummary.minBalance,
      finalBalance: simulatedSummary.finalBalance - baselineSummary.finalBalance,
      warningAccountCount: simulatedSummary.warningAccountCount - baselineSummary.warningAccountCount,
    },
  };
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
  .get("/explain", async (c) => {
    try {
      const { date, accountId, applyOffset } = explainQuerySchema.parse(c.req.query());
      const today = getJstToday();
      const dashboard = await buildDashboard(prisma, { applyOffset });

      return c.json(buildExplainResponse({ date, accountId, today, dashboard }));
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .post("/simulate", async (c) => {
    try {
      const body = simulatePayloadSchema.parse(await c.req.json().catch(() => ({})));
      const data = await loadDashboardCoreData(prisma);
      const knownRecurringItemIds = new Set(data.recurringItems.map((item) => item.id));
      const knownLoanIds = new Set(data.loans.map((loan) => loan.id));
      const knownCreditCardIds = new Set(data.creditCards.map((card) => card.id));

      assertNoMissingIds("recurringItemIds", body.exclude.recurringItemIds, knownRecurringItemIds);
      assertNoMissingIds("loanIds", body.exclude.loanIds, knownLoanIds);
      assertNoMissingIds("creditCardIds", body.exclude.creditCardIds, knownCreditCardIds);
      assertNoMissingIds(
        "cardAssumptionOverrides.creditCardId",
        body.cardAssumptionOverrides.map((override) => override.creditCardId),
        knownCreditCardIds,
      );

      const today = getJstToday();
      const baseline = buildDashboardCore({
        ...data,
        today,
        forecastMonths: body.months,
        applyOffset: body.applyOffset,
      });
      const simulated = buildDashboardCore({
        ...applySimulationPayload(data, body),
        today,
        forecastMonths: body.months,
        applyOffset: body.applyOffset,
      });

      return c.json(buildSimulationResponse({ baseline, simulated }));
    } catch (error) {
      return handleRouteError(c, error);
    }
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

      if (event.type === "transfer") {
        const sourceAccountId = event.accountId;
        const destinationAccountId = event.transferToAccountId;

        if (!sourceAccountId && !destinationAccountId) {
          return c.json({ error: "Transfer forecast event requires source or destination account" }, 400);
        }

        if (sourceAccountId && destinationAccountId && sourceAccountId === destinationAccountId) {
          return c.json({ error: "transfer accounts must be different" }, 400);
        }

        const transaction = await prisma.$transaction(async (tx) => {
          let sourceAccount = null;
          let destinationAccount = null;

          if (sourceAccountId) {
            sourceAccount = await tx.account.findFirst({
              where: { id: sourceAccountId, deletedAt: null },
            });
            if (!sourceAccount) {
              throw new BadRequestError("Source account not found");
            }
          }

          if (destinationAccountId) {
            destinationAccount = await tx.account.findFirst({
              where: { id: destinationAccountId, deletedAt: null },
            });
            if (!destinationAccount) {
              throw new BadRequestError("Destination account not found");
            }
          }

          if (
            sourceAccount &&
            destinationAccount &&
            normalizeCurrencyCode(sourceAccount.currencyCode) !==
              normalizeCurrencyCode(destinationAccount.currencyCode)
          ) {
            throw new BadRequestError("Cross-currency transfers are not supported");
          }

          if (sourceAccount) {
            await tx.account.update({
              where: { id: sourceAccount.id },
              data: { balance: { decrement: body.amount } },
            });
          }

          if (destinationAccount) {
            await tx.account.update({
              where: { id: destinationAccount.id },
              data: { balance: { increment: body.amount } },
            });
          }

          return tx.transaction.create({
            data: {
              accountId: sourceAccount?.id ?? null,
              transferToAccountId: destinationAccount?.id ?? null,
              forecastEventId: event.id,
              date: new Date(`${event.date}T00:00:00.000Z`),
              type: "transfer",
              description: event.description,
              amount: body.amount,
            },
          });
        });

        return c.json(transaction, 201);
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
