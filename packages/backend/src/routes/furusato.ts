import type { FurusatoSimulationInputPayload, FurusatoSimulationResponse } from "@sui/shared";
import { Hono } from "hono";
import { z } from "zod";
import { fromDateOnlyString, getJstToday } from "../lib/dates";
import { prisma } from "../lib/db";
import { badRequest, handleRouteError } from "../lib/http";
import { nonNegativeInt32Schema } from "../lib/validation";
import { calculateFurusatoSimulation } from "../services/furusato-core";

const SUPPORTED_YEAR_MIN = 1;
const SUPPORTED_YEAR_MAX = 9998;

const yearSchema = z.number().int().min(SUPPORTED_YEAR_MIN).max(SUPPORTED_YEAR_MAX);
const amountSchema = nonNegativeInt32Schema();

const simulationInputSchema = z
  .object({
    year: yearSchema,
    expectedBonusGross: amountSchema,
    otherIncome: amountSchema,
    otherDeductions: amountSchema,
  })
  .strict();

function parseYear(value: string): number | null {
  if (!/^\d{4}$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return parsed >= SUPPORTED_YEAR_MIN && parsed <= SUPPORTED_YEAR_MAX ? parsed : null;
}

function defaultYear(): number {
  return Number(getJstToday().slice(0, 4));
}

function yearRange(year: number) {
  return {
    gte: fromDateOnlyString(`${String(year).padStart(4, "0")}-01-01`),
    lt: fromDateOnlyString(`${String(year + 1).padStart(4, "0")}-01-01`),
  };
}

function serializeInput(input: FurusatoSimulationInputPayload) {
  return {
    year: input.year,
    expectedBonusGross: input.expectedBonusGross,
    otherIncome: input.otherIncome,
    otherDeductions: input.otherDeductions,
  };
}

export const furusatoRoutes = new Hono()
  .get("/simulation", async (c) => {
    try {
      const yearQuery = c.req.query("year");
      const year = yearQuery === undefined ? defaultYear() : parseYear(yearQuery);
      if (year === null) {
        return badRequest(c, "year must be a supported 4-digit year");
      }

      const range = yearRange(year);
      const [salaryRecords, donations, savedInput] = await Promise.all([
        prisma.salaryRecord.findMany({
          where: { deletedAt: null, paidOn: range },
          orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }],
        }),
        prisma.donation.findMany({
          where: { deletedAt: null, donatedOn: range },
          orderBy: [{ donatedOn: "asc" }, { createdAt: "asc" }],
        }),
        prisma.furusatoSimulationInput.findUnique({ where: { year } }),
      ]);

      const input = {
        expectedBonusGross: savedInput?.expectedBonusGross ?? 0,
        otherIncome: savedInput?.otherIncome ?? 0,
        otherDeductions: savedInput?.otherDeductions ?? 0,
      };

      const result: FurusatoSimulationResponse = calculateFurusatoSimulation({
        year,
        salaryRecords,
        donations,
        input,
        referenceDate: fromDateOnlyString(getJstToday()),
      });
      return c.json(result);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .put("/simulation-input", async (c) => {
    try {
      const body = simulationInputSchema.parse(await c.req.json());
      const saved = await prisma.furusatoSimulationInput.upsert({
        where: { year: body.year },
        create: body,
        update: {
          expectedBonusGross: body.expectedBonusGross,
          otherIncome: body.otherIncome,
          otherDeductions: body.otherDeductions,
        },
      });
      return c.json(serializeInput(saved));
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
