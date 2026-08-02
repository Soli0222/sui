export const DEFAULT_AUDIT_LOG_RETENTION_DAYS = 365;
export const DEFAULT_AUDIT_LOG_CLEANUP_BATCH_SIZE = 1000;
export const DEFAULT_AUDIT_LOG_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

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

  return Number(trimmed);
}

function getRetentionCutoffDate(retentionDays: number, nowMs: number): Date {
  return new Date(nowMs - retentionDays * 24 * 60 * 60 * 1000);
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
  if (retentionDays <= 0) {
    return 0;
  }

  const cutoff = getRetentionCutoffDate(retentionDays, now);
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
  const retentionDays = getAuditLogRetentionDays(envValue, logger);

  if (retentionDays === 0) {
    logger.info(
      { SUI_AUDIT_LOG_RETENTION_DAYS: envValue, disabled: true },
      "Audit log cleanup is disabled",
    );
    return 0;
  }

  const startedAt = getNow();
  const cutoff = getRetentionCutoffDate(retentionDays, startedAt);

  try {
    const deletedCount = await deleteOldAuditLogs(prisma, {
      retentionDays,
      now: startedAt,
      batchSize,
    });

    logger.info(
      {
        deletedCount,
        retentionDays,
        cutoff: cutoff.toISOString(),
        duration_ms: getNow() - startedAt,
      },
      "Audit log cleanup completed",
    );

    return deletedCount;
  } catch (error) {
    logger.error(
      { err: error, retentionDays, cutoff: cutoff.toISOString() },
      "Audit log cleanup failed",
    );
    return 0;
  }
}
