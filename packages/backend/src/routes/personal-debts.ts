import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/db";
import { handleRouteError, notFound } from "../lib/http";
import { positiveInt32Schema } from "../lib/validation";
import {
  cancelPersonalDebt,
  createPersonalDebt,
  deletePersonalDebtSettlement,
  getPersonalDebt,
  listPersonalDebts,
  settlePersonalDebt,
  updatePersonalDebt,
  updatePersonalDebtSettlement,
} from "../services/personal-debts";

const payloadSchema = z.object({
  direction: z.enum(["lent", "borrowed"]),
  origin: z.enum(["cash_loan", "reimbursement"]).default("cash_loan"),
  counterpartyName: z.string().min(1).max(100),
  title: z.string().min(1).max(100),
  principalAmount: positiveInt32Schema(),
  openedDate: z.string(),
  dueDate: z.string().nullable().optional(),
  accountId: z.string().uuid(),
  memo: z.string().nullable().optional(),
});

const updatePayloadSchema = payloadSchema.extend({
  status: z.enum(["open", "settled", "canceled"]).optional(),
});

const settlementPayloadSchema = z.object({
  date: z.string(),
  amount: positiveInt32Schema(),
  accountId: z.string().uuid().optional(),
  memo: z.string().nullable().optional(),
});

const listQuerySchema = z.object({
  status: z.enum(["all", "open", "settled", "canceled"]).default("all"),
});

export const personalDebtsRoutes = new Hono()
  .get("/", async (c) => {
    try {
      const { status } = listQuerySchema.parse({ status: c.req.query("status") });
      return c.json(await listPersonalDebts(prisma, status));
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .post("/", async (c) => {
    try {
      const body = payloadSchema.parse(await c.req.json());
      const debt = await createPersonalDebt(prisma, body);
      return c.json(debt, 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .get("/:id", async (c) => {
    const debt = await getPersonalDebt(prisma, c.req.param("id"));
    if (!debt) {
      return notFound(c, "Personal debt not found");
    }

    return c.json(debt);
  })
  .put("/:id", async (c) => {
    try {
      const body = updatePayloadSchema.parse(await c.req.json());
      const debt = await updatePersonalDebt(prisma, c.req.param("id"), body);
      if (!debt) {
        return notFound(c, "Personal debt not found");
      }

      return c.json(debt);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id", async (c) => {
    try {
      const debt = await cancelPersonalDebt(prisma, c.req.param("id"));
      if (!debt) {
        return notFound(c, "Personal debt not found");
      }

      return c.body(null, 204);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .post("/:id/settlements", async (c) => {
    try {
      const body = settlementPayloadSchema.parse(await c.req.json());
      const result = await settlePersonalDebt(prisma, c.req.param("id"), body);
      if (!result) {
        return notFound(c, "Personal debt not found");
      }

      return c.json(result.debt, 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .put("/:id/settlements/:settlementId", async (c) => {
    try {
      const body = settlementPayloadSchema.parse(await c.req.json());
      const debt = await updatePersonalDebtSettlement(
        prisma,
        c.req.param("id"),
        c.req.param("settlementId"),
        body,
      );
      if (!debt) {
        return notFound(c, "Settlement not found");
      }

      return c.json(debt);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id/settlements/:settlementId", async (c) => {
    try {
      const debt = await deletePersonalDebtSettlement(
        prisma,
        c.req.param("id"),
        c.req.param("settlementId"),
      );
      if (!debt) {
        return notFound(c, "Settlement not found");
      }

      return c.json(debt);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
