import "./otel";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { prisma } from "./lib/db";
import { startAuditLogCleanupScheduler } from "./services/audit-cleanup-scheduler";

import { expireSpendingApprovals } from "./services/spending";
import { logger } from "./lib/logger";

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
    const expire = () => { void expireSpendingApprovals().catch(err => logger.error({ err }, "Spending expiry failed")); };
    expire();
    setInterval(expire, 60000).unref();
  },
);
