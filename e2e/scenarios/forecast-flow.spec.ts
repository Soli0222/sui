import { expect, test } from "@playwright/test";
import { fillAndSubmitAccountForm, navigateTo, waitForReload } from "../helpers/actions";
import { resetDatabase } from "../helpers/db";
import { formatCurrency } from "../helpers/scenario";

test.beforeEach(async () => {
  await resetDatabase();
});

test("reflects newly created accounts and recurring items on the dashboard forecast", async ({ page }) => {
  await navigateTo(page, "/accounts");
  await fillAndSubmitAccountForm(page, {
    name: "メイン口座",
    balance: 500000,
    sortOrder: 1,
  });
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /メイン口座/ }).first()).toContainText(formatCurrency(500000));

  await navigateTo(page, "/recurring");

  await page.getByLabel("カテゴリ名 *").first().fill("給料");
  await page.getByLabel("種別").first().selectOption("income");
  await page.getByLabel("金額 (円)").first().fill("250000");
  await page.getByLabel("毎月の発生日 (1-31)").first().fill("25");
  await page.getByLabel("振り込み先口座 *").selectOption({ label: "メイン口座" });
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /給料/ })).toContainText("収入");

  await page.getByLabel("カテゴリ名 *").first().fill("家賃");
  await page.getByLabel("種別").first().selectOption("expense");
  await page.getByLabel("金額 (円)").first().fill("80000");
  await page.getByLabel("毎月の発生日 (1-31)").first().fill("27");
  await page.getByLabel("引き落とし口座 *").selectOption({ label: "メイン口座" });
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /家賃/ })).toContainText("支出");

  await navigateTo(page, "/");

  await expect(page.getByText("総所持金").locator("..")).toContainText(formatCurrency(500000));
  await expect(page.getByText("次の収入").locator("..")).toContainText("給料");
  await expect(page.getByText("次の支出").locator("..")).toContainText("家賃");

  const forecastTable = page.locator("table").last();
  await expect(forecastTable.getByRole("cell", { name: "給料" }).first()).toBeVisible();
  await expect(forecastTable.getByRole("cell", { name: "家賃" }).first()).toBeVisible();
  await expect(page.locator("svg.recharts-surface")).toBeVisible();
});
