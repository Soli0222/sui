import pino from "pino";

const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

export const logger = pino({
  level: isTest ? "silent" : process.env.SUI_LOG_LEVEL ?? "info",
  serializers: {
    err: pino.stdSerializers.err,
  },
});
