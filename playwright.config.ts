import { defineConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const runId = process.env.SUI_E2E_RUN_ID ?? "default";

export const e2eBaseUrl =
  process.env.SUI_E2E_FRONTEND_URL ??
  `http://localhost:${process.env.SUI_E2E_FRONTEND_PORT ?? "5174"}`;

const outputDir = path.resolve(__dirname, "test-results", runId);
const reportDir = path.resolve(__dirname, "playwright-report", runId);

export const authStorageState = path.resolve(outputDir, "auth", "user.json");

const backendPort = Number(process.env.SUI_E2E_BACKEND_PORT ?? process.env.PORT ?? "3100");
const mockIdpPort = Number(process.env.SUI_E2E_IDP_PORT ?? process.env.MOCK_IDP_PORT ?? "3101");
const frontendPort = Number(process.env.SUI_E2E_FRONTEND_PORT ?? "5174");

const backendUrl = `http://localhost:${backendPort}`;
const mockIdpUrl = `http://localhost:${mockIdpPort}`;
const frontendUrl = `http://localhost:${frontendPort}`;

const databaseUrl =
  process.env.DATABASE_URL ??
  `postgresql://sui_test:sui_test@localhost:${Number(process.env.SUI_TEST_PG_PORT ?? "5555")}/sui_test`;

const mockIdpServerPath = path.resolve(__dirname, "e2e/helpers/mock-idp-server.ts");

mkdirSync(path.dirname(authStorageState), { recursive: true });

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  outputDir,
  reporter: [
    ["list"],
    ["html", { outputFolder: reportDir }],
  ],
  use: {
    baseURL: e2eBaseUrl,
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
      command: `MOCK_IDP_PORT=${mockIdpPort} pnpm --filter @sui/backend exec tsx ${mockIdpServerPath}`,
      port: mockIdpPort,
      reuseExistingServer: false,
    },
    {
      command:
        `DATABASE_URL=${databaseUrl} PORT=${backendPort} ` +
        `SUI_AUTH_MODE=enabled ` +
        `SUI_OIDC_ISSUER=${mockIdpUrl} ` +
        `SUI_OIDC_CLIENT_ID=sui-e2e ` +
        `SUI_OIDC_CLIENT_SECRET=e2e-secret ` +
        `SUI_OIDC_REDIRECT_URI=${backendUrl}/api/auth/callback ` +
        `SUI_OIDC_ALLOWED_SUBJECTS=e2e-user ` +
        `SUI_COOKIE_SECURE=false ` +
        `SUI_FRONTEND_URL=${frontendUrl} ` +
        `pnpm --filter @sui/backend dev:run`,
      port: backendPort,
      reuseExistingServer: false,
    },
    {
      command: `VITE_API_BASE=${backendUrl} pnpm --filter @sui/frontend dev --port ${frontendPort}`,
      port: frontendPort,
      reuseExistingServer: false,
    },
  ],
});
