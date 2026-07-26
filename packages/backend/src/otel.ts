import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { PrismaInstrumentation } from "@prisma/instrumentation";

export function shouldStartOtel(env: Record<string, string | undefined>): boolean {
  const endpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? env.OTEL_EXPORTER_OTLP_ENDPOINT;
  return typeof endpoint === "string" && endpoint.trim().length > 0;
}

function startOtel() {
  const serviceName = process.env.OTEL_SERVICE_NAME ?? "sui-backend";

  const sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation(),
      new PinoInstrumentation({ disableLogSending: true }),
      new PrismaInstrumentation(),
    ],
  });

  sdk.start();
}

if (shouldStartOtel(process.env)) {
  startOtel();
}
