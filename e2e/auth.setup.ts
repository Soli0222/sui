import { test as setup } from "@playwright/test";
import { authStorageState } from "../playwright.config";

setup("authenticate through mock IdP", async ({ page }) => {
  await page.goto("/api/auth/login");
  await page.waitForURL("http://localhost:5174/");
  await page.context().storageState({ path: authStorageState });
});
