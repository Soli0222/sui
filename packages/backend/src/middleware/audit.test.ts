import { describe, expect, it, vi } from "vitest";
import { createAuditLogger } from "../lib/logger";
import { shouldAudit, safeAuditPath, createAuditMiddleware } from "./audit";
import { Hono } from "hono";

describe("audit contract", () => {
  it("selects only the established HTTP method and status combinations", () => {
    expect(shouldAudit("/api/accounts", "POST", 201)).toBe(true);
    expect(shouldAudit("/api/accounts", "GET", 200)).toBe(false);
    expect(shouldAudit("/api/accounts", "POST", 302)).toBe(false);
    expect(shouldAudit("/api/accounts", "GET", 404)).toBe(true);
    expect(shouldAudit("/api/accounts", "GET", 500)).toBe(true);
    expect(shouldAudit("/mcp", "POST", 200)).toBe(false);
    expect(shouldAudit("/mcp", "POST", 403)).toBe(true);
  });

  it("replaces control characters and bounds paths", () => {
    expect(safeAuditPath(`/api/a\n\u007f${"x".repeat(400)}`)).toBe(`/api/a��${"x".repeat(292)}`);
  });

  it("writes one JSON line with pino time, levels and null fields even when normal logs are silent", async () => {
    vi.setSystemTime(new Date("2026-06-15T03:00:00.000Z"));
    vi.stubEnv("SUI_LOG_LEVEL", "silent");
    const lines: string[] = [];
    const destination = { write: (line: string) => { lines.push(line); return true; } };
    const logger = createAuditLogger(destination);
    const app = new Hono();
    app.use("/api/*", createAuditMiddleware(logger));
    app.post("/api/test", (c) => c.json({ ok: true }, 201));
    app.get("/api/test", (c) => c.json({ error: "bad" }, 400));
    try {
      expect((await app.request("/api/test", { method: "POST" })).status).toBe(201);
      expect((await app.request("/api/test")).status).toBe(400);
      expect(lines).toHaveLength(2);
      const first = JSON.parse(lines[0]);
      const second = JSON.parse(lines[1]);
      expect(first).toMatchObject({
        event: "audit", schemaVersion: 1, level: 30, time: Date.parse("2026-06-15T03:00:00.000Z"),
        msg: "Audit event", method: "POST", status: 201, authKind: null, authMode: null,
        subject: null, issuer: null, oauthClientId: null, sessionId: null, apiTokenId: null,
      });
      expect(typeof first.status).toBe("number");
      expect(first).not.toHaveProperty("trace_id");
      expect(second).toMatchObject({ level: 40, status: 400 });
      expect(lines.every((line) => line.endsWith("\n") && line.indexOf("\n") === line.length - 1)).toBe(true);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
});
