import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/db";
import { handleRouteError, notFound } from "../lib/http";
import { positiveInt32Schema } from "../lib/validation";
import {
  cancelSplitBill,
  createSplitBill,
  getSplitBill,
  listSplitBills,
  previewEqualSplit,
  updateSplitBill,
} from "../services/personal-debts";

const participantSchema = z.object({
  name: z.string().min(1).max(100),
  isSelf: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const payloadSchema = z.object({
  title: z.string().min(1).max(100),
  totalAmount: positiveInt32Schema(),
  paidDate: z.string(),
  payerType: z.enum(["self", "other"]),
  payerName: z.string().nullable().optional(),
  accountId: z.string().uuid(),
  splitMethod: z.enum(["equal"]).default("equal"),
  dueDate: z.string().nullable().optional(),
  memo: z.string().nullable().optional(),
  participants: z.array(participantSchema).min(2),
});

const updatePayloadSchema = payloadSchema.extend({
  status: z.enum(["open", "settled", "canceled"]).optional(),
});

const previewPayloadSchema = z.object({
  totalAmount: positiveInt32Schema(),
  splitMethod: z.enum(["equal"]).default("equal"),
  participants: z.array(participantSchema).min(2),
});

const listQuerySchema = z.object({
  status: z.enum(["all", "open", "settled", "canceled"]).default("all"),
});

export const splitBillsRoutes = new Hono()
  .get("/", async (c) => {
    try {
      const { status } = listQuerySchema.parse({ status: c.req.query("status") });
      return c.json(await listSplitBills(prisma, status));
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .post("/preview", async (c) => {
    try {
      const body = previewPayloadSchema.parse(await c.req.json());
      return c.json({ participants: previewEqualSplit(body.totalAmount, body.participants) });
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .post("/", async (c) => {
    try {
      const body = payloadSchema.parse(await c.req.json());
      const splitBill = await createSplitBill(prisma, body);
      return c.json(splitBill, 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .get("/:id", async (c) => {
    const splitBill = await getSplitBill(prisma, c.req.param("id"));
    if (!splitBill) {
      return notFound(c, "Split bill not found");
    }

    return c.json(splitBill);
  })
  .put("/:id", async (c) => {
    try {
      const body = updatePayloadSchema.parse(await c.req.json());
      const splitBill = await updateSplitBill(prisma, c.req.param("id"), body);
      if (!splitBill) {
        return notFound(c, "Split bill not found");
      }

      return c.json(splitBill);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id", async (c) => {
    try {
      const splitBill = await cancelSplitBill(prisma, c.req.param("id"));
      if (!splitBill) {
        return notFound(c, "Split bill not found");
      }

      return c.body(null, 204);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
