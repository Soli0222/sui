import { trace, type Span } from "@opentelemetry/api";
import pino from "pino";

export function getTraceContextFromSpan(span: Span | undefined) {
  const context = span?.spanContext();

  if (!context || !trace.isSpanContextValid(context)) {
    return {};
  }

  return {
    trace_id: context.traceId,
    span_id: context.spanId,
    trace_flags: context.traceFlags.toString(16).padStart(2, "0"),
  };
}

export function getTraceContext() {
  return getTraceContextFromSpan(trace.getActiveSpan());
}

const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

export const logger = pino({
  level: isTest ? "silent" : process.env.SUI_LOG_LEVEL ?? "info",
  serializers: {
    err: pino.stdSerializers.err,
  },
  mixin: getTraceContext,
});

// Audit records have their own floor so SUI_LOG_LEVEL cannot suppress them.
export function createAuditLogger(destination: pino.DestinationStream) {
  return pino({ level: "info", mixin: getTraceContext }, destination);
}

export const auditLogger = pino({ level: isTest ? "silent" : "info", mixin: getTraceContext });
export type AuditLogger = Pick<typeof auditLogger, "info" | "warn" | "error">;
