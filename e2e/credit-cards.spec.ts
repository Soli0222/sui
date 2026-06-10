import { expect, test, type Page } from "@playwright/test";
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

function billingTable(page: Page) {
  return page.getByRole("table").first();
}

function billingRow(page: Page, cardName: string) {
  return billingTable(page).getByRole("row", { name: new RegExp(cardName) });
}

function billingInput(page: Page, cardName: string) {
  return billingRow(page, cardName).getByLabel(`${cardName} 実額`);
}

function cardListTable(page: Page) {
  return page.getByRole("table").last();
}

function cardListRow(page: Page, cardName: string) {
  return cardListTable(page).getByRole("row", { name: new RegExp(cardName) });
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("creates a credit card", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });

  await navigateTo(page, "/credit-cards");

  await page.getByRole("button", { name: "カードを追加" }).click();
  await page.getByLabel("カード名 *").first().fill("Visa");
  await page.getByLabel("引落日 (1-31)").first().fill("27");
  await page.getByLabel("引き落とし口座 *").first().selectOption(account.id);
  await page.getByLabel("月間仮定額 *").first().fill("50000");
  await page.getByLabel("表示順").first().fill("1");
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  await expect(cardListRow(page, "Visa")).toContainText(formatCurrency(50000));
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

  const row = cardListRow(page, "Master");
  await row.getByRole("button", { name: "編集" }).click();
  await page.getByLabel("カード名 *").last().fill("Master Gold");
  await page.getByRole("button", { name: "保存" }).click();
  await waitForReload(page);
  await expect(cardListRow(page, "Master Gold")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await cardListRow(page, "Master Gold").getByRole("button", { name: "削除" }).click();
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

  await billingInput(page, "Visa").fill("42000");
  await expect(page.getByText("未保存の変更あり")).toBeVisible();
  await page.getByRole("button", { name: "月次請求を保存" }).click();
  await waitForReload(page);

  await expect(billingRow(page, "Visa")).toContainText("実額を使用");
  await expect(page.getByRole("button", { name: "月次請求を保存" })).toBeDisabled();
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

  await expect(billingRow(page, "Visa")).toContainText("仮定値を使用");
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

test("validates monthly billing changes and confirms before switching months", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({
    name: "Visa",
    accountId: account.id,
    assumptionAmount: 50000,
    sortOrder: 1,
  });

  await navigateTo(page, "/credit-cards");

  const saveButton = page.getByRole("button", { name: "月次請求を保存" });
  await expect(saveButton).toBeDisabled();

  await billingInput(page, "Visa").fill("-1");
  await expect(billingRow(page, "Visa").getByText("0円以上で入力してください")).toBeVisible();
  await expect(saveButton).toBeDisabled();

  await billingInput(page, "Visa").fill("42000");
  await expect(page.getByText("未保存の変更あり")).toBeVisible();
  await expect(saveButton).toBeEnabled();
  await expect(billingRow(page, "Visa")).toContainText("実額を使用");
  await expect(page.getByText("請求月サマリー").locator("..")).toContainText(formatCurrency(42000));

  const monthInput = page.locator('input[type="month"]');
  const currentMonth = await monthInput.inputValue();
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("未保存の月次請求");
    dialog.dismiss();
  });
  await monthInput.fill(toYearMonth(getJstDate(1)));
  await expect(monthInput).toHaveValue(currentMonth);
});

test("copies previous month actual amounts and supports keyboard entry across cards", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  const visa = await seedCreditCard({
    name: "Visa",
    accountId: account.id,
    assumptionAmount: 50000,
    sortOrder: 1,
  });
  const master = await seedCreditCard({
    name: "Master",
    accountId: account.id,
    assumptionAmount: 30000,
    sortOrder: 2,
  });
  await seedBilling(toYearMonth(getJstDate(-1)), [
    { creditCardId: visa.id, amount: 43210 },
    { creditCardId: master.id, amount: 21000 },
  ]);

  await navigateTo(page, "/credit-cards");

  await page.getByRole("button", { name: "前月の実額をコピー" }).click();
  await expect(billingInput(page, "Visa")).toHaveValue("43210");
  await expect(billingInput(page, "Master")).toHaveValue("21000");
  await expect(page.getByText("未保存の変更あり")).toBeVisible();

  await billingInput(page, "Visa").focus();
  await page.keyboard.press("Enter");
  await expect(billingInput(page, "Master")).toBeFocused();
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

  const row = billingRow(page, "Visa");
  await billingInput(page, "Visa").fill("42000");
  await page.getByRole("button", { name: "月次請求を保存" }).click();
  await waitForReload(page);

  await expect(row).toContainText("仮定値を使用");
  await expect(row).toContainText(formatCurrency(50000));
  await expect(page.getByText("請求月サマリー").locator("..")).toContainText(formatCurrency(50000));
});
