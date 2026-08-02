import { describe, expect, it, vi } from "vitest";
import {
  startAuditLogCleanupScheduler,
  type TimerHandle,
  type TimerProvider,
} from "./audit-cleanup-scheduler";
import { DEFAULT_AUDIT_LOG_CLEANUP_INTERVAL_MS, type AuditLogCleanupPrisma } from "./audit-cleanup";

class FakeHandle implements TimerHandle {
  unrefCalled = false;
  cleared = false;

  unref() {
    this.unrefCalled = true;
    return this;
  }

  clear() {
    this.cleared = true;
  }
}

function createFakeTimerProvider(): TimerProvider & {
  timeouts: Array<{ ms: number; callback: () => unknown; handle: FakeHandle }>;
  intervals: Array<{ ms: number; callback: () => unknown; handle: FakeHandle }>;
  runImmediate: () => Promise<void>;
  runInterval: () => Promise<void>;
} {
  const timeouts: Array<{ ms: number; callback: () => unknown; handle: FakeHandle }> = [];
  const intervals: Array<{ ms: number; callback: () => unknown; handle: FakeHandle }> = [];

  return {
    timeouts,
    intervals,
    setTimeout(callback, ms) {
      const handle = new FakeHandle();
      handle.unref();
      timeouts.push({ ms, callback, handle });
      return handle;
    },
    setInterval(callback, ms) {
      const handle = new FakeHandle();
      handle.unref();
      intervals.push({ ms, callback, handle });
      return handle;
    },
    async runImmediate() {
      for (const t of timeouts) {
        await t.callback();
      }
    },
    async runInterval() {
      for (const i of intervals) {
        await i.callback();
      }
    },
  };
}

function createFakePrisma(): AuditLogCleanupPrisma {
  return {
    auditLog: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  };
}

const fakeLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("startAuditLogCleanupScheduler", () => {
  it("runs cleanup immediately and then on the configured interval", async () => {
    const timers = createFakeTimerProvider();
    const prisma = createFakePrisma();

    startAuditLogCleanupScheduler(prisma, {
      intervalMs: 1000,
      timerProvider: timers,
      env: { SUI_AUDIT_LOG_RETENTION_DAYS: "365" },
      logger: fakeLogger,
      getNow: () => 0,
    });

    expect(timers.timeouts).toHaveLength(1);
    expect(timers.timeouts[0].ms).toBe(0);
    expect(timers.intervals).toHaveLength(1);
    expect(timers.intervals[0].ms).toBe(1000);

    await timers.runImmediate();
    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(1);

    await timers.runInterval();
    expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(2);
  });

  it("uses a 24 hour interval by default", () => {
    const timers = createFakeTimerProvider();
    const prisma = createFakePrisma();

    startAuditLogCleanupScheduler(prisma, {
      timerProvider: timers,
      env: { SUI_AUDIT_LOG_RETENTION_DAYS: "365" },
      logger: fakeLogger,
      getNow: () => 0,
    });

    expect(timers.intervals[0].ms).toBe(DEFAULT_AUDIT_LOG_CLEANUP_INTERVAL_MS);
  });

  it("unrefs both the immediate and interval timers", () => {
    const timers = createFakeTimerProvider();
    const prisma = createFakePrisma();

    startAuditLogCleanupScheduler(prisma, {
      timerProvider: timers,
      env: { SUI_AUDIT_LOG_RETENTION_DAYS: "365" },
      logger: fakeLogger,
    });

    expect(timers.timeouts[0].handle.unrefCalled).toBe(true);
    expect(timers.intervals[0].handle.unrefCalled).toBe(true);
  });

  it("does not schedule an immediate run when immediate is false", () => {
    const timers = createFakeTimerProvider();
    const prisma = createFakePrisma();

    startAuditLogCleanupScheduler(prisma, {
      immediate: false,
      timerProvider: timers,
      env: { SUI_AUDIT_LOG_RETENTION_DAYS: "365" },
      logger: fakeLogger,
    });

    expect(timers.timeouts).toHaveLength(0);
    expect(timers.intervals).toHaveLength(1);
  });

  it("stops both timers", () => {
    const timers = createFakeTimerProvider();
    const prisma = createFakePrisma();

    const scheduler = startAuditLogCleanupScheduler(prisma, {
      timerProvider: timers,
      env: { SUI_AUDIT_LOG_RETENTION_DAYS: "365" },
      logger: fakeLogger,
    });

    scheduler.stop();

    expect(timers.timeouts[0].handle.cleared).toBe(true);
    expect(timers.intervals[0].handle.cleared).toBe(true);
  });
});
