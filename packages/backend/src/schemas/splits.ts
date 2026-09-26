import { z } from "zod";
import { description200Schema, memo200Schema, positiveRatioSchema, splitMethodSchema, uuidSchema } from "./fields";

export const splitPayloadSchema = z.object({
  date: z.string(),
  description: description200Schema,
  memo: memo200Schema.nullable().optional().default(null),
  amount: z.number().int().min(1),
  method: splitMethodSchema,
  ownRatio: positiveRatioSchema.nullable().optional(),
  shares: z.array(
    z.object({
      personId: uuidSchema,
      ratio: positiveRatioSchema.nullable().optional(),
      amount: z.number().int().min(1).optional(),
    }),
  ),
});
