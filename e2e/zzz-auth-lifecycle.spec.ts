// `zzz-` prefix forces this spec to run last (workers=1, alphabetical order), because
// it logs out and invalidates the shared authenticated session in the database.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { authStorageState } from "../playwright.config";

interface StorageStateCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

test.use({ storageState: authStorageState });

test.beforeEach(async ({ page }) => {
  const storage = JSON.parse(readFileSync(authStorageState, "utf8")) as { cookies: StorageStateCookie[] };
  await page.context().clearCookies();
  await page.context().addCookies(
    storage.cookies.map((cookie) => ({ ...cookie, expires: -1 })),
  );
});

test("logs out and redirects to the login screen after a 401", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();

  await page.getByRole("button", { name: "ログアウト" }).click();
  await page.waitForURL("http://localhost:5174/");
  await expect(page.getByRole("button", { name: "IdP でログイン" })).toBeVisible();

  await page.goto("/api/auth/login");
  await page.waitForURL("http://localhost:5174/");

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();

  await page.request.post("/api/auth/logout");

  await page.getByRole("button", { name: "トークンを発行" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("用途").fill("expired-session");
  await dialog.getByRole("button", { name: "発行" }).click();

  await expect(page.getByRole("button", { name: "IdP でログイン" })).toBeVisible();
});
