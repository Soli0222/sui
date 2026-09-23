import type { Context, MiddlewareHandler } from "hono";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/db";
import { logger } from "../lib/logger";

declare module "hono" {
  interface ContextVariableMap {
    auditRequestId: string;
  }
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CLIENT_SOURCES = new Set(["mcp", "web"]);

function requestIdFromHeader(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 40 && !Array.from(trimmed).some(isControlCharacter)
    ? trimmed
    : randomUUID();
}

function isControlCharacter(character: string) {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127;
}

function safePath(path: string) {
  return Array.from(path, (character) => isControlCharacter(character) ? "�" : character)
    .slice(0, 300).join("");
}

function shouldAudit(path: string, method: string, status: number) {
  if (path === "/mcp") return status >= 400 && status < 600;
  return path.startsWith("/api/") && (
    (status >= 400 && status < 600)
    || (status >= 200 && status < 300 && STATE_CHANGING_METHODS.has(method))
  );
}

async function writeAudit(c: Context, status: number, requestId: string) {
  if (!shouldAudit(c.req.path, c.req.method, status)) return;

  const auth = c.get("auth");
  const mcpAuth = c.get("mcpAuth");
  const mcpPrincipal = mcpAuth?.kind === "oauth" ? mcpAuth.principal : null;
  const path = safePath(c.req.path);
  try {
    await prisma.auditLog.create({
      data: {
        method: c.req.method.slice(0, 10),
        path,
        status,
        clientSource: c.req.path === "/mcp"
          ? "mcp"
          : CLIENT_SOURCES.has(c.req.header("x-sui-client") ?? "")
            ? c.req.header("x-sui-client")!
            : "unknown",
        requestId,
        authKind: auth?.kind ?? (mcpAuth?.kind === "apiToken" ? "token" : mcpAuth?.kind ?? null),
        subject: auth?.subject ?? mcpPrincipal?.subject ?? (mcpAuth?.kind === "disabled" ? "disabled" : null),
        issuer: auth?.kind === "oauth" ? auth.issuer ?? null : mcpPrincipal?.issuer ?? null,
        oauthClientId: auth?.kind === "oauth" ? auth.oauthClientId ?? null : mcpPrincipal?.clientId ?? null,
        sessionId: auth?.sessionId ?? null,
        apiTokenId: auth?.apiTokenId ?? (mcpAuth?.kind === "apiToken" ? mcpAuth.tokenId : null),
        authMode: auth?.authMode ?? (mcpAuth ? (mcpAuth.kind === "disabled" ? "disabled" : "enabled") : c.get("authMode") ?? null),
      },
    });
  } catch (error) {
    logger.error({ err: error, method: c.req.method, path, "request-id": requestId }, "Failed to write audit log");
  }
}

export function createAuditMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const requestId = requestIdFromHeader(c.req.header("x-request-id"));
    c.set("auditRequestId", requestId);
    c.header("x-request-id", requestId);
    let status = 500;
    try {
      await next();
      status = c.res.status;
    } finally {
      await writeAudit(c, status, requestId);
    }
  };
}
