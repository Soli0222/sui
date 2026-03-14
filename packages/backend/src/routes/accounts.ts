import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/db";
import { handleRouteError, notFound } from "../lib/http";
import { int32Schema } from "../lib/validation";

const payloadSchema = z.object({
  name: z.string().min(1).max(100),
  balance: int32Schema(),
  sortOrder: int32Schema(),
});

export const accountsRoutes = new Hono()
  .get("/", async (c) => {
    const accounts = await prisma.account.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return c.json(accounts);
  })
  .post("/", async (c) => {
    try {
      const body = payloadSchema.parse(await c.req.json());
      const account = await prisma.account.create({ data: body });
      return c.json(account, 201);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .put("/:id", async (c) => {
    try {
      const body = payloadSchema.parse(await c.req.json());
      const existing = await prisma.account.findFirst({
        where: { id: c.req.param("id"), deletedAt: null },
      });
      if (!existing) {
        return notFound(c, "Account not found");
      }

      const account = await prisma.account.update({
        where: { id: existing.id },
        data: body,
      });
      return c.json(account);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .delete("/:id", async (c) => {
    const existing = await prisma.account.findFirst({
      where: { id: c.req.param("id"), deletedAt: null },
    });
    if (!existing) {
      return notFound(c, "Account not found");
    }

    await prisma.account.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });

    return c.body(null, 204);
  });
