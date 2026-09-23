import { Hono } from "hono";
import { z } from "zod";
import type { AuditLogEntry, AuditLogStatusFilter } from "@sui/shared";
import { prisma } from "../lib/db";
import { handleRouteError } from "../lib/http";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(["all", "2xx", "4xx", "5xx"]).default("all"),
});

function statusWhere(status: AuditLogStatusFilter) {
  switch (status) {
    case "2xx": return { status: { gte: 200, lt: 300 } };
    case "4xx": return { status: { gte: 400, lt: 500 } };
    case "5xx": return { status: { gte: 500, lt: 600 } };
    default: return {};
  }
}

export const auditLogsRoutes = new Hono()
  .get("/", async (c) => {
    try {
      const { page, limit, status } = listQuerySchema.parse({
        page: c.req.query("page"),
        limit: c.req.query("limit"),
        status: c.req.query("status"),
      });
      const where = statusWhere(status);

      const [items, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.auditLog.count({ where }),
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
          issuer: item.issuer,
          oauthClientId: item.oauthClientId,
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
