import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../lib/db";
import { handleRouteError } from "../lib/http";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const auditLogsRoutes = new Hono()
  .get("/", async (c) => {
    try {
      const { page, limit } = listQuerySchema.parse({
        page: c.req.query("page"),
        limit: c.req.query("limit"),
      });

      const [items, total] = await Promise.all([
        prisma.auditLog.findMany({
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.auditLog.count(),
      ]);

      return c.json({
        items: items.map((item) => ({
          ...item,
          createdAt: item.createdAt.toISOString(),
        })),
        page,
        limit,
        total,
      });
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
