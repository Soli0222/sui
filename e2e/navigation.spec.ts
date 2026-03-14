import { expect, test } from "@playwright/test";
import { navigateTo } from "./helpers/actions";
import { resetDatabase } from "./helpers/db";

test.beforeEach(async () => {
  await resetDatabase();
});

test("navigates using sidebar links", async ({ page }) => {
  await navigateTo(page, "/");

  await page.getByRole("link", { name: "口座管理" }).click();
  await expect(page.getByRole("heading", { name: "口座を追加" })).toBeVisible();

  await page.getByRole("link", { name: "固定収支" }).click();
  await expect(page.getByRole("heading", { name: "固定収支を追加" })).toBeVisible();
});

test("renders correctly on direct URL access", async ({ page }) => {
  await page.goto("/accounts");
  await expect(page.getByRole("heading", { name: "口座を追加" })).toBeVisible();

  await page.goto("/credit-cards");
  await expect(page.getByRole("heading", { name: "月別請求入力" })).toBeVisible();
});

test("redirects unknown paths to the dashboard", async ({ page }) => {
  await page.goto("/nonexistent");

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "所持金推移" })).toBeVisible();
});
