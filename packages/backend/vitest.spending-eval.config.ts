import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["src/services/spending-model.eval.ts"],
    testTimeout: 60000,
    fileParallelism: false,
  },
});
