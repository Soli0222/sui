import { trace } from "@opentelemetry/api";
import pino from "pino";

function getTraceContext() {
  const span = trace.getActiveSpan();
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

const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

export const logger = pino({
  level: isTest ? "silent" : process.env.SUI_LOG_LEVEL ?? "info",
  serializers: {
    err: pino.stdSerializers.err,
  },
  mixin: getTraceContext,
});
