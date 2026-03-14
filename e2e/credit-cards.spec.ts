import { expect, test } from "@playwright/test";
import { navigateTo, waitForReload } from "./helpers/actions";
import { resetDatabase, seedAccount, seedBilling, seedCreditCard } from "./helpers/db";

function getJstDate(offsetMonths = 0) {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + offsetMonths, 1));
}

function toYearMonth(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("creates a credit card", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });

  await navigateTo(page, "/credit-cards");

  await page.getByLabel("カード名 *").first().fill("Visa");
  await page.getByLabel("引落日 (1-31)").first().fill("27");
  await page.getByLabel("引き落とし口座 *").first().selectOption(account.id);
  await page.getByLabel("月間仮定額 *").first().fill("50000");
  await page.getByLabel("表示順").first().fill("1");
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /Visa/ })).toContainText(formatCurrency(50000));
});

test("edits and deletes a credit card", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({
    name: "Master",
    accountId: account.id,
    assumptionAmount: 30000,
    sortOrder: 1,
  });

  await navigateTo(page, "/credit-cards");

  const row = page.getByRole("row", { name: /Master/ });
  await row.getByRole("button", { name: "編集" }).click();
  await page.getByLabel("カード名 *").last().fill("Master Gold");
  await page.getByRole("button", { name: "保存" }).click();
  await waitForReload(page);
  await expect(page.getByRole("row", { name: /Master Gold/ })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("row", { name: /Master Gold/ }).getByRole("button", { name: "削除" }).click();
  await waitForReload(page);
  await expect(page.getByText("Master Gold")).toHaveCount(0);
});

test("saves monthly billing and switches the badge to actual", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({
    name: "Visa",
    accountId: account.id,
    assumptionAmount: 50000,
    sortOrder: 1,
  });

  await navigateTo(page, "/credit-cards");

  const cardPanel = page.locator("div.grid.gap-2.rounded-2xl").filter({ hasText: "Visa" }).first();
  await cardPanel.locator('input[type="number"]').first().fill("42000");
  await page.getByRole("button", { name: "月次請求を保存" }).click();
  await waitForReload(page);

  await expect(page.locator("div.grid.gap-2.rounded-2xl").filter({ hasText: "Visa" }).first()).toContainText("実額を使用");
});

test("shows assumption badges when switching to a month without billing data", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({
    name: "Visa",
    accountId: account.id,
    assumptionAmount: 50000,
    sortOrder: 1,
  });

  await navigateTo(page, "/credit-cards");

  await page.locator('input[type="month"]').fill(toYearMonth(getJstDate(1)));
  await waitForReload(page);

  const cardPanel = page.locator("div.grid.gap-2.rounded-2xl").filter({ hasText: "Visa" }).first();
  await expect(cardPanel).toContainText("仮定値を使用");
});

test("shows applied totals including assumptions in the summary", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  const actualCard = await seedCreditCard({
    name: "Actual Card",
    accountId: account.id,
    assumptionAmount: 10000,
    sortOrder: 1,
  });
  await seedCreditCard({
    name: "Assumption Card",
    accountId: account.id,
    assumptionAmount: 20000,
    sortOrder: 2,
  });

  await seedBilling(toYearMonth(getJstDate()), [{ creditCardId: actualCard.id, amount: 12345 }]);

  await navigateTo(page, "/credit-cards");

  await expect(page.getByText("請求月サマリー").locator("..")).toContainText(formatCurrency(32345));
});

test("uses the assumption for months two ahead when the actual amount is lower", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({
    name: "Visa",
    accountId: account.id,
    assumptionAmount: 50000,
    sortOrder: 1,
  });

  await navigateTo(page, "/credit-cards");

  await page.locator('input[type="month"]').fill(toYearMonth(getJstDate(2)));

  const cardPanel = page.locator("div.grid.gap-2.rounded-2xl").filter({ hasText: "Visa" }).first();
  await cardPanel.locator('input[type="number"]').first().fill("42000");
  await page.getByRole("button", { name: "月次請求を保存" }).click();
  await waitForReload(page);

  await expect(cardPanel).toContainText("仮定値を使用");
  await expect(cardPanel).toContainText(`今月予測へ反映される額: ${formatCurrency(50000)}`);
  await expect(page.getByText("請求月サマリー").locator("..")).toContainText(formatCurrency(50000));
});
