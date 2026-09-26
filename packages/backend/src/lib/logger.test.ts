import { describe, expect, it } from "vitest";
import type { Span } from "@opentelemetry/api";
import { getTraceContextFromSpan } from "./logger";

describe("trace fields", () => {
  it("uses the active API span IDs and omits invalid spans", () => {
    const span = { spanContext: () => ({
      traceId: "11111111111111111111111111111111",
      spanId: "2222222222222222",
      traceFlags: 1,
    }) } as Span;
    expect(getTraceContextFromSpan(span)).toEqual({
      trace_id: "11111111111111111111111111111111",
      span_id: "2222222222222222",
      trace_flags: "01",
    });
    expect(getTraceContextFromSpan(undefined)).toEqual({});
    expect(getTraceContextFromSpan({ spanContext: () => ({
      traceId: "00000000000000000000000000000000",
      spanId: "2222222222222222",
      traceFlags: 1,
    }) } as Span)).toEqual({});
  });
});
