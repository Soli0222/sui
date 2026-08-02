import { logger as appLogger } from "../lib/logger";
import {
  DEFAULT_AUDIT_LOG_CLEANUP_BATCH_SIZE,
  DEFAULT_AUDIT_LOG_CLEANUP_INTERVAL_MS,
  runAuditLogCleanup,
  type AuditLogCleanupLogger,
  type AuditLogCleanupPrisma,
} from "./audit-cleanup";

export interface TimerHandle {
  unref(): TimerHandle;
  clear(): void;
}

export interface TimerProvider {
  setTimeout(callback: () => unknown, ms: number): TimerHandle;
  setInterval(callback: () => unknown, ms: number): TimerHandle;
}

const nodeTimerProvider: TimerProvider = {
  setTimeout(callback, ms) {
    const timeout = setTimeout(callback, ms);
    const handle: TimerHandle = {
      unref: () => {
        timeout.unref();
        return handle;
      },
      clear: () => {
        clearTimeout(timeout);
      },
    };
    handle.unref();
    return handle;
  },
  setInterval(callback, ms) {
    const interval = setInterval(callback, ms);
    const handle: TimerHandle = {
      unref: () => {
        interval.unref();
        return handle;
      },
      clear: () => {
        clearInterval(interval);
      },
    };
    handle.unref();
    return handle;
  },
};

export interface StartAuditLogCleanupSchedulerOptions {
  intervalMs?: number;
  immediate?: boolean;
  env?: Record<string, string | undefined>;
  batchSize?: number;
  logger?: AuditLogCleanupLogger;
  timerProvider?: TimerProvider;
  getNow?: () => number;
}

export function startAuditLogCleanupScheduler(
  prisma: AuditLogCleanupPrisma,
  {
    intervalMs = DEFAULT_AUDIT_LOG_CLEANUP_INTERVAL_MS,
    immediate = true,
    env = process.env,
    batchSize = DEFAULT_AUDIT_LOG_CLEANUP_BATCH_SIZE,
    logger = appLogger,
    timerProvider = nodeTimerProvider,
    getNow,
  }: StartAuditLogCleanupSchedulerOptions = {},
) {
  const run = () =>
    runAuditLogCleanup(prisma, { env, getNow, batchSize, logger });

  const handles: TimerHandle[] = [];

  if (immediate) {
    handles.push(timerProvider.setTimeout(run, 0));
  }

  handles.push(timerProvider.setInterval(run, intervalMs));

  return {
    stop: () => {
      for (const handle of handles) {
        handle.clear();
      }
    },
  };
}
