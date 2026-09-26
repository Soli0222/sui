import type { Context, MiddlewareHandler } from "hono";
import { randomUUID } from "node:crypto";
import { auditLogger, type AuditLogger } from "../lib/logger";

declare module "hono" {
  interface ContextVariableMap {
    auditRequestId: string;
    auditTraceContext?: Partial<{ trace_id: string; span_id: string; trace_flags: string }>;
  }
}

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CLIENT_SOURCES = new Set(["mcp", "web"]);

function isControlCharacter(character: string) {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127;
}

function requestIdFromHeader(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 40 && !Array.from(trimmed).some(isControlCharacter)
    ? trimmed
    : randomUUID();
}

export function safeAuditPath(path: string) {
  return Array.from(path, (character) => isControlCharacter(character) ? "�" : character)
    .slice(0, 300).join("");
}

export function shouldAudit(path: string, method: string, status: number) {
  if (path === "/mcp") return status >= 400 && status < 600;
  return path.startsWith("/api/") && (
    (status >= 400 && status < 600)
    || (status >= 200 && status < 300 && STATE_CHANGING_METHODS.has(method))
  );
}

function writeAudit(c: Context, status: number, requestId: string, sink: AuditLogger) {
  if (!shouldAudit(c.req.path, c.req.method, status)) return;

  const auth = c.get("auth");
  const mcpAuth = c.get("mcpAuth");
  const mcpPrincipal = mcpAuth?.kind === "oauth" ? mcpAuth.principal : null;
  const fields = {
    event: "audit" as const,
    schemaVersion: 1,
    method: c.req.method.slice(0, 10),
    path: safeAuditPath(c.req.path),
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
    ...c.get("auditTraceContext"),
  };
  try {
    if (status >= 500) sink.error(fields, "Audit event");
    else if (status >= 400) sink.warn(fields, "Audit event");
    else sink.info(fields, "Audit event");
  } catch {
    // Logging must not change the HTTP response or recursively log its own failure.
  }
}

export function createAuditMiddleware(sink: AuditLogger = auditLogger): MiddlewareHandler {
  return async (c, next) => {
    const requestId = requestIdFromHeader(c.req.header("x-request-id"));
    c.set("auditRequestId", requestId);
    c.header("x-request-id", requestId);
    let status = 500;
    try {
      await next();
      status = c.res.status;
    } finally {
      writeAudit(c, status, requestId, sink);
    }
  };
}
