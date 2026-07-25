import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { SuiApiClient } from "./api-client";
import type { CliOptions } from "./cli";
import { buildServer } from "./server";

interface ListenAddress {
  host?: string;
  port: number;
}

interface ServerSession {
  close: () => Promise<void>;
}

function joinPath(basePath: string, path: string) {
  return `${basePath}${path}` || "/";
}

function parseListenAddress(address: string): ListenAddress {
  const separator = address.lastIndexOf(":");
  if (separator === -1) {
    const port = Number(address);
    if (!Number.isInteger(port) || port < 0) {
      throw new Error(`Invalid address: ${address}`);
    }
    return { port };
  }

  const host = address.slice(0, separator);
  const port = Number(address.slice(separator + 1));
  if (!Number.isInteger(port) || port < 0) {
    throw new Error(`Invalid address: ${address}`);
  }

  return { host: host || undefined, port };
}

function sendText(res: ServerResponse, status: number, text: string) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function requestPath(req: IncomingMessage) {
  const host = req.headers.host ?? "localhost";
  return new URL(req.url ?? "/", `http://${host}`).pathname;
}

export async function startHttpServer(options: CliOptions, apiClient: SuiApiClient) {
  const healthPath = joinPath(options.basePath, "/healthz");
  const ssePath = joinPath(options.basePath, "/sse");
  const messagePath = joinPath(options.basePath, "/message");
  const streamablePath = joinPath(options.basePath, options.endpointPath);
  const sseSessions = new Map<string, ServerSession & { transport: SSEServerTransport }>();
  const streamableSessions = new Map<string, ServerSession & { transport: StreamableHTTPServerTransport }>();

  const server = createServer(async (req, res) => {
    const path = requestPath(req);

    try {
      if (req.method === "GET" && path === healthPath) {
        sendText(res, 200, "ok\n");
        return;
      }

      if (options.transport === "sse") {
        if (req.method === "GET" && path === ssePath) {
          const transport = new SSEServerTransport(messagePath, res);
          const mcpServer = buildServer({ apiClient });
          sseSessions.set(transport.sessionId, {
            transport,
            close: () => mcpServer.close(),
          });
          transport.onclose = () => {
            sseSessions.delete(transport.sessionId);
          };
          await mcpServer.connect(transport);
          return;
        }

        if (req.method === "POST" && path === messagePath) {
          const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
          const sessionId = url.searchParams.get("sessionId");
          const session = sessionId ? sseSessions.get(sessionId) : undefined;
          if (!session) {
            sendText(res, 404, "SSE session not found\n");
            return;
          }
          await session.transport.handlePostMessage(req, res);
          return;
        }
      }

      if (options.transport === "streamable-http" && path === streamablePath) {
        const sessionId = req.headers["mcp-session-id"];
        const normalizedSessionId = Array.isArray(sessionId) ? sessionId[0] : sessionId;
        let session = normalizedSessionId ? streamableSessions.get(normalizedSessionId) : undefined;

        if (normalizedSessionId && !session) {
          sendText(res, 404, "MCP session not found\n");
          return;
        }

        if (!session) {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: randomUUID,
            onsessioninitialized: (initializedSessionId) => {
              streamableSessions.set(initializedSessionId, {
                transport,
                close: () => mcpServer.close(),
              });
            },
            onsessionclosed: (closedSessionId) => {
              streamableSessions.delete(closedSessionId);
            },
          });
          const mcpServer = buildServer({ apiClient });
          transport.onclose = () => {
            if (transport.sessionId) {
              streamableSessions.delete(transport.sessionId);
            }
          };
          await mcpServer.connect(transport);
          session = {
            transport,
            close: () => mcpServer.close(),
          };
        }

        await session.transport.handleRequest(req, res);
        return;
      }

      sendText(res, 404, "not found\n");
    } catch (error) {
      console.error(error);
      if (!res.headersSent) {
        sendText(res, 500, "internal server error\n");
      } else {
        res.end();
      }
    }
  });

  server.on("close", () => {
    for (const session of [...sseSessions.values(), ...streamableSessions.values()]) {
      void session.close();
    }
    sseSessions.clear();
    streamableSessions.clear();
  });

  const address = parseListenAddress(options.address);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(address.port, address.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const actualAddress = server.address();
  const displayAddress =
    typeof actualAddress === "object" && actualAddress
      ? `${actualAddress.address === "::" ? "0.0.0.0" : actualAddress.address}:${actualAddress.port}`
      : options.address;
  console.error(`sui-mcp ${options.transport} listening on ${displayAddress}`);

  return server;
}
