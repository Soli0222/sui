import { expect, test } from "@playwright/test";
import { navigateTo, waitForReload } from "../helpers/actions";
import { resetDatabase, seedAccount, seedCreditCard } from "../helpers/db";
import { formatCurrency } from "../helpers/scenario";

test.beforeEach(async () => {
  await resetDatabase();
});

test("reflects saved credit card billing amounts on the dashboard forecast", async ({ page }) => {
  const account = await seedAccount({ name: "引落口座", balance: 400000, sortOrder: 1 });
  await seedCreditCard({
    name: "メインカード",
    accountId: account.id,
    settlementDay: 27,
    assumptionAmount: 100000,
    sortOrder: 1,
  });

  await navigateTo(page, "/");

  const forecastTable = page.locator("table").last();
  const assumedRow = forecastTable.getByRole("row").filter({
    has: page.getByText("メインカード 仮定値"),
  }).first();
  await expect(assumedRow).toContainText(formatCurrency(100000));

  await navigateTo(page, "/credit-cards");

  const cardPanel = page.locator("div.grid.gap-2.rounded-2xl").filter({ hasText: "メインカード" }).first();
  await cardPanel.locator('input[type="number"]').first().fill("75000");
  await page.getByRole("button", { name: "月次請求を保存" }).click();
  await waitForReload(page);
  await expect(cardPanel).toContainText("実額を使用");

  await navigateTo(page, "/");

  const actualRow = page.locator("table").last().getByRole("row").filter({
    has: page.getByText("メインカード 引き落とし"),
  }).first();
  await expect(actualRow).toContainText(formatCurrency(75000));
});
