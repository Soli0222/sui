import { cors } from "hono/cors";
import { Hono } from "hono";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { accountsRoutes } from "./routes/accounts";
import { billingsRoutes } from "./routes/billings";
import { creditCardsRoutes } from "./routes/credit-cards";
import { dashboardRoutes } from "./routes/dashboard";
import { loansRoutes } from "./routes/loans";
import { recurringItemsRoutes } from "./routes/recurring-items";
import { transactionsRoutes } from "./routes/transactions";

interface CreateAppOptions {
  enableStaticFallback?: boolean;
  staticDir?: string;
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
}: CreateAppOptions = {}) {
  const app = new Hono();

  app.use("/api/*", cors());

  app.route("/api/dashboard", dashboardRoutes);
  app.route("/api/accounts", accountsRoutes);
  app.route("/api/recurring-items", recurringItemsRoutes);
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
