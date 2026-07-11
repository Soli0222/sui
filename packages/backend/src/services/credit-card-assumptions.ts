import type { PrismaClient } from "@sui/db";
import type { CreditCardAssumptionSuggestionResponse } from "@sui/shared";
import { addMonthsToYearMonth } from "../lib/dates";

function averageWithCeil(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sum = values.reduce((acc, value) => acc + value, 0);
  return Math.ceil(sum / values.length);
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
    method: "average",
    months,
    sampleCount: samples.length,
    sourceYearMonths: billings.map((billing) => billing.yearMonth),
    suggestedAmount: averageWithCeil(samples),
  };
}
