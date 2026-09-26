import { z } from "zod";
import { isDateString } from "../lib/dates";
import { int32Schema, nonNegativeInt32Schema } from "../lib/validation";

const salaryRecordKindSchema = z.enum(["salary", "bonus"]);

const amountSchema = nonNegativeInt32Schema();
/** 控除は年末調整過不足税額（還付）のようにマイナスになりうるため符号付きで受ける。 */
const deductionSchema = int32Schema();

const optionalNameSchema = z
  .union([z.string().max(100), z.null()])
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

const paidOnSchema = z.string().refine(isDateString, {
  message: "paidOn must be YYYY-MM-DD",
});

export const salaryCreatePayloadShape = {
  paidOn: paidOnSchema,
  kind: salaryRecordKindSchema.default("salary"),
  name: optionalNameSchema.default(null),
  grossAmount: amountSchema,
  healthInsurance: deductionSchema.default(0),
  pensionInsurance: deductionSchema.default(0),
  employmentInsurance: deductionSchema.default(0),
  childcareSupportLevy: deductionSchema.default(0),
  incomeTax: deductionSchema.default(0),
  residentTax: deductionSchema.default(0),
  yearEndTaxAdjustment: deductionSchema.default(0),
  employeeStockContribution: deductionSchema.default(0),
  employeeStockIncentive: deductionSchema.default(0),
  dcMatchingContribution: deductionSchema.default(0),
  otherDeductions: deductionSchema.default(0),
};
export const createPayloadSchema = z.object(salaryCreatePayloadShape).strict();

export const salaryUpdatePayloadShape = {
  paidOn: paidOnSchema.optional(),
  kind: salaryRecordKindSchema.optional(),
  name: optionalNameSchema,
  grossAmount: amountSchema.optional(),
  healthInsurance: deductionSchema.optional(),
  pensionInsurance: deductionSchema.optional(),
  employmentInsurance: deductionSchema.optional(),
  childcareSupportLevy: deductionSchema.optional(),
  incomeTax: deductionSchema.optional(),
  residentTax: deductionSchema.optional(),
  yearEndTaxAdjustment: deductionSchema.optional(),
  employeeStockContribution: deductionSchema.optional(),
  employeeStockIncentive: deductionSchema.optional(),
  dcMatchingContribution: deductionSchema.optional(),
  otherDeductions: deductionSchema.optional(),
};
export const updatePayloadSchema = z.object(salaryUpdatePayloadShape)
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
