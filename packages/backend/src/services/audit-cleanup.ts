export const DEFAULT_AUDIT_LOG_RETENTION_DAYS = 365;
export const DEFAULT_AUDIT_LOG_CLEANUP_BATCH_SIZE = 1000;
export const DEFAULT_AUDIT_LOG_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Maximum retention days that keeps the cutoff within the valid Date range
// (±8.64e15 ms) for any now in [0, 8.64e15].
export const MAX_AUDIT_LOG_RETENTION_DAYS = 100_000_000;

function isValidFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export interface AuditLogCleanupLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface AuditLogCleanupPrisma {
  auditLog: {
    findMany(args: {
      where?: { createdAt?: { lt: Date } };
      select: { id: true };
      orderBy: { id: "asc" };
      take: number;
    }): Promise<Array<{ id: string }>>;
    deleteMany(args: { where: { id: { in: string[] } } }): Promise<{ count: number }>;
  };
}

export function getAuditLogRetentionDays(
  envValue: string | undefined,
  logger: AuditLogCleanupLogger,
): number {
  if (!envValue) {
    return DEFAULT_AUDIT_LOG_RETENTION_DAYS;
  }

  const trimmed = envValue.trim();
  if (trimmed === "0") {
    return 0;
  }

  if (!/^[1-9]\d*$/.test(trimmed)) {
    logger.warn(
      {
        SUI_AUDIT_LOG_RETENTION_DAYS: envValue,
        default: DEFAULT_AUDIT_LOG_RETENTION_DAYS,
      },
      "Invalid SUI_AUDIT_LOG_RETENTION_DAYS, falling back to default",
    );
    return DEFAULT_AUDIT_LOG_RETENTION_DAYS;
  }

  const parsed = Number(trimmed);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > MAX_AUDIT_LOG_RETENTION_DAYS
  ) {
    logger.warn(
      {
        SUI_AUDIT_LOG_RETENTION_DAYS: envValue,
        default: DEFAULT_AUDIT_LOG_RETENTION_DAYS,
      },
      "Invalid SUI_AUDIT_LOG_RETENTION_DAYS, falling back to default",
    );
    return DEFAULT_AUDIT_LOG_RETENTION_DAYS;
  }

  return parsed;
}

function getRetentionCutoffDate(retentionDays: number, nowMs: number): Date {
  return new Date(nowMs - retentionDays * 24 * 60 * 60 * 1000);
}

function safeCutoffISOString(cutoff: Date): string | null {
  const time = cutoff.getTime();
  if (!Number.isFinite(time)) return null;
  try {
    return cutoff.toISOString();
  } catch {
    return null;
  }
}

export interface DeleteOldAuditLogsOptions {
  retentionDays: number;
  now: number;
  batchSize: number;
}

export async function deleteOldAuditLogs(
  prisma: AuditLogCleanupPrisma,
  { retentionDays, now, batchSize }: DeleteOldAuditLogsOptions,
): Promise<number> {
  if (
    !Number.isSafeInteger(retentionDays) ||
    retentionDays <= 0 ||
    !isValidFiniteNumber(now) ||
    !Number.isSafeInteger(batchSize) ||
    batchSize <= 0
  ) {
    return 0;
  }

  const cutoff = getRetentionCutoffDate(retentionDays, now);
  if (!isValidFiniteNumber(cutoff.getTime())) {
    return 0;
  }
  let totalDeleted = 0;

  while (true) {
    const batch = await prisma.auditLog.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { id: "asc" },
      take: batchSize,
    });

    if (batch.length === 0) {
      break;
    }

    const { count } = await prisma.auditLog.deleteMany({
      where: { id: { in: batch.map((row) => row.id) } },
    });
    totalDeleted += count;

    if (batch.length < batchSize) {
      break;
    }
  }

  return totalDeleted;
}

export interface RunAuditLogCleanupOptions {
  env?: Record<string, string | undefined>;
  getNow?: () => number;
  batchSize?: number;
  logger: AuditLogCleanupLogger;
}

export async function runAuditLogCleanup(
  prisma: AuditLogCleanupPrisma,
  {
    env = process.env,
    getNow = () => Date.now(),
    batchSize = DEFAULT_AUDIT_LOG_CLEANUP_BATCH_SIZE,
    logger,
  }: RunAuditLogCleanupOptions,
): Promise<number> {
  const envValue = env.SUI_AUDIT_LOG_RETENTION_DAYS;
  let retentionDays = getAuditLogRetentionDays(envValue, logger);

  let startedAt = getNow();
  if (!isValidFiniteNumber(startedAt) || startedAt < 0) {
    logger.warn(
      { getNow_value: startedAt, default: "Date.now()" },
      "Invalid getNow() value, using Date.now()",
    );
    startedAt = Date.now();
  }

  let effectiveBatchSize = batchSize;
  if (!Number.isSafeInteger(effectiveBatchSize) || effectiveBatchSize <= 0) {
    logger.warn(
      { batchSize, default: DEFAULT_AUDIT_LOG_CLEANUP_BATCH_SIZE },
      "Invalid batch size, using default",
    );
    effectiveBatchSize = DEFAULT_AUDIT_LOG_CLEANUP_BATCH_SIZE;
  }

  if (retentionDays === 0) {
    logger.info(
      { SUI_AUDIT_LOG_RETENTION_DAYS: envValue, disabled: true },
      "Audit log cleanup is disabled",
    );
    return 0;
  }

  let cutoff = getRetentionCutoffDate(retentionDays, startedAt);
  if (!isValidFiniteNumber(cutoff.getTime())) {
    logger.warn(
      {
        SUI_AUDIT_LOG_RETENTION_DAYS: envValue,
        retentionDays,
        startedAt,
        default: DEFAULT_AUDIT_LOG_RETENTION_DAYS,
      },
      "Computed invalid retention cutoff, falling back to default retention",
    );
    retentionDays = DEFAULT_AUDIT_LOG_RETENTION_DAYS;
    cutoff = getRetentionCutoffDate(retentionDays, startedAt);
    if (!isValidFiniteNumber(cutoff.getTime())) {
      logger.error(
        { startedAt, retentionDays },
        "Cannot compute a valid audit log retention cutoff",
      );
      return 0;
    }
  }

  const cutoffString = safeCutoffISOString(cutoff) ?? "invalid";

  try {
    const deletedCount = await deleteOldAuditLogs(prisma, {
      retentionDays,
      now: startedAt,
      batchSize: effectiveBatchSize,
    });

    logger.info(
      {
        deletedCount,
        retentionDays,
        cutoff: cutoffString,
        duration_ms: getNow() - startedAt,
      },
      "Audit log cleanup completed",
    );

    return deletedCount;
  } catch (error) {
    logger.error(
      { err: error, retentionDays, cutoff: cutoffString },
      "Audit log cleanup failed",
    );
    return 0;
  }
}
