import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/db";
import { handleRouteError, notFound } from "../lib/http";
import { int32Schema, nonNegativeInt32Schema } from "../lib/validation";

const payloadSchema = z.object({
  name: z.string().min(1).max(100),
  settlementDay: z.number().int().min(1).max(31).nullable().optional(),
  accountId: z.string().uuid(),
  assumptionAmount: nonNegativeInt32Schema(),
  sortOrder: int32Schema(),
});

export const creditCardsRoutes = new Hono()
  .get("/", async (c) => {
    const cards = await prisma.creditCard.findMany({
      where: { deletedAt: null },
      include: { account: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return c.json(cards);
  })
  .post("/", async (c) => {
    try {
      const body = payloadSchema.parse(await c.req.json());
      const card = await prisma.creditCard.create({ data: body });
      return c.json(card, 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .put("/:id", async (c) => {
    try {
      const body = payloadSchema.parse(await c.req.json());
      const existing = await prisma.creditCard.findFirst({
        where: { id: c.req.param("id"), deletedAt: null },
      });
      if (!existing) {
        return notFound(c, "Credit card not found");
      }

      const card = await prisma.creditCard.update({
        where: { id: existing.id },
        data: body,
      });
      return c.json(card);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id", async (c) => {
    const existing = await prisma.creditCard.findFirst({
      where: { id: c.req.param("id"), deletedAt: null },
    });
    if (!existing) {
      return notFound(c, "Credit card not found");
    }

    await prisma.creditCard.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    return c.body(null, 204);
  });
