import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["src/test-helpers/vitest.setup.ts"],
  },
});
