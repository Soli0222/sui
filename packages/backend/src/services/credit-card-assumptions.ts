import type { PrismaClient } from "@sui/db";
import type { CreditCardAssumptionSuggestionResponse } from "@sui/shared";
import { addMonthsToYearMonth } from "../lib/dates";

function median(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }

  return Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

export async function buildCreditCardAssumptionSuggestion(
  prisma: PrismaClient,
  {
    creditCardId,
    currentYearMonth,
    months,
  }: {
    creditCardId: string;
    currentYearMonth: string;
    months: number;
  },
): Promise<CreditCardAssumptionSuggestionResponse> {
  const fromYearMonth = addMonthsToYearMonth(currentYearMonth, -months);
  const billings = await prisma.creditCardBilling.findMany({
    where: {
      yearMonth: {
        gte: fromYearMonth,
        lt: currentYearMonth,
      },
      items: {
        some: {
          creditCardId,
          amount: { gt: 0 },
        },
      },
    },
    include: {
      items: {
        where: {
          creditCardId,
          amount: { gt: 0 },
        },
        select: { amount: true },
      },
    },
    orderBy: { yearMonth: "asc" },
  });

  const samples = billings.flatMap((billing) => billing.items.map((item) => item.amount));

  return {
    creditCardId,
    method: "median",
    months,
    sampleCount: samples.length,
    sourceYearMonths: billings.map((billing) => billing.yearMonth),
    suggestedAmount: median(samples),
  };
}
