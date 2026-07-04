import { cors } from "hono/cors";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { logger } from "./lib/logger";
import { accountsRoutes } from "./routes/accounts";
import { billingsRoutes } from "./routes/billings";
import { creditCardsRoutes } from "./routes/credit-cards";
import { dataTransferRoutes } from "./routes/data-transfer";
import { dashboardRoutes } from "./routes/dashboard";
import { loansRoutes } from "./routes/loans";
import { recurringItemsRoutes } from "./routes/recurring-items";
import { subscriptionsRoutes } from "./routes/subscriptions";
import { transactionsRoutes } from "./routes/transactions";
import { prisma } from "./lib/db";
import { refreshExchangeRatesToJpy } from "./services/exchange-rates";

export interface CreateAppOptions {
  enableStaticFallback?: boolean;
  staticDir?: string;
  allowedOrigins?: string[];
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function parseAllowedOrigins(value: string | undefined) {
  return value
    ?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0) ?? [];
}

function normalizeHost(host: string | undefined) {
  return host?.toLowerCase();
}

function getOriginHost(origin: string) {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

function isOriginAllowed(
  origin: string,
  requestHost: string | undefined,
  allowedOrigins: Set<string>,
) {
  if (origin === "null") {
    return false;
  }
  if (allowedOrigins.has(origin)) {
    return true;
  }

  const originHost = getOriginHost(origin);
  return originHost !== null && originHost === normalizeHost(requestHost);
}

function getContentType(filePath: string) {
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (filePath.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  return "application/octet-stream";
}

export function createApp({
  enableStaticFallback = true,
  staticDir = process.env.STATIC_DIR ?? path.resolve(process.cwd(), "../frontend/dist"),
  allowedOrigins = parseAllowedOrigins(process.env.SUI_ALLOWED_ORIGINS),
}: CreateAppOptions = {}) {
  const app = new Hono();
  const normalizedAllowedOrigins = allowedOrigins
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  const allowedOriginSet = new Set(normalizedAllowedOrigins);

  if (normalizedAllowedOrigins.length > 0) {
    app.use("/api/*", cors({ origin: normalizedAllowedOrigins }));
  }
  app.use("/api/*", async (c, next) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    let status = 500;

    c.header("x-request-id", requestId);

    try {
      await next();
      status = c.res.status;
    } finally {
      logger.info(
        {
          method: c.req.method,
          path: c.req.path,
          status,
          duration_ms: Math.round(performance.now() - startedAt),
          "request-id": requestId,
        },
        "Request completed",
      );
    }
  });
  app.use("/api/*", async (c, next) => {
    if (!STATE_CHANGING_METHODS.has(c.req.method)) {
      await next();
      return;
    }

    const origin = c.req.header("Origin");
    if (!origin || isOriginAllowed(origin, c.req.header("Host"), allowedOriginSet)) {
      await next();
      return;
    }

    return c.json({ error: "Origin not allowed" }, 403);
  });
  app.use("/api/*", async (c, next) => {
    if (c.req.method === "GET" && c.req.path !== "/api/export") {
      try {
        await refreshExchangeRatesToJpy(prisma);
      } catch (error) {
        logger.warn(
          {
            err: error,
            method: c.req.method,
            path: c.req.path,
            "request-id": c.res.headers.get("x-request-id") ?? undefined,
          },
          "Failed to refresh exchange rates",
        );
      }
    }

    await next();
  });

  app.route("/api", dataTransferRoutes);
  app.route("/api/dashboard", dashboardRoutes);
  app.route("/api/accounts", accountsRoutes);
  app.route("/api/recurring-items", recurringItemsRoutes);
  app.route("/api/subscriptions", subscriptionsRoutes);
  app.route("/api/credit-cards", creditCardsRoutes);
  app.route("/api/billings", billingsRoutes);
  app.route("/api/loans", loansRoutes);
  app.route("/api/transactions", transactionsRoutes);

  if (!enableStaticFallback) {
    return app;
  }

  if (existsSync(staticDir)) {
    app.get("*", async (c) => {
      const requestPath = c.req.path === "/" ? "/index.html" : c.req.path;
      const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
      const filePath = path.join(staticDir, safePath);

      if (existsSync(filePath) && statSync(filePath).isFile()) {
        c.header("Content-Type", getContentType(filePath));
        return c.body(readFileSync(filePath));
      }

      return c.html(readFileSync(path.join(staticDir, "index.html"), "utf8"));
    });
  } else {
    app.get("/", (c) => c.text("sui backend is running"));
  }

  return app;
}
