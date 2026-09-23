import { expect, test } from "../helpers/test";
import { navigateTo, waitForReload } from "../helpers/actions";
import { seedAccount, seedBilling, seedCreditCard } from "../helpers/db";
import { formatCurrency, getForecastDayOfMonth, getYearMonth } from "../helpers/scenario";

test("reflects saved credit card billing amounts on the dashboard forecast", async ({ page }) => {
  const billingYearMonth = getYearMonth(1);
  const account = await seedAccount({ name: "引落口座", balance: 400000, sortOrder: 1 });
  await seedCreditCard({
    name: "メインカード",
    accountId: account.id,
    settlementDay: getForecastDayOfMonth(),
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

  await page.locator('input[type="month"]').fill(billingYearMonth);
  await waitForReload(page);

  const billingRow = page.getByRole("table").first().getByRole("row", { name: /メインカード/ });
  await billingRow.getByLabel("メインカード 実額").fill("125000");
  await page.getByRole("button", { name: "請求額を保存" }).click();
  await waitForReload(page);
  await expect(billingRow).toContainText("実額を使用");

  await navigateTo(page, "/");

  const actualRow = page.locator("table").last().getByRole("row").filter({
    has: page.getByText("メインカード 引き落とし"),
  }).first();
  await expect(actualRow).toContainText(formatCurrency(125000));
});

test("switches assumptions by billing month and keeps the old card's actual", async ({ page }) => {
  const currentMonth = getYearMonth();
  const nextMonth = getYearMonth(1);
  const account = await seedAccount({ name: "切替口座", balance: 500000 });
  const oldCard = await seedCreditCard({ name: "旧カード", accountId: account.id, assumptionAmount: 120000, assumptionEndMonth: currentMonth });
  await seedCreditCard({ name: "新カード", accountId: account.id, assumptionAmount: 120000, assumptionStartMonth: nextMonth });
  await seedBilling(nextMonth, [{ creditCardId: oldCard.id, amount: 30000 }]);

  await navigateTo(page, "/credit-cards");
  await expect(page.getByRole("table").last().getByRole("row", { name: /旧カード/ })).toContainText(currentMonth);
  await page.locator('input[type="month"]').first().fill(nextMonth);
  await waitForReload(page);
  const billingTable = page.getByRole("table").first();
  await expect(billingTable.getByRole("row", { name: /旧カード/ })).toContainText(formatCurrency(30000));
  await expect(billingTable.getByRole("row", { name: /旧カード/ })).toContainText("実額を使用");
  await expect(billingTable.getByRole("row", { name: /新カード/ })).toContainText(formatCurrency(120000));
  await expect(billingTable.getByRole("row", { name: /合計/ })).toContainText(formatCurrency(150000));

  await navigateTo(page, "/");
  const forecastTable = page.locator("table").last();
  await expect(forecastTable.getByRole("row").filter({ hasText: `旧カード 引き落とし (${nextMonth})` }).first()).toContainText(formatCurrency(30000));
  await expect(forecastTable.getByRole("row").filter({ hasText: `新カード 仮定値 (${nextMonth})` }).first()).toContainText(formatCurrency(120000));
});

test("uses two different assumption amounts for one card", async ({ page }) => {
  const firstMonth = getYearMonth(1);
  const secondMonth = getYearMonth(2);
  const account = await seedAccount({ name: "変動口座", balance: 500000 });
  await seedCreditCard({ name: "変動カード", accountId: account.id, assumptions: [
    { amount: 120000, startMonth: firstMonth, endMonth: firstMonth },
    { amount: 80000, startMonth: secondMonth, endMonth: secondMonth },
  ] });

  await navigateTo(page, "/credit-cards");
  const cardRow = page.getByRole("table").last().getByRole("row", { name: /変動カード/ });
  await expect(cardRow).toContainText(formatCurrency(120000));
  await expect(cardRow).toContainText(formatCurrency(80000));

  await page.locator('input[type="month"]').first().fill(firstMonth);
  await waitForReload(page);
  await expect(page.getByRole("table").first().getByRole("row", { name: /合計/ })).toContainText(formatCurrency(120000));
  await page.locator('input[type="month"]').first().fill(secondMonth);
  await waitForReload(page);
  await expect(page.getByRole("table").first().getByRole("row", { name: /合計/ })).toContainText(formatCurrency(80000));

  await navigateTo(page, "/");
  const forecastTable = page.locator("table").last();
  await expect(forecastTable.getByRole("row").filter({ hasText: `変動カード 仮定値 (${firstMonth})` }).first()).toContainText(formatCurrency(120000));
  await expect(forecastTable.getByRole("row").filter({ hasText: `変動カード 仮定値 (${secondMonth})` }).first()).toContainText(formatCurrency(80000));
});
