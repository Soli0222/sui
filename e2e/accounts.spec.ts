import { expect, test } from "@playwright/test";
import { fillAndSubmitAccountForm, navigateTo, waitForReload } from "./helpers/actions";
import { resetDatabase, seedAccount } from "./helpers/db";

function formatCurrency(value: number, currency = "JPY") {
  return new Intl.NumberFormat(currency === "JPY" ? "ja-JP" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "JPY" ? 0 : 2,
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
  }).format(value);
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("creates an account and shows formatted balance", async ({ page }) => {
  await navigateTo(page, "/accounts");
  await fillAndSubmitAccountForm(page, {
    name: "Wallet",
    balance: 123456,
    balanceOffset: 23456,
    sortOrder: 2,
  });
  await waitForReload(page);

  const row = page.getByRole("row", { name: /Wallet/ }).first();
  await expect(row).toContainText(formatCurrency(123456));
  await expect(row).toContainText(formatCurrency(100000));
});

test("creates a foreign-currency account and shows the JPY equivalent", async ({ page }) => {
  await navigateTo(page, "/accounts");
  await fillAndSubmitAccountForm(page, {
    name: "USD Wallet",
    balance: 1234.56,
    balanceOffset: 34.56,
    currencyCode: "USD",
    exchangeRateToJpy: 150,
    sortOrder: 3,
  });
  await waitForReload(page);

  const row = page.getByRole("row", { name: /USD Wallet/ }).first();
  await expect(row).toContainText("USD");
  await expect(row).toContainText(formatCurrency(1234.56, "USD"));
  await expect(row).toContainText(formatCurrency(185184));
  await expect(row).toContainText(formatCurrency(1200, "USD"));
  await expect(row).toContainText(formatCurrency(180000));
  await expect(row).toContainText("150 JPY");
});

test("edits an account", async ({ page }) => {
  await seedAccount({ name: "Old Name", balance: 1000, balanceOffset: 100, sortOrder: 1 });

  await navigateTo(page, "/accounts");

  const row = page.getByRole("row", { name: /Old Name/ }).first();
  await row.getByRole("button", { name: "編集" }).click();
  await page.getByLabel("口座名 *").last().fill("Updated Name");
  await page.getByLabel("現在残高 (JPY)").last().fill("5000");
  await page.getByLabel("オフセット (JPY)").last().fill("500");
  await page.getByRole("button", { name: "保存" }).click();
  await waitForReload(page);

  const updatedRow = page.getByRole("row", { name: /Updated Name/ }).first();
  await expect(updatedRow).toContainText(formatCurrency(5000));
  await expect(updatedRow).toContainText(formatCurrency(4500));
});

test("reconciles an account and records an adjustment transaction", async ({ page }) => {
  await seedAccount({ name: "Reconcile Target", balance: 1000, sortOrder: 1 });

  await navigateTo(page, "/accounts");

  const row = page.getByRole("row", { name: /Reconcile Target/ }).first();
  await row.getByRole("button", { name: "照合" }).click();
  await page.getByLabel("実残高 (JPY)").fill("1500");
  await expect(page.getByText(`+${formatCurrency(500)}`)).toBeVisible();
  await page.getByRole("button", { name: "照合を実行" }).click();
  await waitForReload(page);

  const updatedRow = page.getByRole("row", { name: /Reconcile Target/ }).first();
  await expect(updatedRow).toContainText(formatCurrency(1500));

  await navigateTo(page, "/transactions");
  const adjustmentRow = page.getByRole("row", { name: /残高照合/ }).first();
  await expect(adjustmentRow).toContainText("調整");
  await expect(adjustmentRow).toContainText(`+${formatCurrency(500)}`);
});

test("deletes an account", async ({ page }) => {
  await seedAccount({ name: "Delete Target", balance: 1000, sortOrder: 1 });

  await navigateTo(page, "/accounts");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("row", { name: /Delete Target/ }).first().getByRole("button", { name: "削除" }).click();
  await waitForReload(page);

  await expect(page.getByText("Delete Target")).toHaveCount(0);
});
