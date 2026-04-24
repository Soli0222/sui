import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["src/performance/**/*.bench.ts"],
    testTimeout: 120_000,
  },
});
