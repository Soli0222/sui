import type { SalaryRecord as DbSalaryRecord } from "@sui/db";
import { Hono } from "hono";
import { z } from "zod";
import { fromDateOnlyString, isDateString, toDateOnlyString } from "../lib/dates";
import { prisma } from "../lib/db";
import { badRequest, handleRouteError, notFound } from "../lib/http";
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

const createPayloadSchema = z
  .object({
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
  })
  .strict();

const updatePayloadSchema = z
  .object({
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
  })
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

function parseYearQuery(value: string): number | null {
  if (!/^\d{4}$/.test(value)) {
    return null;
  }
  const year = Number(value);
  if (year < 1 || year > 9998) {
    return null;
  }
  return year;
}

function calculateDerivedFields(record: {
  grossAmount: number;
  healthInsurance: number;
  pensionInsurance: number;
  employmentInsurance: number;
  childcareSupportLevy: number;
  incomeTax: number;
  residentTax: number;
  yearEndTaxAdjustment: number;
  employeeStockContribution: number;
  employeeStockIncentive: number;
  dcMatchingContribution: number;
  otherDeductions: number;
}) {
  const socialInsuranceTotal =
    record.healthInsurance +
    record.pensionInsurance +
    record.employmentInsurance +
    record.childcareSupportLevy;
  const deductionTotal =
    socialInsuranceTotal +
    record.incomeTax +
    record.residentTax +
    record.yearEndTaxAdjustment +
    record.employeeStockContribution +
    record.employeeStockIncentive +
    record.dcMatchingContribution +
    record.otherDeductions;
  const netAmount = record.grossAmount - deductionTotal;
  return { socialInsuranceTotal, deductionTotal, netAmount };
}

function serializeSalaryRecord(record: DbSalaryRecord) {
  const derived = calculateDerivedFields(record);
  return {
    ...derived,
    id: record.id,
    paidOn: toDateOnlyString(record.paidOn),
    kind: record.kind,
    name: record.name,
    grossAmount: record.grossAmount,
    healthInsurance: record.healthInsurance,
    pensionInsurance: record.pensionInsurance,
    employmentInsurance: record.employmentInsurance,
    childcareSupportLevy: record.childcareSupportLevy,
    incomeTax: record.incomeTax,
    residentTax: record.residentTax,
    yearEndTaxAdjustment: record.yearEndTaxAdjustment,
    employeeStockContribution: record.employeeStockContribution,
    employeeStockIncentive: record.employeeStockIncentive,
    dcMatchingContribution: record.dcMatchingContribution,
    otherDeductions: record.otherDeductions,
    deletedAt: record.deletedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function buildCreateData(body: z.infer<typeof createPayloadSchema>) {
  return {
    paidOn: fromDateOnlyString(body.paidOn),
    kind: body.kind,
    name: body.name,
    grossAmount: body.grossAmount,
    healthInsurance: body.healthInsurance,
    pensionInsurance: body.pensionInsurance,
    employmentInsurance: body.employmentInsurance,
    childcareSupportLevy: body.childcareSupportLevy,
    incomeTax: body.incomeTax,
    residentTax: body.residentTax,
    yearEndTaxAdjustment: body.yearEndTaxAdjustment,
    employeeStockContribution: body.employeeStockContribution,
    employeeStockIncentive: body.employeeStockIncentive,
    dcMatchingContribution: body.dcMatchingContribution,
    otherDeductions: body.otherDeductions,
  };
}

function buildUpdateData(body: z.infer<typeof updatePayloadSchema>) {
  const data: Partial<Omit<DbSalaryRecord, "id" | "deletedAt" | "createdAt" | "updatedAt">> = {};

  if (body.paidOn !== undefined) {
    data.paidOn = fromDateOnlyString(body.paidOn);
  }
  if (body.kind !== undefined) {
    data.kind = body.kind;
  }
  if (body.name !== undefined) {
    data.name = body.name;
  }
  if (body.grossAmount !== undefined) {
    data.grossAmount = body.grossAmount;
  }
  if (body.healthInsurance !== undefined) {
    data.healthInsurance = body.healthInsurance;
  }
  if (body.pensionInsurance !== undefined) {
    data.pensionInsurance = body.pensionInsurance;
  }
  if (body.employmentInsurance !== undefined) {
    data.employmentInsurance = body.employmentInsurance;
  }
  if (body.childcareSupportLevy !== undefined) {
    data.childcareSupportLevy = body.childcareSupportLevy;
  }
  if (body.incomeTax !== undefined) {
    data.incomeTax = body.incomeTax;
  }
  if (body.residentTax !== undefined) {
    data.residentTax = body.residentTax;
  }
  if (body.yearEndTaxAdjustment !== undefined) {
    data.yearEndTaxAdjustment = body.yearEndTaxAdjustment;
  }
  if (body.employeeStockContribution !== undefined) {
    data.employeeStockContribution = body.employeeStockContribution;
  }
  if (body.employeeStockIncentive !== undefined) {
    data.employeeStockIncentive = body.employeeStockIncentive;
  }
  if (body.dcMatchingContribution !== undefined) {
    data.dcMatchingContribution = body.dcMatchingContribution;
  }
  if (body.otherDeductions !== undefined) {
    data.otherDeductions = body.otherDeductions;
  }

  return data;
}

export const salaryRecordsRoutes = new Hono()
  .get("/", async (c) => {
    try {
      const year = c.req.query("year");

      const where: { deletedAt: null; paidOn?: { gte: Date; lt: Date } } = { deletedAt: null };

      if (year !== undefined) {
        const yearNumber = parseYearQuery(year);
        if (yearNumber === null) {
          return badRequest(c, "year must be a supported 4-digit year");
        }

        const startDate = `${String(yearNumber).padStart(4, "0")}-01-01`;
        const endDate = `${String(yearNumber + 1).padStart(4, "0")}-01-01`;
        where.paidOn = {
          gte: fromDateOnlyString(startDate),
          lt: fromDateOnlyString(endDate),
        };
      }

      const records = await prisma.salaryRecord.findMany({
        where,
        orderBy: [{ paidOn: "desc" }],
      });

      return c.json(records.map(serializeSalaryRecord));
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .post("/", async (c) => {
    try {
      const body = createPayloadSchema.parse(await c.req.json());
      const record = await prisma.salaryRecord.create({
        data: buildCreateData(body),
      });
      return c.json(serializeSalaryRecord(record), 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .patch("/:id", async (c) => {
    try {
      const body = updatePayloadSchema.parse(await c.req.json());

      const existing = await prisma.salaryRecord.findFirst({
        where: { id: c.req.param("id"), deletedAt: null },
      });
      if (!existing) {
        return notFound(c, "Salary record not found");
      }

      const record = await prisma.salaryRecord.update({
        where: { id: existing.id },
        data: buildUpdateData(body),
      });
      return c.json(serializeSalaryRecord(record));
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id", async (c) => {
    try {
      const existing = await prisma.salaryRecord.findFirst({
        where: { id: c.req.param("id"), deletedAt: null },
      });
      if (!existing) {
        return notFound(c, "Salary record not found");
      }

      await prisma.salaryRecord.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });

      return c.body(null, 204);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
