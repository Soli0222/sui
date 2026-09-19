import { defineConfig } from "@playwright/test";
import path from "node:path";

const runId = process.env.SUI_E2E_RUN_ID ?? "default";
const workers = Number(process.env.E2E_WORKERS ?? "4");
if (!Number.isInteger(workers) || workers < 1) {
  throw new Error("E2E_WORKERS must be a positive integer");
}

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  fullyParallel: true,
  workers,
  outputDir: path.resolve("test-results", runId, "tests"),
  reporter: [
    ["list"],
    ["html", { outputFolder: path.resolve("playwright-report", runId), open: "never" }],
  ],
  use: {
    headless: true,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
