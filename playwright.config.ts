import { defineConfig } from "@playwright/test";
import path from "node:path";

const testDatabaseUrl = "postgresql://sui_test:sui_test@localhost:5555/sui_test";

export const authStorageState = path.resolve(__dirname, "playwright/.auth/user.json");
const mockIdpServerPath = path.resolve(__dirname, "e2e/helpers/mock-idp-server.ts");

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:5174",
    headless: true,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { browserName: "chromium", storageState: authStorageState },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: `pnpm --filter @sui/backend exec tsx ${mockIdpServerPath}`,
      port: 3101,
      reuseExistingServer: true,
    },
    {
      command:
        `DATABASE_URL=${testDatabaseUrl} PORT=3100 ` +
        `SUI_AUTH_MODE=enabled ` +
        `SUI_OIDC_ISSUER=http://localhost:3101 ` +
        `SUI_OIDC_CLIENT_ID=sui-e2e ` +
        `SUI_OIDC_CLIENT_SECRET=e2e-secret ` +
        `SUI_OIDC_REDIRECT_URI=http://localhost:3100/api/auth/callback ` +
        `SUI_OIDC_ALLOWED_SUBJECTS=e2e-user ` +
        `SUI_COOKIE_SECURE=false ` +
        `SUI_FRONTEND_URL=http://localhost:5174 ` +
        `pnpm --filter @sui/backend dev`,
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
