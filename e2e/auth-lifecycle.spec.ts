import { expect, test } from "@playwright/test";
import { e2eBaseUrl } from "../playwright.config";

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  await page.goto("/api/auth/login");
  await page.waitForURL(new URL("/", e2eBaseUrl).href);
});

test("logs out through the UI and redirects to the login screen", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();

  await page.getByRole("button", { name: "ログアウト" }).click();
  await page.waitForURL(new URL("/", e2eBaseUrl).href);
  await expect(page.getByRole("button", { name: "IdP でログイン" })).toBeVisible();
});

test("redirects to login after an API returns 401", async ({ page }) => {
  const tokensLoaded = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/auth/tokens" &&
      response.status() === 200,
  );

  await page.goto("/settings");
  await tokensLoaded;

  await page.request.post("/api/auth/logout");

  await page.getByRole("button", { name: "トークンを発行" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("用途").fill("expired-session");
  await dialog.getByRole("button", { name: "発行" }).click();

  await expect(page.getByRole("button", { name: "IdP でログイン" })).toBeVisible();
});
