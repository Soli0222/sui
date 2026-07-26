import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PrismaInstrumentation } from "@prisma/instrumentation";

export function shouldStartOtel(env: Record<string, string | undefined>): boolean {
  const tracesEndpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

  return tracesEndpoint !== undefined && tracesEndpoint.length > 0
    ? true
    : endpoint !== undefined && endpoint.length > 0;
}

function startOtel() {
  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || "sui-backend";

  const sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [new PrismaInstrumentation()],
  });

  sdk.start();

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, async () => {
      try {
        await sdk.shutdown();
      } catch (error) {
        console.error("Failed to shutdown OpenTelemetry SDK:", error);
      }
      process.exit(0);
    });
  }
}

if (shouldStartOtel(process.env)) {
  startOtel();
}
