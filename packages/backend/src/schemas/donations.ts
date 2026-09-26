import { z } from "zod";
import { isDateString } from "../lib/dates";
import { positiveInt32Schema } from "../lib/validation";

const recipientSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length >= 1 && value.length <= 100, {
    message: "recipient must be 1..100 characters",
  });

const amountSchema = positiveInt32Schema();

const memoSchema = z
  .union([z.string().max(200), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  });

const donatedOnSchema = z.string().refine(isDateString, {
  message: "donatedOn must be YYYY-MM-DD",
});

export const donationCreatePayloadShape = {
  recipient: recipientSchema,
  amount: amountSchema,
  memo: memoSchema.default(null),
  donatedOn: donatedOnSchema,
};
export const createPayloadSchema = z.object(donationCreatePayloadShape).strict();

export const donationUpdatePayloadShape = {
  recipient: recipientSchema.optional(),
  amount: amountSchema.optional(),
  memo: memoSchema,
  donatedOn: donatedOnSchema.optional(),
};
export const updatePayloadSchema = z.object(donationUpdatePayloadShape)
  .strict()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "At least one field is required",
        path: [],
      });
    }
  });
