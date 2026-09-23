import { expect, test } from "./helpers/test";
import { fillAndSubmitAccountForm, navigateTo, waitForReload } from "./helpers/actions";
import { seedAccount } from "./helpers/db";

function formatCurrency(value: number, currency = "JPY") {
  return new Intl.NumberFormat(currency === "JPY" ? "ja-JP" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "JPY" ? 0 : 2,
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
  }).format(value);
}

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

test("separates basic account editing from balance correction", async ({ page }) => {
  await seedAccount({ name: "Old Name", balance: 1000, balanceOffset: 100, sortOrder: 1 });

  await navigateTo(page, "/accounts");

  const row = page.getByRole("row", { name: /Old Name/ }).first();
  await row.getByRole("button", { name: "編集" }).click();
  const edit = page.getByRole("dialog");
  await edit.getByLabel("口座名 *").fill("Updated Name");
  await expect(edit.getByText("現在残高（参考）")).toBeVisible();
  await edit.getByLabel("オフセット (JPY)").fill("500");
  await edit.getByRole("button", { name: "変更を保存" }).click();
  await waitForReload(page);

  const updatedRow = page.getByRole("row", { name: /Updated Name/ }).first();
  await expect(updatedRow).toContainText(formatCurrency(1000));
  await expect(updatedRow).toContainText(formatCurrency(500));
  await updatedRow.getByRole("button", { name: "残高を訂正" }).click();
  await page.getByRole("dialog").getByLabel("訂正後残高 (JPY)").fill("5000");
  await page.getByRole("dialog").getByRole("button", { name: "訂正を保存" }).click();
  await waitForReload(page);
  await expect(updatedRow).toContainText(formatCurrency(5000));
  await expect(updatedRow).toContainText(formatCurrency(4500));
  await navigateTo(page, "/transactions");
  await expect(page.getByRole("row", { name: /残高調整（口座編集）/ })).toContainText(formatCurrency(4000));
});

test("keeps account edits after a failed save and blocks duplicate requests", async ({ page }) => {
  await seedAccount({ name: "Retry Account", balance: 1000, sortOrder: 1 });
  let puts = 0;
  await page.route("**/api/accounts/*", async (route) => {
    if (route.request().method() !== "PUT") { await route.continue(); return; }
    puts += 1;
    if (puts === 1) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "一時的な失敗" }) });
      return;
    }
    await route.continue();
  });
  await navigateTo(page, "/accounts");
  await page.getByRole("row", { name: /Retry Account/ }).getByRole("button", { name: "編集" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("口座名 *").fill("Saved Account");
  await dialog.getByRole("button", { name: "変更を保存" }).click();
  await expect(dialog.getByRole("alert")).toContainText("一時的な失敗");
  await expect(dialog.getByLabel("口座名 *")).toHaveValue("Saved Account");
  await dialog.getByRole("button", { name: "変更を保存" }).dispatchEvent("click");
  await dialog.getByRole("button", { name: "変更を保存" }).dispatchEvent("click");
  await expect(page.getByRole("row", { name: /Saved Account/ })).toBeVisible();
  expect(puts).toBe(2);
});

test("corrects a USD account with signed cents", async ({ page }) => {
  await seedAccount({ name: "Dollar Balance", balance: 1000, currencyCode: "USD", exchangeRateToJpy: 150 });
  await navigateTo(page, "/accounts");
  await page.getByRole("row", { name: /Dollar Balance/ }).getByRole("button", { name: "残高を訂正" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("訂正後残高 (USD)").fill("-12.34");
  await dialog.getByRole("button", { name: "訂正を保存" }).click();
  await expect(page.getByRole("row", { name: /Dollar Balance/ })).toContainText(formatCurrency(-12.34, "USD"));
});

test("reconciles an account and records an adjustment transaction", async ({ page }) => {
  await seedAccount({ name: "Reconcile Target", balance: 1000, sortOrder: 1 });

  await navigateTo(page, "/accounts");

  const row = page.getByRole("row", { name: /Reconcile Target/ }).first();
  await row.getByRole("button", { name: "照合" }).click();
  await page.getByLabel("実残高 (JPY)").fill("1500");
  await expect(page.getByText(`+${formatCurrency(500)}`)).toBeVisible();
  await page.getByRole("button", { name: "照合を記録" }).click();
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

  await page.getByRole("row", { name: /Delete Target/ }).first().getByRole("button", { name: "削除" }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await waitForReload(page);

  await expect(page.getByText("Delete Target")).toHaveCount(0);
});
