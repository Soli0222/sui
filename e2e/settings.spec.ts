import { expect, test } from "./helpers/test";
import { navigateTo } from "./helpers/actions";

for (const viewport of [{ name: "desktop", width: 1280, height: 900 }, { name: "mobile", width: 375, height: 700 }]) {
  test(`display defaults offer only a right-aligned save action on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await navigateTo(page, "/settings");
    const editor = page.getByRole("region", { name: "表示の既定値" });
    const dashboardSetting = editor.getByLabel("ダッシュボードの表示期間");
    const transactionsSetting = editor.getByLabel("取引一覧の表示期間");
    const save = editor.getByRole("button", { name: "変更を保存" });
    await expect(editor.getByRole("heading", { name: "表示の既定値" })).toBeVisible();
    await expect(dashboardSetting).toBeVisible();
    await expect(transactionsSetting).toBeVisible();
    await expect(editor.locator("button")).toHaveCount(1);
    await expect(editor.getByRole("button", { name: /閉じる|キャンセル|リセット|元に戻す/ })).toHaveCount(0);
    await expect(save).toBeDisabled();
    await expect(save.locator("..")).toHaveClass(/justify-end/);
    await dashboardSetting.selectOption("next6Months");
    await expect(save).toBeEnabled();
    await transactionsSetting.focus();
    await page.keyboard.press("Tab");
    await expect(save).toBeFocused();
    await expect(editor.locator("button")).toHaveCount(1);
  });
}

test("unsaved display defaults survive continued editing and are discarded on exit", async ({ page }) => {
  let saves = 0;
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PUT") saves += 1;
    await route.continue();
  });
  await navigateTo(page, "/");
  await page.locator('a[href="/settings"]:visible').first().click();
  const editor = page.getByRole("region", { name: "表示の既定値" });
  const dashboardSetting = editor.getByLabel("ダッシュボードの表示期間");
  await expect(dashboardSetting).toHaveValue("next3Months");
  await dashboardSetting.selectOption("next6Months");
  await expect.poll(() => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);

  await page.locator('a[href="/transactions"]:visible').first().click();
  const discard = page.getByRole("dialog", { name: "未保存の変更を破棄しますか？" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "編集を続ける" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(dashboardSetting).toHaveValue("next6Months");

  await page.goBack();
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "編集を続ける" }).click();
  await expect(dashboardSetting).toHaveValue("next6Months");

  await page.locator('a[href="/transactions"]:visible').first().click();
  await discard.getByRole("button", { name: "変更を破棄" }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  expect(saves).toBe(0);
  await navigateTo(page, "/settings");
  await expect(page.getByRole("region", { name: "表示の既定値" }).getByLabel("ダッシュボードの表示期間")).toHaveValue("next3Months");
});

test("saves display defaults and reapplies them when each page is reopened", async ({ page }) => {
  await navigateTo(page, "/settings");

  const dashboardSetting = page.getByLabel("ダッシュボードの表示期間");
  const transactionsSetting = page.getByLabel("取引一覧の表示期間");

  await dashboardSetting.selectOption("next6Months");
  await transactionsSetting.selectOption("last1Year");
  await expect(transactionsSetting).toHaveValue("last1Year");
  await expect(page.getByText("未保存の変更")).toBeVisible();
  await expect(page.getByText(/ダッシュボードの表示期間:/).locator("..")).toContainText("3ヶ月 → 6ヶ月");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(page.getByText("表示の既定値を保存しました", { exact: true })).toBeVisible();

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

test("keeps the display-default draft after a failed explicit save", async ({ page }) => {
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
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(dashboardSetting).toBeDisabled();
  await expect(transactionsSetting).toBeDisabled();

  await expect(page.getByRole("alert")).toContainText("save failed");
  await expect(dashboardSetting).toHaveValue("next6Months");
  await expect(dashboardSetting).toBeEnabled();
  await expect(transactionsSetting).toBeEnabled();
});

test("retries only the display refresh after a successful save", async ({ page }) => {
  let saves = 0;
  let failRefresh = false;
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PUT") {
      saves += 1;
      failRefresh = true;
      await route.continue();
      return;
    }
    if (failRefresh) {
      failRefresh = false;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "refresh failed" }) });
      return;
    }
    await route.continue();
  });
  await navigateTo(page, "/settings");
  const editor = page.getByRole("region", { name: "表示の既定値" });
  const dashboardSetting = editor.getByLabel("ダッシュボードの表示期間");
  await expect(dashboardSetting).toHaveValue("next3Months");
  await dashboardSetting.selectOption("next6Months");
  const save = editor.getByRole("button", { name: "変更を保存" });
  await save.click();
  await expect(editor.getByRole("alert")).toContainText("refresh failed");
  await expect(save).toBeDisabled();
  await expect(dashboardSetting).toBeDisabled();
  await expect(editor.getByRole("button", { name: "表示を再取得" })).toBeVisible();
  await editor.getByRole("button", { name: "表示を再取得" }).click();
  await expect(editor.getByRole("status")).toContainText("保存済み");
  await expect(dashboardSetting).toHaveValue("next6Months");
  expect(saves).toBe(1);
});
