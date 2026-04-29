import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/db";
import { isDateString } from "../lib/dates";
import { badRequest, handleRouteError, notFound } from "../lib/http";
import { positiveInt32Schema } from "../lib/validation";
import { getLoanSnapshot } from "../services/loans";

const dateShiftPolicySchema = z.enum(["none", "previous", "next"]);

const basePayloadSchema = z.object({
  name: z.string().min(1).max(100),
  totalAmount: positiveInt32Schema(),
  paymentCount: positiveInt32Schema(),
  startDate: z.string(),
  accountId: z.string().uuid(),
});

const createPayloadSchema = basePayloadSchema.extend({
  dateShiftPolicy: dateShiftPolicySchema.optional().default("none"),
});

const updatePayloadSchema = basePayloadSchema.extend({
  dateShiftPolicy: dateShiftPolicySchema.optional(),
});

function buildLoanData(body: z.infer<typeof createPayloadSchema> | z.infer<typeof updatePayloadSchema>) {
  return {
    name: body.name,
    totalAmount: body.totalAmount,
    paymentCount: body.paymentCount,
    startDate: new Date(`${body.startDate}T00:00:00.000Z`),
    accountId: body.accountId,
    ...(body.dateShiftPolicy !== undefined ? { dateShiftPolicy: body.dateShiftPolicy } : {}),
  };
}

export const loansRoutes = new Hono()
  .get("/", async (c) => {
    const [loans, transactions] = await Promise.all([
      prisma.loan.findMany({
        where: { deletedAt: null },
        include: { account: true },
        orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
      }),
      prisma.transaction.findMany({
        where: { forecastEventId: { startsWith: "loan:" }, deletedAt: null },
        select: { forecastEventId: true, amount: true },
      }),
    ]);

    return c.json(
      loans.map((loan) => ({
        ...loan,
        ...getLoanSnapshot(loan, transactions),
      })),
    );
  })
  .post("/", async (c) => {
    try {
      const body = createPayloadSchema.parse(await c.req.json());
      if (!isDateString(body.startDate)) {
        return badRequest(c, "startDate must be YYYY-MM-DD");
      }

      const loan = await prisma.loan.create({
        data: buildLoanData(body),
      });
      return c.json(loan, 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .put("/:id", async (c) => {
    try {
      const body = updatePayloadSchema.parse(await c.req.json());
      if (!isDateString(body.startDate)) {
        return badRequest(c, "startDate must be YYYY-MM-DD");
      }

      const existing = await prisma.loan.findFirst({
        where: { id: c.req.param("id"), deletedAt: null },
      });
      if (!existing) {
        return notFound(c, "Loan not found");
      }

      const loan = await prisma.loan.update({
        where: { id: existing.id },
        data: buildLoanData(body),
      });
      return c.json(loan);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id", async (c) => {
    const existing = await prisma.loan.findFirst({
      where: { id: c.req.param("id"), deletedAt: null },
    });
    if (!existing) {
      return notFound(c, "Loan not found");
    }

    await prisma.loan.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
    return c.body(null, 204);
  });
