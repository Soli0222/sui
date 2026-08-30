import { expect, test } from "@playwright/test";
import { navigateTo } from "./helpers/actions";
import { resetDatabase } from "./helpers/db";

test.beforeEach(async () => {
  await resetDatabase();
});

test("saves display defaults and reapplies them when each page is reopened", async ({ page }) => {
  await navigateTo(page, "/settings");

  const dashboardSetting = page.getByLabel("ダッシュボードの表示期間");
  const transactionsSetting = page.getByLabel("取引一覧の表示期間");

  await dashboardSetting.selectOption("next6Months");
  await expect(page.getByText("表示の既定値を保存しました", { exact: true })).toBeVisible();
  await expect(transactionsSetting).toBeEnabled();
  await transactionsSetting.selectOption("last1Year");
  await expect(transactionsSetting).toHaveValue("last1Year");
  await expect(transactionsSetting).toBeEnabled();

  await navigateTo(page, "/");
  const dashboardPeriod = page.getByLabel("予測イベントの表示期間");
  await expect(dashboardPeriod).toHaveValue("next6Months");
  await page.reload();
  await expect(dashboardPeriod).toHaveValue("next6Months");

  await dashboardPeriod.selectOption("next1Month");
  await expect(dashboardPeriod).toHaveValue("next1Month");
  await page.reload();
  await expect(dashboardPeriod).toHaveValue("next6Months");

  await navigateTo(page, "/transactions");
  const transactionsPeriod = page.getByLabel("期間プリセット");
  await expect(transactionsPeriod).toHaveValue("last1Year");
  await page.reload();
  await expect(transactionsPeriod).toHaveValue("last1Year");

  await transactionsPeriod.selectOption("all");
  await expect(transactionsPeriod).toHaveValue("all");
  await page.reload();
  await expect(transactionsPeriod).toHaveValue("last1Year");
});

test("keeps three-month built-in defaults when settings cannot be loaded", async ({ page }) => {
  await page.route("**/api/settings", (route) => route.abort());

  await navigateTo(page, "/");
  await expect(page.getByLabel("予測イベントの表示期間")).toHaveValue("next3Months");

  await navigateTo(page, "/transactions");
  await expect(page.getByLabel("期間プリセット")).toHaveValue("last3Months");
});

test("does not overwrite period changes made while settings are loading", async ({ page }) => {
  await page.route("**/api/settings", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        dashboardDefaultPeriod: "next1Year",
        transactionsDefaultPeriod: "last1Year",
      }),
    });
  });

  await navigateTo(page, "/");
  const dashboardPeriod = page.getByLabel("予測イベントの表示期間");
  await dashboardPeriod.selectOption("next1Month");
  await page.waitForTimeout(400);
  await expect(dashboardPeriod).toHaveValue("next1Month");

  await navigateTo(page, "/transactions");
  const transactionsPeriod = page.getByLabel("期間プリセット");
  await transactionsPeriod.selectOption("thisMonth");
  await page.waitForTimeout(400);
  await expect(transactionsPeriod).toHaveValue("thisMonth");
});

test("optimistically updates, locks both selects, and rolls back a failed save", async ({ page }) => {
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PUT") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "save failed" }),
      });
      return;
    }

    await route.continue();
  });

  await navigateTo(page, "/settings");
  const dashboardSetting = page.getByLabel("ダッシュボードの表示期間");
  const transactionsSetting = page.getByLabel("取引一覧の表示期間");
  await expect(dashboardSetting).toHaveValue("next3Months");

  await dashboardSetting.selectOption("next6Months");
  await expect(dashboardSetting).toHaveValue("next6Months");
  await expect(dashboardSetting).toBeDisabled();
  await expect(transactionsSetting).toBeDisabled();

  await expect(
    page.getByText("表示の既定値の保存に失敗しました", { exact: true }),
  ).toBeVisible();
  await expect(dashboardSetting).toHaveValue("next3Months");
  await expect(dashboardSetting).toBeEnabled();
  await expect(transactionsSetting).toBeEnabled();
});
