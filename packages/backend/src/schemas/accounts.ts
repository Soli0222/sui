import { DEFAULT_CURRENCY_CODE, DEFAULT_EXCHANGE_RATE_TO_JPY } from "@sui/shared";
import { z } from "zod";
import { currencyCodeSchema, normalizeExchangeRateToJpy } from "../lib/currency";
import { int32Schema } from "../lib/validation";
import { name100Schema, sortOrderSchema } from "./fields";

const accountFieldsSchema = z.object({
  name: name100Schema,
  balanceOffset: int32Schema().default(0),
  currencyCode: z
    .preprocess((value) => (typeof value === "string" ? value.toUpperCase() : value), currencyCodeSchema)
    .default(DEFAULT_CURRENCY_CODE),
  exchangeRateToJpy: z.coerce.number().finite().positive().default(DEFAULT_EXCHANGE_RATE_TO_JPY),
  sortOrder: sortOrderSchema,
});

const normalizePayload = <T extends z.infer<typeof accountFieldsSchema>>(value: T) => ({
  ...value,
  exchangeRateToJpy: normalizeExchangeRateToJpy(value.currencyCode, value.exchangeRateToJpy),
});

export const createPayloadSchema = accountFieldsSchema.extend({ balance: int32Schema() }).transform(normalizePayload);
export const updatePayloadSchema = accountFieldsSchema.strict().transform(normalizePayload);

export const reconcilePayloadSchema = z.object({
  actualBalance: int32Schema(),
});
