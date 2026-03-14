import { expect, test } from "@playwright/test";
import { fillAndSubmitAccountForm, navigateTo, waitForReload } from "./helpers/actions";
import { resetDatabase, seedAccount } from "./helpers/db";

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

test("creates an account and shows formatted balance", async ({ page }) => {
  await navigateTo(page, "/accounts");
  await fillAndSubmitAccountForm(page, {
    name: "Wallet",
    balance: 123456,
    sortOrder: 2,
  });
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /Wallet/ }).first()).toContainText(formatCurrency(123456));
});

test("edits an account", async ({ page }) => {
  await seedAccount({ name: "Old Name", balance: 1000, sortOrder: 1 });

  await navigateTo(page, "/accounts");

  const row = page.getByRole("row", { name: /Old Name/ }).first();
  await row.getByRole("button", { name: "編集" }).click();
  await page.getByLabel("口座名 *").last().fill("Updated Name");
  await page.getByLabel("現在残高 (円)").last().fill("5000");
  await page.getByRole("button", { name: "保存" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /Updated Name/ }).first()).toContainText(formatCurrency(5000));
});

test("deletes an account", async ({ page }) => {
  await seedAccount({ name: "Delete Target", balance: 1000, sortOrder: 1 });

  await navigateTo(page, "/accounts");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("row", { name: /Delete Target/ }).first().getByRole("button", { name: "削除" }).click();
  await waitForReload(page);

  await expect(page.getByText("Delete Target")).toHaveCount(0);
});
