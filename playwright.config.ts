import { defineConfig } from "@playwright/test";

const testDatabaseUrl = "postgresql://sui_test:sui_test@localhost:5555/sui_test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: [
    {
      command: `DATABASE_URL=${testDatabaseUrl} PORT=3100 pnpm --filter @sui/backend dev`,
      port: 3100,
      reuseExistingServer: true,
    },
    {
      command: `VITE_API_BASE=http://localhost:3100 pnpm --filter @sui/frontend dev --port 5174`,
      port: 5174,
      reuseExistingServer: true,
    },
  ],
});
