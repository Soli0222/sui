import { expect, test } from "@playwright/test";
import { navigateTo, waitForReload } from "../helpers/actions";
import { resetDatabase, seedAccount } from "../helpers/db";
import { formatCurrency, getFutureDate } from "../helpers/scenario";

test.beforeEach(async () => {
  await resetDatabase();
});

test("creates a loan, reflects it on the dashboard, and updates the snapshot after confirmation", async ({ page }) => {
  await seedAccount({ name: "支払口座", balance: 200000, sortOrder: 1 });

  await navigateTo(page, "/loans");

  await page.getByLabel("商品名 *").first().fill("PCローン");
  await page.getByLabel("総支払額 *").first().fill("60000");
  await page.getByLabel("初回引落日 *").fill(getFutureDate(7));
  await page.getByLabel("支払回数 *").fill("6");
  await page.getByLabel("引き落とし口座 *").first().selectOption({ label: "支払口座" });

  await expect(page.getByText("月々の支払額プレビュー:").locator("..")).toContainText(formatCurrency(10000));

  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);
  await expect(page.getByText("PCローン")).toBeVisible();

  await navigateTo(page, "/");

  const forecastTable = page.locator("table").last();
  const loanCells = forecastTable.getByRole("cell", { name: "ローン: PCローン" });
  await expect(loanCells.first()).toBeVisible();
  const beforeCount = await loanCells.count();
  await expect(forecastTable.getByRole("row").filter({ has: page.getByText("ローン: PCローン") }).first()).toContainText(formatCurrency(10000));

  await page.getByRole("button", { name: "確定" }).first().click();
  await expect(page.getByRole("heading", { name: "予測イベントを確定" })).toBeVisible();
  await page.getByRole("button", { name: "確定する" }).click();
  await waitForReload(page);

  await expect(forecastTable.getByRole("cell", { name: "ローン: PCローン" })).toHaveCount(beforeCount - 1);

  await navigateTo(page, "/accounts");
  await expect(page.getByRole("row", { name: /支払口座/ }).first()).toContainText(formatCurrency(190000));

  await navigateTo(page, "/loans");
  const loanCard = page.locator("div.grid.gap-4.rounded-2xl").filter({ hasText: "PCローン" }).first();
  await expect(loanCard).toContainText(formatCurrency(50000));
  await expect(loanCard).toContainText("残り 5 回");
});
