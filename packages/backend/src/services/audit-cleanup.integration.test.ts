import { describe, expect, it, vi } from "vitest";
import { deleteOldAuditLogs, runAuditLogCleanup } from "./audit-cleanup";
import { testPrisma } from "../test-helpers/db";

const fixedNow = new Date("2026-08-02T00:00:00.000Z").getTime();

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function auditLogRow(createdAt: Date) {
  return {
    method: "POST",
    path: "/api/accounts",
    status: 201,
    clientSource: "web",
    requestId: null,
    createdAt,
  };
}

describe("audit log cleanup integration", () => {
  it("deletes only rows older than the retention cutoff", async () => {
    const cutoff = new Date(fixedNow - 1 * 24 * 60 * 60 * 1000);
    const older = new Date(cutoff.getTime() - 1);
    const newer = new Date(cutoff.getTime() + 1);

    await testPrisma.auditLog.create({ data: auditLogRow(newer) });
    await testPrisma.auditLog.create({ data: auditLogRow(cutoff) });
    await testPrisma.auditLog.create({ data: auditLogRow(older) });

    const deleted = await deleteOldAuditLogs(testPrisma, {
      retentionDays: 1,
      now: fixedNow,
      batchSize: 1000,
    });

    expect(deleted).toBe(1);
    expect(await testPrisma.auditLog.count()).toBe(2);
  });

  it("processes deletion in fixed-size batches", async () => {
    const older = new Date(fixedNow - 2 * 24 * 60 * 60 * 1000);
    for (let i = 0; i < 5; i++) {
      await testPrisma.auditLog.create({
        data: auditLogRow(new Date(older.getTime() - i)),
      });
    }

    const deleted = await deleteOldAuditLogs(testPrisma, {
      retentionDays: 1,
      now: fixedNow,
      batchSize: 2,
    });

    expect(deleted).toBe(5);
    expect(await testPrisma.auditLog.count()).toBe(0);
  });

  it("is idempotent across repeated runs", async () => {
    const older = new Date(fixedNow - 2 * 24 * 60 * 60 * 1000);
    for (let i = 0; i < 3; i++) {
      await testPrisma.auditLog.create({
        data: auditLogRow(new Date(older.getTime() - i)),
      });
    }

    const first = await runAuditLogCleanup(testPrisma, {
      env: { SUI_AUDIT_LOG_RETENTION_DAYS: "1" },
      getNow: () => fixedNow,
      batchSize: 1000,
      logger: createLogger(),
    });
    const second = await runAuditLogCleanup(testPrisma, {
      env: { SUI_AUDIT_LOG_RETENTION_DAYS: "1" },
      getNow: () => fixedNow,
      batchSize: 1000,
      logger: createLogger(),
    });

    expect(first).toBe(3);
    expect(second).toBe(0);
    expect(await testPrisma.auditLog.count()).toBe(0);
  });

  it("is disabled when SUI_AUDIT_LOG_RETENTION_DAYS is 0", async () => {
    const older = new Date(fixedNow - 365 * 24 * 60 * 60 * 1000);
    await testPrisma.auditLog.create({ data: auditLogRow(older) });

    const deleted = await runAuditLogCleanup(testPrisma, {
      env: { SUI_AUDIT_LOG_RETENTION_DAYS: "0" },
      getNow: () => fixedNow,
      batchSize: 1000,
      logger: createLogger(),
    });

    expect(deleted).toBe(0);
    expect(await testPrisma.auditLog.count()).toBe(1);
  });
});
