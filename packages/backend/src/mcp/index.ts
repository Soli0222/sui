import { Hono } from "hono";
import type { Hono as HonoApp } from "hono";
import { randomUUID } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InProcessSuiApiClient } from "./client";
import { buildServer } from "./server";
import { verifyApiToken } from "../lib/auth";
import { logger } from "../lib/logger";

declare module "hono" {
  interface ContextVariableMap {
    mcpAuth: { token: string | null; readOnly: boolean };
  }
}

interface McpSession {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  token: string;
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

function extractBearerToken(authorization: string | undefined): string | null {
  if (!authorization?.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  return authorization.slice(7).trim();
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

  app.use("/*", async (c, next) => {
    const authMode = options.authMode ?? process.env.SUI_AUTH_MODE ?? "enabled";
    if (authMode === "disabled") {
      c.set("mcpAuth", { token: null, readOnly: false });
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

    c.set("mcpAuth", { token, readOnly: record.readOnly });
    return next();
  });

  app.all("/*", async (c) => {
    const auth = c.get("mcpAuth");
    const sessionIdHeader = c.req.header(MCP_SESSION_HEADER);
    const expectedToken = auth.token ?? "";

    if (sessionIdHeader) {
      const session = sessions.get(sessionIdHeader);
      if (!session || session.token !== expectedToken) {
        return c.json({ error: "Session not found" }, 404);
      }
      session.lastActivityAt = Date.now();
      return session.transport.handleRequest(c.req.raw);
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID,
      onsessioninitialized: async (sessionId) => {
        const apiClient = new InProcessSuiApiClient(parentApp, auth?.token ?? undefined);
        const server = buildServer({ apiClient });
        const session: McpSession = {
          transport,
          server,
          token: auth?.token ?? "",
          readOnly: auth?.readOnly ?? false,
          closed: false,
          lastActivityAt: Date.now(),
        };
        sessions.set(sessionId, session);

        try {
          await server.connect(transport);
        } catch (error) {
          logger.error({ err: error }, "Failed to connect MCP server");
          sessions.delete(sessionId);
        }
      },
      onsessionclosed: (sessionId) => {
        const session = sessions.get(sessionId);
        sessions.delete(sessionId);
        if (session) {
          closeMcpSession(session);
        }
      },
    });

    transport.onclose = () => {
      const session = Array.from(sessions.entries()).find(([, s]) => s.transport === transport);
      if (session) {
        const [sessionId, s] = session;
        sessions.delete(sessionId);
        closeMcpSession(s);
      }
    };

    transport.onerror = (error) => {
      logger.error({ err: error }, "MCP transport error");
    };

    return transport.handleRequest(c.req.raw);
  });

  const sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (now - session.lastActivityAt > MCP_SESSION_IDLE_TTL_MS) {
        sessions.delete(id);
        closeMcpSession(session);
      }
    }
  }, MCP_SESSION_SWEEP_INTERVAL_MS);
  sweepInterval.unref();

  return app;
}
