import { Hono } from "hono";
import { z } from "zod";
import type { AuditLogEntry } from "@sui/shared";
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
          id: item.id,
          createdAt: item.createdAt.toISOString(),
          method: item.method,
          path: item.path,
          status: item.status,
          clientSource: (item.clientSource as AuditLogEntry["clientSource"]) ?? "unknown",
          requestId: item.requestId,
          authKind: (item.authKind as AuditLogEntry["authKind"]) ?? null,
          subject: item.subject,
          sessionId: item.sessionId,
          apiTokenId: item.apiTokenId,
          authMode: (item.authMode as AuditLogEntry["authMode"]) ?? null,
        })),
        page,
        limit,
        total,
      });
    } catch (error) {
      return handleRouteError(c, error);
    }
  });
