import type { AuditLogger } from "../lib/logger";

export interface CapturedAudit {
  level: "info" | "warn" | "error";
  msg: string;
  [key: string]: unknown;
}

export function createAuditCapture() {
  const records: CapturedAudit[] = [];
  const emit = (level: CapturedAudit["level"]) => (fields: object, msg: string) => {
    records.push({ ...fields, level, msg });
  };
  const logger = {
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  } as AuditLogger;
  return { records, logger };
}
