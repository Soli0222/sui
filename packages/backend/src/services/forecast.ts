import type { DashboardResponse } from "@sui/shared";
import type { PrismaClient } from "@sui/db";
import { DEFAULT_SETTINGS } from "@sui/shared";
import { getJstToday } from "../lib/dates";
import { buildDashboardCore } from "./forecast-core";

export { applyEvent, sortEvents } from "./forecast-core";

export async function buildDashboard(
  prisma: PrismaClient,
  options?: { forecastMonths?: number; applyOffset?: boolean },
): Promise<DashboardResponse> {
  const today = getJstToday();
  const applyOffset = options?.applyOffset ?? true;

  const [accounts, recurringItems, creditCards, billings, loans, confirmedTransactions] =
    await Promise.all([
      prisma.account.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      prisma.recurringItem.findMany({
        where: { deletedAt: null, enabled: true },
        include: { account: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      prisma.creditCard.findMany({
        where: { deletedAt: null },
        include: { account: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      prisma.creditCardBilling.findMany({
        include: { items: true },
      }),
      prisma.loan.findMany({
        where: { deletedAt: null },
        include: { account: true },
        orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
      }),
      prisma.transaction.findMany({
        where: { forecastEventId: { not: null } },
        select: { forecastEventId: true, amount: true },
      }),
    ]);

  const forecastMonths = options?.forecastMonths ?? Number(DEFAULT_SETTINGS.forecast_months);

  return buildDashboardCore({
    accounts,
    recurringItems,
    creditCards,
    billings,
    loans,
    confirmedTransactions,
    today,
    forecastMonths,
    applyOffset,
  });
}
