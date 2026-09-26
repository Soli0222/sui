import { DEFAULT_CURRENCY_CODE, DEFAULT_EXCHANGE_RATE_TO_JPY } from "@sui/shared";
import { z } from "zod";
import { currencyCodeSchema, normalizeExchangeRateToJpy } from "../lib/currency";
import { isDateString } from "../lib/dates";
import { name100Schema, recurrenceSchema, dayOfMonthSchema, dayOfWeekSchema, intervalSchema, positiveMoneySchema } from "./fields";

export const amountChangeSchema = z.object({
  effectiveFrom: z.string().refine(isDateString, "effectiveFrom must be YYYY-MM-DD"),
  amount: positiveMoneySchema,
}).strict();

export const payloadSchema = z.object({
  name: name100Schema,
  amount: positiveMoneySchema,
  currencyCode: z
    .preprocess((value) => (typeof value === "string" ? value.toUpperCase() : value), currencyCodeSchema)
    .default(DEFAULT_CURRENCY_CODE),
  exchangeRateToJpy: z.coerce.number().finite().positive().default(DEFAULT_EXCHANGE_RATE_TO_JPY),
  recurrence: recurrenceSchema.optional(),
  interval: intervalSchema.optional(),
  startDate: z.string(),
  dayOfMonth: dayOfMonthSchema.nullable().optional(),
  dayOfWeek: dayOfWeekSchema.nullable().optional(),
  endDate: z.string().nullable().optional(),
  paymentSource: z.string().max(100).nullable().optional(),
}).strict().transform((value) => ({
  ...value,
  exchangeRateToJpy: normalizeExchangeRateToJpy(value.currencyCode, value.exchangeRateToJpy),
}));
