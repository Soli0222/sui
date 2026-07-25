import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { verifyApiToken, verifyAuthSession, SESSION_COOKIE_NAME, type AuthInfo } from "../lib/auth";

export interface AuthMiddlewareOptions {
  authMode?: "enabled" | "disabled";
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isStateChanging(method: string) {
  return STATE_CHANGING_METHODS.has(method);
}

function isPublicAuthPath(method: string, path: string) {
  return method === "GET" && (path === "/api/auth/status" || path === "/api/auth/login" || path === "/api/auth/callback");
}

async function verifyBearerAuth(c: Context): Promise<AuthInfo | null> {
  const authorization = c.req.header("Authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  const token = authorization.slice(7).trim();
  const record = await verifyApiToken(token);
  if (!record) {
    return null;
  }

  return { kind: "token", readOnly: record.readOnly };
}

async function verifySessionAuth(c: Context): Promise<AuthInfo | null> {
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) {
    return null;
  }

  const session = await verifyAuthSession(token);
  if (!session) {
    return null;
  }

  return { kind: "session", readOnly: false };
}

export function createAuthMiddleware(options: AuthMiddlewareOptions = {}): MiddlewareHandler {
  const authMode = options.authMode ?? (process.env.SUI_AUTH_MODE === "disabled" ? "disabled" : "enabled");

  return async (c, next) => {
    c.set("authMode", authMode);

    if (authMode === "disabled") {
      c.set("auth", { kind: "session", readOnly: false });
      return next();
    }

    if (isPublicAuthPath(c.req.method, c.req.path)) {
      c.set("auth", { kind: "session", readOnly: false });
      return next();
    }

    const auth = (await verifyBearerAuth(c)) ?? (await verifySessionAuth(c));

    if (!auth) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    if (auth.readOnly && isStateChanging(c.req.method)) {
      return c.json({ error: "Read-only token" }, 403);
    }

    c.set("auth", auth);
    return next();
  };
}

export function getAuth(c: Context): AuthInfo | undefined {
  return c.get("auth");
}
