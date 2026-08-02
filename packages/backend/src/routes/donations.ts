import type { Donation as DbDonation } from "@sui/db";
import { Hono } from "hono";
import { z } from "zod";
import { fromDateOnlyString, isDateString, toDateOnlyString } from "../lib/dates";
import { prisma } from "../lib/db";
import { badRequest, handleRouteError, notFound } from "../lib/http";
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

const createPayloadSchema = z
  .object({
    recipient: recipientSchema,
    amount: amountSchema,
    memo: memoSchema.default(null),
    donatedOn: donatedOnSchema,
  })
  .strict();

const updatePayloadSchema = z
  .object({
    recipient: recipientSchema.optional(),
    amount: amountSchema.optional(),
    memo: memoSchema,
    donatedOn: donatedOnSchema.optional(),
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

function serializeDonation(record: DbDonation) {
  return {
    id: record.id,
    recipient: record.recipient,
    amount: record.amount,
    memo: record.memo,
    donatedOn: toDateOnlyString(record.donatedOn),
    deletedAt: record.deletedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function buildCreateData(body: z.infer<typeof createPayloadSchema>) {
  return {
    recipient: body.recipient,
    amount: body.amount,
    memo: body.memo,
    donatedOn: fromDateOnlyString(body.donatedOn),
  };
}

function buildUpdateData(body: z.infer<typeof updatePayloadSchema>) {
  const data: Partial<Omit<DbDonation, "id" | "deletedAt" | "createdAt" | "updatedAt">> = {};

  if (body.recipient !== undefined) {
    data.recipient = body.recipient;
  }
  if (body.amount !== undefined) {
    data.amount = body.amount;
  }
  if (body.memo !== undefined) {
    data.memo = body.memo;
  }
  if (body.donatedOn !== undefined) {
    data.donatedOn = fromDateOnlyString(body.donatedOn);
  }

  return data;
}

export const donationsRoutes = new Hono()
  .get("/", async (c) => {
    try {
      const year = c.req.query("year");

      const where: { deletedAt: null; donatedOn?: { gte: Date; lt: Date } } = { deletedAt: null };

      if (year !== undefined) {
        const yearNumber = parseYearQuery(year);
        if (yearNumber === null) {
          return badRequest(c, "year must be a supported 4-digit year");
        }

        const startDate = `${String(yearNumber).padStart(4, "0")}-01-01`;
        const endDate = `${String(yearNumber + 1).padStart(4, "0")}-01-01`;
        where.donatedOn = {
          gte: fromDateOnlyString(startDate),
          lt: fromDateOnlyString(endDate),
        };
      }

      const records = await prisma.donation.findMany({
        where,
        orderBy: [{ donatedOn: "desc" }],
      });

      return c.json(records.map(serializeDonation));
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .post("/", async (c) => {
    try {
      const body = createPayloadSchema.parse(await c.req.json());
      const record = await prisma.donation.create({
        data: buildCreateData(body),
      });
      return c.json(serializeDonation(record), 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .patch("/:id", async (c) => {
    try {
      const body = updatePayloadSchema.parse(await c.req.json());

      const existing = await prisma.donation.findFirst({
        where: { id: c.req.param("id"), deletedAt: null },
      });
      if (!existing) {
        return notFound(c, "Donation not found");
      }

      const record = await prisma.donation.update({
        where: { id: existing.id },
        data: buildUpdateData(body),
      });
      return c.json(serializeDonation(record));
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id", async (c) => {
    try {
      const existing = await prisma.donation.findFirst({
        where: { id: c.req.param("id"), deletedAt: null },
      });
      if (!existing) {
        return notFound(c, "Donation not found");
      }

      await prisma.donation.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });

      return c.body(null, 204);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
