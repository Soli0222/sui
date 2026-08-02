import { test as setup } from "@playwright/test";
import { authStorageState, e2eBaseUrl } from "../playwright.config";

setup("authenticate through mock IdP", async ({ page }) => {
  await page.goto("/api/auth/login");
  await page.waitForURL(new URL("/", e2eBaseUrl).href);
  await page.context().storageState({ path: authStorageState });
});
