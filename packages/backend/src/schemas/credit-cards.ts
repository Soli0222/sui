import { hasOverlappingAssumptions, isValidYearMonth } from "@sui/shared";
import { z } from "zod";
import { nonNegativeInt32Schema } from "../lib/validation";
import { dateShiftPolicySchema, dayOfMonthSchema, name100Schema, sortOrderSchema, suggestionMonthsSchema, uuidSchema } from "./fields";

const assumptionMonthSchema = z.string().refine(isValidYearMonth, "YYYY-MM の実在する年月を指定してください").nullable();
export const assumptionSchema = z.object({
  amount: nonNegativeInt32Schema(),
  startMonth: assumptionMonthSchema,
  endMonth: assumptionMonthSchema,
}).refine((period) => !period.startMonth || !period.endMonth || period.startMonth <= period.endMonth, {
  message: "開始月は終了月以前にしてください",
  path: ["endMonth"],
});

const basePayloadSchema = z.object({
  name: name100Schema,
  settlementDay: dayOfMonthSchema.nullable().optional(),
  accountId: uuidSchema,
  assumptionAmount: nonNegativeInt32Schema().optional(),
  assumptions: z.array(assumptionSchema).refine((periods) => !hasOverlappingAssumptions(periods), "同じカードの適用期間は重複できません").optional(),
  sortOrder: sortOrderSchema,
});

export const createPayloadSchema = basePayloadSchema.safeExtend({
  dateShiftPolicy: dateShiftPolicySchema.optional().default("none"),
});

export const updatePayloadSchema = basePayloadSchema.safeExtend({
  dateShiftPolicy: dateShiftPolicySchema.optional(),
});

export const suggestionQuerySchema = z.object({
  months: z.coerce.number().pipe(suggestionMonthsSchema).optional().default(6),
});
