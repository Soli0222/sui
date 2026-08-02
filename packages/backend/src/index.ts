import "./otel";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { prisma } from "./lib/db";
import { startAuditLogCleanupScheduler } from "./services/audit-cleanup-scheduler";

const app = createApp();
const port = Number(process.env.PORT ?? "3000");

serve(
  {
    fetch: app.fetch,
    port,
  },
  (info) => {
    console.log(`sui backend listening on http://localhost:${info.port}`);
    startAuditLogCleanupScheduler(prisma);
  },
);
