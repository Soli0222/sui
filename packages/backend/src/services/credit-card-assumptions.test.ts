import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@sui/db";
import { buildCreditCardAssumptionSuggestion } from "./credit-card-assumptions";

function createMockPrisma(
  billings: Array<{ yearMonth: string; items: Array<{ amount: number }> }>,
) {
  const findMany = vi.fn().mockResolvedValue(billings);
  return { creditCardBilling: { findMany } } as unknown as PrismaClient;
}

describe("buildCreditCardAssumptionSuggestion", () => {
  it("suggests the arithmetic average for a divisible sum", async () => {
    const prisma = createMockPrisma([
      { yearMonth: "2026-01", items: [{ amount: 10000 }] },
      { yearMonth: "2026-02", items: [{ amount: 30000 }] },
      { yearMonth: "2026-03", items: [{ amount: 20000 }] },
    ]);

    const result = await buildCreditCardAssumptionSuggestion(prisma, {
      creditCardId: "card-1",
      currentYearMonth: "2026-06",
      months: 6,
    });

    expect(result).toEqual({
      creditCardId: "card-1",
      method: "average",
      months: 6,
      sampleCount: 3,
      sourceYearMonths: ["2026-01", "2026-02", "2026-03"],
      suggestedAmount: 20000,
    });
  });

  it("ceils a fractional average to 1 yen", async () => {
    const prisma = createMockPrisma([
      { yearMonth: "2026-02", items: [{ amount: 10000 }] },
      { yearMonth: "2026-04", items: [{ amount: 20000 }] },
      { yearMonth: "2026-05", items: [{ amount: 30001 }] },
    ]);

    const result = await buildCreditCardAssumptionSuggestion(prisma, {
      creditCardId: "card-1",
      currentYearMonth: "2026-06",
      months: 6,
    });

    expect(result.suggestedAmount).toBe(20001);
  });

  it("returns the single sample as the suggestion", async () => {
    const prisma = createMockPrisma([
      { yearMonth: "2026-04", items: [{ amount: 15000 }] },
    ]);

    const result = await buildCreditCardAssumptionSuggestion(prisma, {
      creditCardId: "card-1",
      currentYearMonth: "2026-06",
      months: 6,
    });

    expect(result.suggestedAmount).toBe(15000);
    expect(result.sampleCount).toBe(1);
  });

  it("returns null when there are no samples", async () => {
    const prisma = createMockPrisma([]);

    const result = await buildCreditCardAssumptionSuggestion(prisma, {
      creditCardId: "card-1",
      currentYearMonth: "2026-06",
      months: 6,
    });

    expect(result.suggestedAmount).toBeNull();
    expect(result.sampleCount).toBe(0);
    expect(result.sourceYearMonths).toEqual([]);
  });

  it("queries the expected range and keeps positive amounts only", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { creditCardBilling: { findMany } } as unknown as PrismaClient;

    await buildCreditCardAssumptionSuggestion(prisma, {
      creditCardId: "card-1",
      currentYearMonth: "2026-06",
      months: 6,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          yearMonth: { gte: "2025-12", lt: "2026-06" },
          items: { some: { creditCardId: "card-1", amount: { gt: 0 } } },
        }),
        include: expect.objectContaining({
          items: {
            where: { creditCardId: "card-1", amount: { gt: 0 } },
            select: { amount: true },
          },
        }),
        orderBy: { yearMonth: "asc" },
      }),
    );
  });
});
