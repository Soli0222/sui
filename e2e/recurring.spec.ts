import { expect, test } from "@playwright/test";
import { navigateTo, waitForReload } from "./helpers/actions";
import { resetDatabase, seedAccount, seedRecurringItem } from "./helpers/db";

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

test("creates an income recurring item", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/recurring");

  await page.getByRole("button", { name: "固定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("Salary");
  await page.getByRole("radio", { name: "収入" }).first().click();
  await page.getByLabel("金額 (JPY)").first().fill("300000");
  await page.getByLabel("毎月の発生日").first().fill("25");
  await page.getByLabel("振り込み先口座 *").selectOption(account.id);
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /Salary/ })).toContainText("収入");
});

test("creates an expense recurring item with a period", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/recurring");

  await page.getByRole("button", { name: "固定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("Rent");
  await page.getByRole("radio", { name: "支出" }).first().click();
  await page.getByLabel("金額 (JPY)").first().fill("80000");
  await page.getByLabel("毎月の発生日").first().fill("27");
  await page.getByLabel("開始日").first().fill("2026-03-01");
  await page.getByLabel("終了日").first().fill("2026-12-31");
  await page.getByLabel("引き落とし口座 *").selectOption(account.id);
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const row = page.getByRole("row", { name: /Rent/ });
  await expect(row).toContainText("支出");
  await expect(row).toContainText("2026年3月1日 〜 2026年12月31日");
});

test("edits a recurring item", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });
  await seedRecurringItem({
    name: "Subscription",
    amount: 1000,
    dayOfMonth: 5,
    accountId: account.id,
    sortOrder: 1,
  });

  await navigateTo(page, "/recurring");

  const row = page.getByRole("row", { name: /Subscription/ });
  await row.getByRole("button", { name: "編集" }).click();
  await page.getByLabel("金額 (JPY)").last().fill("2500");
  await page.getByRole("button", { name: "保存" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /Subscription/ })).toContainText(formatCurrency(2500));
});

test("keeps recurring item date shift policy through create and edit", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/recurring");

  await page.getByRole("button", { name: "固定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("Shifted Rent");
  await page.getByRole("radio", { name: "支出" }).first().click();
  await page.getByLabel("金額 (JPY)").first().fill("80000");
  await page.getByLabel("毎月の発生日").first().fill("31");
  await page.getByLabel("土日祝の扱い").first().selectOption("next");
  await page.getByLabel("引き落とし口座 *").selectOption(account.id);
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const row = page.getByRole("row", { name: /Shifted Rent/ });
  await row.getByRole("button", { name: "編集" }).click();
  await expect(page.getByLabel("土日祝の扱い").last()).toHaveValue("next");

  await page.getByLabel("金額 (JPY)").last().fill("81000");
  await page.getByRole("button", { name: "保存" }).click();
  await waitForReload(page);

  const updatedRow = page.getByRole("row", { name: /Shifted Rent/ });
  await expect(updatedRow).toContainText(formatCurrency(81000));
  await updatedRow.getByRole("button", { name: "編集" }).click();
  await expect(page.getByLabel("土日祝の扱い").last()).toHaveValue("next");
});

test("deletes a recurring item", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });
  await seedRecurringItem({
    name: "To Delete",
    amount: 1000,
    dayOfMonth: 5,
    accountId: account.id,
    sortOrder: 1,
  });

  await navigateTo(page, "/recurring");

  await page.getByRole("row", { name: /To Delete/ }).getByRole("button", { name: "削除" }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await waitForReload(page);

  await expect(page.getByText("To Delete")).toHaveCount(0);
});

test("creates and edits a weekly recurring item", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/recurring");

  await page.getByRole("button", { name: "固定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("Lunch");
  await page.getByRole("radio", { name: "支出" }).first().click();
  await page.getByLabel("金額 (JPY)").first().fill("1000");
  await page.getByRole("radio", { name: "毎週" }).first().click();
  await page.getByLabel("曜日").first().selectOption("5");
  await page.getByLabel("引き落とし口座 *").selectOption(account.id);
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const row = page.getByRole("row", { name: /Lunch/ });
  await expect(row).toContainText("毎週 金曜日");

  await row.getByRole("button", { name: "編集" }).click();
  await page.getByLabel("曜日").last().selectOption("6");
  await page.getByRole("button", { name: "保存" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /Lunch/ })).toContainText("毎週 土曜日");
});

test("creates a transfer with only a destination account and edits it", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/recurring");

  await page.getByRole("button", { name: "固定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("External In");
  await page.getByRole("radio", { name: "振替" }).first().click();
  await page.getByLabel("金額 (JPY)").first().fill("10000");
  await page.getByLabel("毎月の発生日").first().fill("10");
  await page.getByLabel("送金元口座").first().selectOption("");
  await page.getByLabel("振替先口座").first().selectOption(account.id);
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const row = page.getByRole("row", { name: /External In/ });
  await expect(row).toContainText("未設定 → Main Account");

  await row.getByRole("button", { name: "編集" }).click();
  await page.getByLabel("送金元口座").last().selectOption(account.id);
  await page.getByLabel("振替先口座").last().selectOption("");
  await page.getByRole("button", { name: "保存" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /External In/ })).toContainText("Main Account → 未設定");
});

test("creates a transfer with only a source account and disables save when both accounts are empty", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/recurring");

  await page.getByRole("button", { name: "固定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("External Out");
  await page.getByRole("radio", { name: "振替" }).first().click();
  await page.getByLabel("金額 (JPY)").first().fill("5000");
  await page.getByLabel("毎月の発生日").first().fill("20");
  await page.getByLabel("送金元口座").first().selectOption(account.id);
  await page.getByLabel("振替先口座").first().selectOption("");
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /External Out/ })).toContainText("Main Account → 未設定");

  await page.getByRole("button", { name: "固定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("No Accounts");
  await page.getByRole("radio", { name: "振替" }).first().click();
  await page.getByLabel("金額 (JPY)").first().fill("1000");
  await page.getByLabel("毎月の発生日").first().fill("15");
  await page.getByLabel("送金元口座").first().selectOption("");
  await expect(page.getByRole("button", { name: "追加" })).toBeDisabled();
});

test("creates a USD recurring item and displays the amount in USD", async ({ page }) => {
  const usdAccount = await seedAccount({
    name: "USD Account",
    currencyCode: "USD",
    exchangeRateToJpy: 150,
  });

  await navigateTo(page, "/recurring");

  await page.getByRole("button", { name: "固定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("USD Rent");
  await page.getByRole("radio", { name: "支出" }).first().click();
  await page.getByLabel("引き落とし口座 *").selectOption(usdAccount.id);
  await page.getByLabel("金額 (USD)").first().fill("1000.00");
  await page.getByLabel("毎月の発生日").first().fill("25");
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const row = page.getByRole("row", { name: /USD Rent/ });
  await expect(row).toContainText("支出");
  await expect(row).toContainText(new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(1000));
});

test("creates a USD destination-only transfer and displays the source as unset", async ({ page }) => {
  const usdAccount = await seedAccount({
    name: "USD Account",
    currencyCode: "USD",
    exchangeRateToJpy: 150,
  });

  await navigateTo(page, "/recurring");

  await page.getByRole("button", { name: "固定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("USD External In");
  await page.getByRole("radio", { name: "振替" }).first().click();
  await page.getByLabel("送金元口座").first().selectOption("");
  await page.getByLabel("振替先口座").first().selectOption(usdAccount.id);
  await page.getByLabel("金額 (USD)").first().fill("500.00");
  await page.getByLabel("毎月の発生日").first().fill("10");
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const row = page.getByRole("row", { name: /USD External In/ });
  await expect(row).toContainText("未設定 → USD Account");
  await expect(row).toContainText(new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(500));
});
