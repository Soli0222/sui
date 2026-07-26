import { describe, expect, it } from "vitest";
import { shouldStartOtel } from "./otel";

describe("shouldStartOtel", () => {
  it("returns false when no OTLP endpoint is configured", () => {
    expect(shouldStartOtel({})).toBe(false);
    expect(shouldStartOtel({ OTEL_EXPORTER_OTLP_ENDPOINT: "" })).toBe(false);
    expect(shouldStartOtel({ OTEL_EXPORTER_OTLP_ENDPOINT: "   " })).toBe(false);
  });

  it("returns true when OTEL_EXPORTER_OTLP_ENDPOINT is set", () => {
    expect(
      shouldStartOtel({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318" }),
    ).toBe(true);
  });

  it("returns true when OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is set", () => {
    expect(
      shouldStartOtel({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://localhost:4318/v1/traces",
      }),
    ).toBe(true);
  });

  it("prefers OTEL_EXPORTER_OTLP_TRACES_ENDPOINT over OTEL_EXPORTER_OTLP_ENDPOINT", () => {
    expect(
      shouldStartOtel({
        OTEL_EXPORTER_OTLP_ENDPOINT: "",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://localhost:4318/v1/traces",
      }),
    ).toBe(true);
  });
});
