import { z } from "zod";
import { positiveInt32Schema } from "../lib/validation";
import { description200Schema, transactionTypeSchema, uuidSchema } from "./fields";

export const transactionPayloadSchema = z.object({
  accountId: uuidSchema.nullish(),
  transferToAccountId: uuidSchema.nullish(),
  date: z.string(),
  type: transactionTypeSchema,
  description: description200Schema,
  amount: positiveInt32Schema(),
});

export type TransactionPayload = z.infer<typeof transactionPayloadSchema>;
