import { DEFAULT_SETTINGS } from "@sui/shared";
import { z } from "zod";
import { positiveInt32Schema } from "../lib/validation";
import { forecastMonthsSchema, uuidSchema } from "./fields";

export const payloadSchema = z.object({
  forecastEventId: z.string().min(1),
  amount: positiveInt32Schema(),
  accountId: uuidSchema.optional(),
});

export const eventsQuerySchema = z.object({
  months: z.coerce.number().pipe(forecastMonthsSchema).default(3),
  applyOffset: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
});

export const dashboardQuerySchema = z.object({
  applyOffset: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
});

const dateQuerySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD形式で指定してください");

const optionalUuidQuerySchema = z.preprocess(
  (value) => value === "" ? undefined : value,
  uuidSchema.optional(),
);

export const explainQuerySchema = dashboardQuerySchema.extend({
  date: dateQuerySchema,
  accountId: optionalUuidQuerySchema,
});

export const simulatePayloadSchema = z.object({
  months: forecastMonthsSchema.default(Number(DEFAULT_SETTINGS.forecast_months)),
  applyOffset: z.boolean().default(true),
  exclude: z.object({
    recurringItemIds: z.array(uuidSchema).optional(),
    loanIds: z.array(uuidSchema).optional(),
    creditCardIds: z.array(uuidSchema).optional(),
  }).default({}),
  cardAssumptionOverrides: z.array(z.object({
    creditCardId: uuidSchema,
    assumptionAmount: positiveInt32Schema(),
  })).default([]),
});
