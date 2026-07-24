import { expect, test } from "@playwright/test";
import { navigateTo } from "./helpers/actions";
import { resetDatabase } from "./helpers/db";

test.beforeEach(async ({ page }) => {
  await resetDatabase();
  page.on("dialog", (dialog) => dialog.accept());
});

test.describe("authentication and settings", () => {
  test("issues and revokes an API token on the settings page", async ({ page }) => {
    await navigateTo(page, "/settings");

    await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();

    await page.getByRole("button", { name: "トークンを発行" }).click();

    await page.getByLabel("用途").fill("e2e-test");
    await page.getByRole("button", { name: "発行" }).click();

    const tokenInput = page.locator('input[readonly][class*="font-mono"]');
    await expect(tokenInput).toBeVisible();
    const token = await tokenInput.inputValue();
    expect(token).toMatch(/^sui_tok_/);

    await page.getByRole("button", { name: "閉じる" }).click();

    await expect(page.getByText("e2e-test").first().locator("xpath=../..")).toContainText("読み書き");

    await page.getByText("e2e-test").first().locator("xpath=../..").getByRole("button", { name: "失効" }).click();

    await expect(page.getByText("トークンはまだ発行されていません。")).toBeVisible();
  });
});
