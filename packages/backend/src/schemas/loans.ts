import { z } from "zod";
import { positiveInt32Schema } from "../lib/validation";
import { dateShiftPolicySchema, loanPaymentMethodSchema, name100Schema, uuidSchema } from "./fields";

const basePayloadSchema = z.object({
  name: name100Schema,
  totalAmount: positiveInt32Schema(),
  paymentCount: positiveInt32Schema(),
  startDate: z.string(),
  paymentMethod: loanPaymentMethodSchema.optional(),
  accountId: z.preprocess((value) => (value === "" ? null : value), uuidSchema.nullable()),
});

export const createPayloadSchema = basePayloadSchema.extend({
  dateShiftPolicy: dateShiftPolicySchema.optional().default("none"),
  paymentMethod: loanPaymentMethodSchema.optional().default("account_withdrawal"),
});

export const updatePayloadSchema = basePayloadSchema.extend({
  dateShiftPolicy: dateShiftPolicySchema.optional(),
});
