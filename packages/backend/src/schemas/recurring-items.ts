import { z } from "zod";
import { isDateString } from "../lib/dates";
import { dateShiftPolicySchema, dayOfMonthSchema, dayOfWeekSchema, intervalSchema, name100Schema, nonNegativeMoneySchema, recurrenceSchema, sortOrderSchema, transactionTypeSchema, uuidSchema } from "./fields";

export const amountChangeSchema = z.object({
  effectiveFrom: z.string().refine(isDateString, "effectiveFrom must be YYYY-MM-DD"),
  amount: nonNegativeMoneySchema,
}).strict();

const basePayloadSchema = z.object({
  name: name100Schema,
  type: transactionTypeSchema,
  amount: nonNegativeMoneySchema,
  recurrence: recurrenceSchema.optional(),
  interval: intervalSchema.optional(),
  dayOfMonth: dayOfMonthSchema.nullable().optional(),
  dayOfWeek: dayOfWeekSchema.nullable().optional(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  accountId: uuidSchema.nullish(),
  transferToAccountId: uuidSchema.nullish(),
  enabled: z.boolean(),
  sortOrder: sortOrderSchema,
});

export const createPayloadSchema = basePayloadSchema.extend({
  dateShiftPolicy: dateShiftPolicySchema.optional().default("none"),
});

export const updatePayloadSchema = basePayloadSchema.extend({
  dateShiftPolicy: dateShiftPolicySchema.optional(),
});
