import { z } from "zod";
import { nonNegativeInt32Schema } from "../lib/validation";
import { uuidSchema } from "./fields";

export const payloadSchema = z.object({
  settlementDate: z.string().optional(),
  items: z.array(
    z.object({
      creditCardId: uuidSchema,
      amount: nonNegativeInt32Schema(),
    }),
  ),
});
