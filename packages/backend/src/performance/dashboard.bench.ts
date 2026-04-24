import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "@sui/db";
import { resetDatabase } from "@sui/db/testing";
import type { PrismaClient } from "@sui/db";
import { addMonthsToYearMonth, getCurrentYearMonth, getJstToday } from "../lib/dates";
import { buildDashboard } from "../services/forecast";
import { measurePerformance, writePerformanceReport } from "./report";

interface Scenario {
  name: string;
  accounts: number;
  recurringItems: number;
  creditCards: number;
  loans: number;
  confirmedTransactions: number;
  samples: number;
}

const scenarios: Scenario[] = [
  {
    name: "dashboard small",
    accounts: 3,
    recurringItems: 20,
    creditCards: 3,
    loans: 2,
    confirmedTransactions: 100,
    samples: 30,
  },
  {
    name: "dashboard medium",
    accounts: 10,
    recurringItems: 200,
    creditCards: 20,
    loans: 20,
    confirmedTransactions: 2_000,
    samples: 20,
  },
  {
    name: "dashboard large",
    accounts: 30,
    recurringItems: 1_000,
    creditCards: 100,
    loans: 100,
    confirmedTransactions: 20_000,
    samples: 10,
  },
];

const prisma = createPrismaClient({ log: ["error"] });

function fixedDate(yearMonth: string, day: number) {
  return new Date(`${yearMonth}-${String(day).padStart(2, "0")}T00:00:00.000Z`);
}

async function seedScenario(prismaClient: PrismaClient, scenario: Scenario) {
  await resetDatabase(prismaClient);
  const currentYearMonth = getCurrentYearMonth(getJstToday());
  const firstForecastYearMonth = addMonthsToYearMonth(currentYearMonth, 1);

  const accounts = await prismaClient.account.createManyAndReturn({
    data: Array.from({ length: scenario.accounts }, (_, index) => ({
      name: `Performance Account ${index + 1}`,
      balance: 1_000_000 + index * 10_000,
      balanceOffset: index % 4 === 0 ? 50_000 : 0,
      sortOrder: index,
    })),
  });

  await prismaClient.recurringItem.createMany({
    data: Array.from({ length: scenario.recurringItems }, (_, index) => {
      const account = accounts[index % accounts.length];
      return {
        name: `Recurring ${index + 1}`,
        type: index % 5 === 0 ? "income" : "expense",
        amount: 1_000 + (index % 40) * 500,
        dayOfMonth: (index % 28) + 1,
        accountId: account?.id ?? null,
        enabled: true,
        startDate: fixedDate(firstForecastYearMonth, 1),
        endDate: null,
        sortOrder: index,
      };
    }),
  });

  const creditCards = await prismaClient.creditCard.createManyAndReturn({
    data: Array.from({ length: scenario.creditCards }, (_, index) => {
      const account = accounts[index % accounts.length];
      return {
        name: `Performance Card ${index + 1}`,
        settlementDay: (index % 28) + 1,
        accountId: account?.id ?? null,
        assumptionAmount: 5_000 + (index % 30) * 1_000,
        sortOrder: index,
      };
    }),
  });

  for (let monthOffset = 0; monthOffset < 3; monthOffset += 1) {
    const yearMonth = addMonthsToYearMonth(firstForecastYearMonth, monthOffset);
    const billing = await prismaClient.creditCardBilling.create({
      data: {
        yearMonth,
        settlementDate: fixedDate(yearMonth, 27),
      },
    });

    await prismaClient.creditCardItem.createMany({
      data: creditCards.map((card, index) => ({
        billingId: billing.id,
        creditCardId: card.id,
        amount: 3_000 + ((index + monthOffset) % 25) * 700,
      })),
    });
  }

  await prismaClient.loan.createMany({
    data: Array.from({ length: scenario.loans }, (_, index) => {
      const account = accounts[index % accounts.length];
      return {
        name: `Performance Loan ${index + 1}`,
        totalAmount: 300_000 + index * 1_000,
        startDate: fixedDate(firstForecastYearMonth, 1),
        paymentCount: 36,
        accountId: account?.id ?? null,
      };
    }),
  });

  const transactionBatchSize = 1_000;
  for (let offset = 0; offset < scenario.confirmedTransactions; offset += transactionBatchSize) {
    const size = Math.min(transactionBatchSize, scenario.confirmedTransactions - offset);
    await prismaClient.transaction.createMany({
      data: Array.from({ length: size }, (_, batchIndex) => {
        const index = offset + batchIndex;
        const account = accounts[index % accounts.length];
        return {
          accountId: account?.id ?? accounts[0]!.id,
          forecastEventId: `confirmed:${scenario.name}:${index}`,
          date: fixedDate(firstForecastYearMonth, (index % 28) + 1),
          type: index % 7 === 0 ? "income" : "expense",
          description: `Confirmed performance transaction ${index + 1}`,
          amount: 500 + (index % 20) * 100,
        };
      }),
    });
  }
}

describe("dashboard performance", () => {
  afterAll(async () => {
    await writePerformanceReport();
    await prisma.$disconnect();
  });

  for (const scenario of scenarios) {
    it(
      `measures ${scenario.name}`,
      async () => {
        await seedScenario(prisma, scenario);

        await measurePerformance(
          scenario.name,
          async () => {
            const dashboard = await buildDashboard(prisma, { forecastMonths: 12 });
            expect(dashboard.forecast.length).toBeGreaterThan(0);
          },
          { samples: scenario.samples },
        );
      },
      120_000,
    );
  }
});
