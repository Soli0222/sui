import { Hono } from "hono";
import { z } from "zod";
import type { SettlementKind } from "@sui/shared";
import { prisma } from "../lib/db";
import { handleRouteError } from "../lib/http";
import { createSettlement, deleteSettlement, listSettlements } from "../services/settlements";

const payloadSchema = z.object({
  kind: z.enum(["transaction", "offset"]),
  personId: z.string().uuid(),
  transactionId: z.string().uuid().nullish(),
  date: z.string().optional(),
  note: z.string().max(200).nullish(),
  allocations: z
    .array(
      z.object({
        shareId: z.string().uuid(),
        amount: z.number().int().positive(),
      }),
    )
    .min(1),
});

const listQuerySchema = z.object({
  personId: z.string().uuid().optional(),
  transactionId: z.string().uuid().optional(),
});

export const settlementsRoutes = new Hono()
  .get("/", async (c) => {
    try {
      const query = listQuerySchema.parse({
        personId: c.req.query("personId"),
        transactionId: c.req.query("transactionId"),
      });
      const settlements = await listSettlements(prisma, query);
      return c.json(settlements);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .post("/", async (c) => {
    try {
      const body = payloadSchema.parse(await c.req.json());
      const settlement = await createSettlement(prisma, {
        kind: body.kind as SettlementKind,
        personId: body.personId,
        transactionId: body.transactionId ?? null,
        date: body.date,
        note: body.note ?? null,
        allocations: body.allocations,
      });
      return c.json(settlement, 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id", async (c) => {
    try {
      await deleteSettlement(prisma, c.req.param("id"));
      return c.body(null, 204);
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
