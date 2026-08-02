import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AUDIT_LOG_RETENTION_DAYS,
  MAX_AUDIT_LOG_RETENTION_DAYS,
  deleteOldAuditLogs,
  getAuditLogRetentionDays,
  runAuditLogCleanup,
  type AuditLogCleanupLogger,
  type AuditLogCleanupPrisma,
} from "./audit-cleanup";

function createFakeLogger(): AuditLogCleanupLogger & {
  infoLogs: Array<Record<string, unknown>>;
  warnLogs: Array<Record<string, unknown>>;
  errorLogs: Array<Record<string, unknown>>;
} {
  return {
    infoLogs: [],
    warnLogs: [],
    errorLogs: [],
    info(obj, _msg) {
      void _msg;
      this.infoLogs.push({ ...obj });
    },
    warn(obj, _msg) {
      void _msg;
      this.warnLogs.push({ ...obj });
    },
    error(obj, _msg) {
      void _msg;
      this.errorLogs.push({ ...obj });
    },
  };
}

function createFakePrisma(
  rows: Array<{ id: string; createdAt: Date }>,
): AuditLogCleanupPrisma & { rows: typeof rows } {
  return {
    rows,
    auditLog: {
      findMany: vi.fn(async (args) => {
        const cutoff = args.where?.createdAt?.lt;
        const matching = rows
          .filter((row) => (cutoff ? row.createdAt < cutoff : true))
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, args.take)
          .map((row) => ({ id: row.id }));
        return matching;
      }),
      deleteMany: vi.fn(async (args) => {
        const ids = new Set<string>(args.where.id.in);
        let count = 0;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (ids.has(rows[i]!.id)) {
            rows.splice(i, 1);
            count++;
          }
        }
        return { count };
      }),
    },
  };
}

const fixedNow = new Date("2026-08-02T00:00:00.000Z").getTime();

describe("getAuditLogRetentionDays", () => {
  it("returns the default 365 days when the env value is not set", () => {
    const logger = createFakeLogger();
    expect(getAuditLogRetentionDays(undefined, logger)).toBe(365);
    expect(logger.warnLogs).toHaveLength(0);
  });

  it("returns 365 by default and warns for non-integer or negative values", () => {
    const logger = createFakeLogger();
    for (const value of ["abc", "-1", "1.5", "   ", "001"]) {
      expect(getAuditLogRetentionDays(value, logger)).toBe(DEFAULT_AUDIT_LOG_RETENTION_DAYS);
    }
    expect(logger.warnLogs.length).toBe(5);
    expect(logger.warnLogs[0]).toMatchObject({
      SUI_AUDIT_LOG_RETENTION_DAYS: "abc",
      default: DEFAULT_AUDIT_LOG_RETENTION_DAYS,
    });
  });

  it("treats 0 as disabled retention", () => {
    const logger = createFakeLogger();
    expect(getAuditLogRetentionDays("0", logger)).toBe(0);
    expect(getAuditLogRetentionDays("  0  ", logger)).toBe(0);
    expect(logger.warnLogs).toHaveLength(0);
  });

  it("parses positive integers", () => {
    const logger = createFakeLogger();
    expect(getAuditLogRetentionDays("30", logger)).toBe(30);
    expect(getAuditLogRetentionDays("365", logger)).toBe(365);
    expect(getAuditLogRetentionDays(String(MAX_AUDIT_LOG_RETENTION_DAYS), logger)).toBe(
      MAX_AUDIT_LOG_RETENTION_DAYS,
    );
    expect(logger.warnLogs).toHaveLength(0);
  });

  it("falls back to 365 for an extremely long digit string that overflows", () => {
    const logger = createFakeLogger();
    const huge = "9".repeat(400);
    expect(getAuditLogRetentionDays(huge, logger)).toBe(DEFAULT_AUDIT_LOG_RETENTION_DAYS);
    expect(logger.warnLogs).toHaveLength(1);
    expect(logger.warnLogs[0]).toMatchObject({
      SUI_AUDIT_LOG_RETENTION_DAYS: huge,
      default: DEFAULT_AUDIT_LOG_RETENTION_DAYS,
    });
  });

  it("falls back to 365 for Number.MAX_SAFE_INTEGER and values beyond the Date range", () => {
    const logger = createFakeLogger();
    for (const value of [
      String(Number.MAX_SAFE_INTEGER),
      String(MAX_AUDIT_LOG_RETENTION_DAYS + 1),
      String(MAX_AUDIT_LOG_RETENTION_DAYS * 10),
    ]) {
      expect(getAuditLogRetentionDays(value, logger)).toBe(DEFAULT_AUDIT_LOG_RETENTION_DAYS);
    }
    expect(logger.warnLogs).toHaveLength(3);
  });
});

describe("deleteOldAuditLogs", () => {
  it("deletes only rows older than the retention cutoff", async () => {
    const inside = new Date(fixedNow - 1 * 24 * 60 * 60 * 1000);
    const outside = new Date(fixedNow - 2 * 24 * 60 * 60 * 1000);
    const prisma = createFakePrisma([
      { id: "inside", createdAt: inside },
      { id: "outside", createdAt: outside },
    ]);

    const deleted = await deleteOldAuditLogs(prisma, {
      retentionDays: 1,
      now: fixedNow,
      batchSize: 1000,
    });

    expect(deleted).toBe(1);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { lt: new Date(fixedNow - 1 * 24 * 60 * 60 * 1000) } },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 1000,
      }),
    );
  });

  it("does not delete rows exactly at the cutoff", async () => {
    const cutoff = new Date(fixedNow - 1 * 24 * 60 * 60 * 1000);
    const prisma = createFakePrisma([
      { id: "at-cutoff", createdAt: cutoff },
      { id: "older", createdAt: new Date(cutoff.getTime() - 1) },
    ]);

    const deleted = await deleteOldAuditLogs(prisma, {
      retentionDays: 1,
      now: fixedNow,
      batchSize: 1000,
    });

    expect(deleted).toBe(1);
  });

  it("processes rows in fixed-size batches until exhausted", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `row-${i}`,
      createdAt: new Date(fixedNow - (i + 2) * 24 * 60 * 60 * 1000),
    }));
    const prisma = createFakePrisma(rows);

    const deleted = await deleteOldAuditLogs(prisma, {
      retentionDays: 1,
      now: fixedNow,
      batchSize: 2,
    });

    expect(deleted).toBe(5);
    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(3);
  });

  it("is idempotent under concurrent runs", async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({
      id: `row-${i}`,
      createdAt: new Date(fixedNow - (i + 2) * 24 * 60 * 60 * 1000),
    }));
    const prisma = createFakePrisma(rows);

    const [a, b] = await Promise.all([
      deleteOldAuditLogs(prisma, { retentionDays: 1, now: fixedNow, batchSize: 2 }),
      deleteOldAuditLogs(prisma, { retentionDays: 1, now: fixedNow, batchSize: 2 }),
    ]);

    expect(a + b).toBeLessThanOrEqual(4);
    expect(prisma.rows).toHaveLength(0);
  });

  it("returns 0 when retention is disabled", async () => {
    const prisma = createFakePrisma([
      { id: "old", createdAt: new Date(fixedNow - 365 * 24 * 60 * 60 * 1000 - 1) },
    ]);

    const deleted = await deleteOldAuditLogs(prisma, {
      retentionDays: 0,
      now: fixedNow,
      batchSize: 1000,
    });

    expect(deleted).toBe(0);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });
});

describe("runAuditLogCleanup", () => {
  it("logs completion with retention, cutoff, and duration", async () => {
    const logger = createFakeLogger();
    const prisma = createFakePrisma([
      { id: "old", createdAt: new Date(fixedNow - 366 * 24 * 60 * 60 * 1000) },
    ]);

    const deleted = await runAuditLogCleanup(prisma, {
      env: { SUI_AUDIT_LOG_RETENTION_DAYS: "365" },
      getNow: () => fixedNow,
      logger,
    });

    expect(deleted).toBe(1);
    expect(logger.infoLogs).toHaveLength(1);
    expect(logger.infoLogs[0]).toMatchObject({
      deletedCount: 1,
      retentionDays: 365,
    });
  });

  it("is disabled when SUI_AUDIT_LOG_RETENTION_DAYS is 0", async () => {
    const logger = createFakeLogger();
    const prisma = createFakePrisma([
      { id: "old", createdAt: new Date(fixedNow - 366 * 24 * 60 * 60 * 1000) },
    ]);

    const deleted = await runAuditLogCleanup(prisma, {
      env: { SUI_AUDIT_LOG_RETENTION_DAYS: "0" },
      getNow: () => fixedNow,
      logger,
    });

    expect(deleted).toBe(0);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    expect(logger.infoLogs[0]).toMatchObject({ disabled: true });
  });

  it("falls back to 365 and logs a warning for invalid env values", async () => {
    const logger = createFakeLogger();
    const prisma = createFakePrisma([
      { id: "old", createdAt: new Date(fixedNow - 366 * 24 * 60 * 60 * 1000) },
    ]);

    const deleted = await runAuditLogCleanup(prisma, {
      env: { SUI_AUDIT_LOG_RETENTION_DAYS: "invalid" },
      getNow: () => fixedNow,
      logger,
    });

    expect(deleted).toBe(1);
    expect(logger.warnLogs).toHaveLength(1);
    expect(logger.warnLogs[0]).toMatchObject({
      SUI_AUDIT_LOG_RETENTION_DAYS: "invalid",
      default: 365,
    });
    expect(logger.infoLogs[0]).toMatchObject({ deletedCount: 1, retentionDays: 365 });
  });

  it("resolves and does not throw for an overflowing SUI_AUDIT_LOG_RETENTION_DAYS", async () => {
    const logger = createFakeLogger();
    const prisma = createFakePrisma([
      { id: "old", createdAt: new Date(fixedNow - 366 * 24 * 60 * 60 * 1000) },
    ]);

    await expect(
      runAuditLogCleanup(prisma, {
        env: { SUI_AUDIT_LOG_RETENTION_DAYS: "9".repeat(400) },
        getNow: () => fixedNow,
        logger,
      }),
    ).resolves.toBe(1);

    expect(logger.warnLogs).toHaveLength(1);
    expect(logger.warnLogs[0]).toMatchObject({
      SUI_AUDIT_LOG_RETENTION_DAYS: "9".repeat(400),
      default: 365,
    });
    expect(logger.infoLogs[0]).toMatchObject({ deletedCount: 1, retentionDays: 365 });
  });

  it("resolves and does not throw for Number.MAX_SAFE_INTEGER retention", async () => {
    const logger = createFakeLogger();
    const prisma = createFakePrisma([
      { id: "old", createdAt: new Date(fixedNow - 366 * 24 * 60 * 60 * 1000) },
    ]);

    await expect(
      runAuditLogCleanup(prisma, {
        env: { SUI_AUDIT_LOG_RETENTION_DAYS: String(Number.MAX_SAFE_INTEGER) },
        getNow: () => fixedNow,
        logger,
      }),
    ).resolves.toBe(1);

    expect(logger.warnLogs).toHaveLength(1);
    expect(logger.infoLogs[0]).toMatchObject({ deletedCount: 1, retentionDays: 365 });
  });

  it("logs errors and does not throw when delete fails", async () => {
    const logger = createFakeLogger();
    const prisma: AuditLogCleanupPrisma = {
      auditLog: {
        findMany: vi.fn().mockRejectedValue(new Error("DB unavailable")),
        deleteMany: vi.fn(),
      },
    };

    await expect(
      runAuditLogCleanup(prisma, {
        env: { SUI_AUDIT_LOG_RETENTION_DAYS: "365" },
        getNow: () => fixedNow,
        logger,
      }),
    ).resolves.toBe(0);

    expect(logger.errorLogs).toHaveLength(1);
    expect(logger.errorLogs[0]).toMatchObject({
      retentionDays: 365,
      err: expect.any(Error),
    });
  });
});
