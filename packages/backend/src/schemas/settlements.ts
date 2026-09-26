import { z } from "zod";
import { memo200Schema, settlementKindSchema, uuidSchema } from "./fields";

export const payloadSchema = z.object({
  kind: settlementKindSchema,
  personId: uuidSchema,
  transactionId: uuidSchema.nullish(),
  date: z.string().optional(),
  note: memo200Schema.nullish(),
  allocations: z
    .array(
      z.object({
        shareId: uuidSchema,
        amount: z.number().int().positive(),
      }),
    )
    .min(1),
});
