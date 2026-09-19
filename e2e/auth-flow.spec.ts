import { expect, test } from "./helpers/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("logs in through the IdP", async ({ page, baseURL }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "IdP でログイン" })).toBeVisible();

  await page.getByRole("button", { name: "IdP でログイン" }).click();
  await page.waitForURL(new URL("/", baseURL).href);

  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByText("総資産").first()).toBeVisible();
});

test("shows an allowlist rejection error", async ({ page }) => {
  await page.goto("/login?auth_error=allowlist_rejected");
  await expect(
    page.getByText("このアカウントではログインできません。管理者に連絡してください。"),
  ).toBeVisible();
});
