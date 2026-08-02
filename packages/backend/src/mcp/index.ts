import { Hono } from "hono";
import type { Hono as HonoApp } from "hono";
import { randomUUID } from "node:crypto";
import { TransformStream } from "node:stream/web";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InProcessSuiApiClient } from "./client";
import { buildServer } from "./server";
import { verifyApiToken } from "../lib/auth";
import { logger } from "../lib/logger";

declare module "hono" {
  interface ContextVariableMap {
    mcpAuth: McpAuth;
  }
}

interface McpAuth {
  token: string | null;
  tokenHash: string | null;
  tokenId: string | null;
  readOnly: boolean;
}

interface McpSession {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  tokenHash: string;
  tokenId: string;
  readOnly: boolean;
  closed: boolean;
  lastActivityAt: number;
}

export interface CreateMcpRoutesOptions {
  authMode?: "enabled" | "disabled";
}

const MCP_SESSION_HEADER = "mcp-session-id";
const MCP_SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
const MCP_SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

const DISABLED_TOKEN_KEY = "__disabled__";

function parseIntEnv(value: string | undefined, defaultValue: number) {
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? defaultValue : Math.max(1, parsed);
}

function getMcpLimits() {
  return {
    maxSessions: parseIntEnv(process.env.SUI_MCP_MAX_SESSIONS, 1000),
    maxSessionsPerToken: parseIntEnv(process.env.SUI_MCP_MAX_SESSIONS_PER_TOKEN, 10),
    maxRequestsPerMinute: parseIntEnv(process.env.SUI_MCP_MAX_REQUESTS_PER_MINUTE, 120),
    maxConcurrentRequests: parseIntEnv(process.env.SUI_MCP_MAX_CONCURRENT_REQUESTS, 10),
  };
}

function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return authorization.slice(7).trim();
}

function getTokenKey(auth: McpAuth): string {
  return auth.tokenHash ?? DISABLED_TOKEN_KEY;
}

function closeMcpSession(session: McpSession) {
  if (session.closed) {
    return;
  }
  session.closed = true;
  session.server.close().catch((error) => {
    logger.error({ err: error }, "Failed to close MCP server during idle sweep");
  });
  session.transport.close().catch((error) => {
    logger.error({ err: error }, "Failed to close MCP transport during idle sweep");
  });
}

export function createMcpRoutes(parentApp: HonoApp, options: CreateMcpRoutesOptions = {}) {
  const app = new Hono();
  const sessions = new Map<string, McpSession>();
  const sessionsByToken = new Map<string, number>();
  const requestTimestamps = new Map<string, number[]>();
  const activeRequests = new Map<string, number>();
  const limits = getMcpLimits();

  function getTokenSessionCount(tokenKey: string): number {
    return sessionsByToken.get(tokenKey) ?? 0;
  }

  function incrementTokenSessionCount(tokenKey: string) {
    sessionsByToken.set(tokenKey, getTokenSessionCount(tokenKey) + 1);
  }

  function decrementTokenSessionCount(tokenKey: string) {
    const count = getTokenSessionCount(tokenKey) - 1;
    if (count <= 0) {
      sessionsByToken.delete(tokenKey);
    } else {
      sessionsByToken.set(tokenKey, count);
    }
  }

  function removeSession(sessionId: string) {
    const session = sessions.get(sessionId);
    if (session) {
      sessions.delete(sessionId);
      decrementTokenSessionCount(session.tokenHash);
      closeMcpSession(session);
    }
  }

  function checkRateLimit(tokenKey: string): { allowed: true } | { allowed: false; status: number; message: string } {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const timestamps = (requestTimestamps.get(tokenKey) ?? []).filter((t) => t > windowStart);
    if (timestamps.length >= limits.maxRequestsPerMinute) {
      return { allowed: false, status: 429, message: "Too many requests" };
    }
    timestamps.push(now);
    requestTimestamps.set(tokenKey, timestamps);
    return { allowed: true };
  }

  function trackConcurrentRequest(tokenKey: string): { allowed: true; release: () => void } | { allowed: false; status: number; message: string } {
    const active = (activeRequests.get(tokenKey) ?? 0) + 1;
    if (active > limits.maxConcurrentRequests) {
      return { allowed: false, status: 503, message: "Too many concurrent connections" };
    }
    activeRequests.set(tokenKey, active);
    return {
      allowed: true,
      release: () => {
        const next = (activeRequests.get(tokenKey) ?? 1) - 1;
        if (next <= 0) {
          activeRequests.delete(tokenKey);
        } else {
          activeRequests.set(tokenKey, next);
        }
      },
    };
  }

  let pendingSessions = 0;
  const pendingSessionsByToken = new Map<string, number>();

  function getPendingSessionCount(tokenKey: string): number {
    return pendingSessionsByToken.get(tokenKey) ?? 0;
  }

  function incrementPendingSessionCount(tokenKey: string) {
    pendingSessions += 1;
    pendingSessionsByToken.set(tokenKey, getPendingSessionCount(tokenKey) + 1);
  }

  function decrementPendingSessionCount(tokenKey: string) {
    pendingSessions -= 1;
    const count = getPendingSessionCount(tokenKey) - 1;
    if (count <= 0) {
      pendingSessionsByToken.delete(tokenKey);
    } else {
      pendingSessionsByToken.set(tokenKey, count);
    }
  }

  function reserveSessionSlot(tokenKey: string): { ok: true; release: () => void } | { ok: false; status: number; message: string } {
    if (sessions.size + pendingSessions >= limits.maxSessions) {
      return { ok: false, status: 503, message: "MCP session limit reached" };
    }
    if (getTokenSessionCount(tokenKey) + getPendingSessionCount(tokenKey) >= limits.maxSessionsPerToken) {
      return { ok: false, status: 429, message: "MCP session limit reached for this token" };
    }
    incrementPendingSessionCount(tokenKey);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        decrementPendingSessionCount(tokenKey);
      },
    };
  }

  async function handleRequestWithRelease(
    transport: WebStandardStreamableHTTPServerTransport,
    request: Request,
    release: () => void,
  ): Promise<Response> {
    const response = await transport.handleRequest(request);
    if (!response.body) {
      release();
      return response;
    }

    let released = false;
    const safeRelease = () => {
      if (released) return;
      released = true;
      release();
    };

    const { readable, writable } = new TransformStream();
    response.body
      .pipeTo(writable)
      .catch((error) => {
        logger.error({ err: error }, "MCP stream pipe error");
      })
      .finally(safeRelease);

    return new Response(readable as unknown as ReadableStream<Uint8Array>, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  app.use("/*", async (c, next) => {
    const authMode = options.authMode ?? process.env.SUI_AUTH_MODE ?? "enabled";
    if (authMode === "disabled") {
      c.set("mcpAuth", { token: null, tokenHash: null, tokenId: null, readOnly: false });
      return next();
    }

    const token = extractBearerToken(c.req.header("Authorization"));
    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const record = await verifyApiToken(token);
    if (!record) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("mcpAuth", { token, tokenHash: record.tokenHash, tokenId: record.id, readOnly: record.readOnly });
    return next();
  });

  app.all("/*", async (c) => {
    const auth = c.get("mcpAuth");
    const tokenKey = getTokenKey(auth);
    const sessionIdHeader = c.req.header(MCP_SESSION_HEADER);

    const rate = checkRateLimit(tokenKey);
    if (!rate.allowed) {
      return c.json({ error: rate.message }, 429);
    }

    const concurrent = trackConcurrentRequest(tokenKey);
    if (!concurrent.allowed) {
      return c.json({ error: concurrent.message }, 503);
    }

    let released = false;
    const safeRelease = () => {
      if (released) return;
      released = true;
      concurrent.release();
    };

    try {
      if (sessionIdHeader) {
        const session = sessions.get(sessionIdHeader);
        if (!session || session.tokenHash !== tokenKey) {
          safeRelease();
          return c.json({ error: "Session not found" }, 404);
        }
        session.lastActivityAt = Date.now();
        return await handleRequestWithRelease(session.transport, c.req.raw, safeRelease);
      }

      const reservation = reserveSessionSlot(tokenKey);
      if (!reservation.ok) {
        safeRelease();
        return reservation.status === 429
          ? c.json({ error: reservation.message }, 429)
          : c.json({ error: reservation.message }, 503);
      }

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: async (sessionId) => {
          try {
            const apiClient = new InProcessSuiApiClient(parentApp, auth?.token ?? undefined);
            const server = buildServer({ apiClient });
            const session: McpSession = {
              transport,
              server,
              tokenHash: tokenKey,
              tokenId: auth?.tokenId ?? DISABLED_TOKEN_KEY,
              readOnly: auth?.readOnly ?? false,
              closed: false,
              lastActivityAt: Date.now(),
            };
            sessions.set(sessionId, session);
            incrementTokenSessionCount(tokenKey);
            reservation.release();

            try {
              await server.connect(transport);
            } catch (error) {
              logger.error({ err: error }, "Failed to connect MCP server");
              removeSession(sessionId);
            }
          } catch (error) {
            logger.error({ err: error }, "MCP session initialization failed");
            reservation.release();
          }
        },
        onsessionclosed: (sessionId) => {
          removeSession(sessionId);
        },
      });

      transport.onclose = () => {
        const found = Array.from(sessions.entries()).find(([, s]) => s.transport === transport);
        if (found) {
          removeSession(found[0]);
        }
      };

      transport.onerror = (error) => {
        logger.error({ err: error }, "MCP transport error");
      };

      const response = await handleRequestWithRelease(transport, c.req.raw, safeRelease);
      reservation.release();
      return response;
    } catch (error) {
      logger.error({ err: error }, "MCP request failed");
      safeRelease();
      return c.json({ error: "MCP request failed" }, 500);
    }
  });

  const sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivityAt > MCP_SESSION_IDLE_TTL_MS) {
        removeSession(id);
      }
    }
  }, MCP_SESSION_SWEEP_INTERVAL_MS);
  sweepInterval.unref();

  return app;
}
