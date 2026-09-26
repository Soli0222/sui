import { z } from "zod";
import { nonNegativeInt32Schema } from "../lib/validation";

export const SUPPORTED_YEAR_MIN = 1;
export const SUPPORTED_YEAR_MAX = 9998;

const yearSchema = z.number().int().min(SUPPORTED_YEAR_MIN).max(SUPPORTED_YEAR_MAX);
const amountSchema = nonNegativeInt32Schema();

export const furusatoSimulationInputShape = {
  year: yearSchema,
  expectedBonusGross: amountSchema,
  otherIncome: amountSchema,
  otherDeductions: amountSchema,
};
export const simulationInputSchema = z.object(furusatoSimulationInputShape).strict();
