import { expect, test } from "./helpers/test";
import { navigateTo, waitForReload } from "./helpers/actions";
import { seedAccount, seedRecurringItem } from "./helpers/db";
import { formatJapaneseDate, getFutureDate } from "./helpers/scenario";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

test("creates an income recurring item", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/recurring");

  await page.getByRole("button", { name: "予定収支を追加" }).click();
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
  const startDate = getFutureDate(-30);
  const endDate = getFutureDate(30);
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/recurring");

  await page.getByRole("button", { name: "予定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("Rent");
  await page.getByRole("radio", { name: "支出" }).first().click();
  await page.getByLabel("金額 (JPY)").first().fill("80000");
  await page.getByLabel("毎月の発生日").first().fill("27");
  await page.getByLabel("開始日").first().fill(startDate);
  await page.getByLabel("終了日").first().fill(endDate);
  await page.getByLabel("引き落とし口座 *").selectOption(account.id);
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const row = page.getByRole("row", { name: /Rent/ });
  await expect(row).toContainText("支出");
  await expect(row).toContainText(`${formatJapaneseDate(startDate)} 〜 ${formatJapaneseDate(endDate)}`);
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
  await page.getByRole("button", { name: "訂正" }).click();
  await page.getByLabel("初期金額（訂正）").fill("2500");
  await page.getByRole("button", { name: "訂正を保存" }).click();
  await page.getByRole("region", { name: "金額と適用期間" }).getByRole("button", { name: "閉じる" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /Subscription/ })).toContainText(formatCurrency(2500));
});

test("shows current and future recurring amounts on one row and keeps history in the editor", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });
  await seedRecurringItem({ name: "Rent history", amount: 80000, dayOfMonth: 5, accountId: account.id, sortOrder: 1 });
  const pastDate = getFutureDate(-30);
  const futureDate = getFutureDate(30);
  await navigateTo(page, "/recurring");
  const row = page.getByRole("row", { name: /Rent history/ });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "編集" }).click();
  await page.getByRole("button", { name: "期間を追加" }).click();
  await page.getByLabel("適用開始日").fill(pastDate);
  await page.getByLabel("金額", { exact: true }).fill("82000");
  await page.getByRole("button", { name: "追加を保存" }).dispatchEvent("click");
  await expect(page.getByRole("button", { name: `${pastDate} の履歴を訂正` })).toBeVisible();
  await page.getByRole("button", { name: "期間を追加" }).click();
  await page.getByLabel("適用開始日").fill(futureDate);
  await page.getByLabel("金額", { exact: true }).fill("85000");
  await page.getByRole("button", { name: "追加を保存" }).dispatchEvent("click");
  await expect(page.getByRole("button", { name: `${futureDate} の履歴を訂正` })).toBeVisible();
  await expect(page.getByLabel("金額と適用期間")).toContainText(formatCurrency(80000));
  await page.getByRole("region", { name: "金額と適用期間" }).getByRole("button", { name: "閉じる" }).click();
  await expect(row).toContainText(formatCurrency(82000));
  await expect(row).toContainText(formatCurrency(85000));
  await expect(row).not.toContainText(formatCurrency(80000));
  await page.setViewportSize({ width: 375, height: 800 });
  const mobileCard = page.getByText("Rent history", { exact: true }).locator("..").locator("..");
  await expect(mobileCard).toContainText(formatCurrency(82000));
  await expect(mobileCard).toContainText(formatCurrency(85000));
  await expect(mobileCard).not.toContainText(formatCurrency(80000));
});

test("keeps recurring item date shift policy through create and edit", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/recurring");

  await page.getByRole("button", { name: "予定収支を追加" }).click();
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
  await page.getByRole("button", { name: "基本情報" }).click();
  await expect(page.getByLabel("土日祝の扱い").last()).toHaveValue("next");
  await page.getByLabel("カテゴリ名 *").last().fill("Shifted Rent");
  await page.getByRole("button", { name: "保存" }).click();
  await waitForReload(page);

  const updatedRow = page.getByRole("row", { name: /Shifted Rent/ });
  await expect(updatedRow).toContainText(formatCurrency(80000));
  await updatedRow.getByRole("button", { name: "編集" }).click();
  await page.getByRole("button", { name: "基本情報" }).click();
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

  await page.getByRole("button", { name: "予定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("Lunch");
  await page.getByRole("radio", { name: "支出" }).first().click();
  await page.getByLabel("金額 (JPY)").first().fill("1000");
  await page.getByLabel("周期").first().selectOption("weekly");
  await page.getByLabel("曜日").first().selectOption("5");
  await page.getByLabel("引き落とし口座 *").selectOption(account.id);
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const row = page.getByRole("row", { name: /Lunch/ });
  await expect(row).toContainText("毎週 金曜日");

  await row.getByRole("button", { name: "編集" }).click();
  await page.getByRole("button", { name: "基本情報" }).click();
  await page.getByLabel("曜日").last().selectOption("6");
  await page.getByRole("button", { name: "保存" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /Lunch/ })).toContainText("毎週 土曜日");
});

test("creates a transfer with only a destination account and edits it", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/recurring");

  await page.getByRole("button", { name: "予定収支を追加" }).click();
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
  await page.getByRole("button", { name: "基本情報" }).click();
  await page.getByLabel("送金元口座").last().selectOption(account.id);
  await page.getByLabel("振替先口座").last().selectOption("");
  await page.getByRole("button", { name: "保存" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /External In/ })).toContainText("Main Account → 未設定");
});

test("creates a transfer with only a source account and disables save when both accounts are empty", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/recurring");

  await page.getByRole("button", { name: "予定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("External Out");
  await page.getByRole("radio", { name: "振替" }).first().click();
  await page.getByLabel("金額 (JPY)").first().fill("5000");
  await page.getByLabel("毎月の発生日").first().fill("20");
  await page.getByLabel("送金元口座").first().selectOption(account.id);
  await page.getByLabel("振替先口座").first().selectOption("");
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /External Out/ })).toContainText("Main Account → 未設定");

  await page.getByRole("button", { name: "予定収支を追加" }).click();
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

  await page.getByRole("button", { name: "予定収支を追加" }).click();
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

  await page.getByRole("button", { name: "予定収支を追加" }).click();
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

test("creates a one-time expense and displays it in the dashboard forecast", async ({ page }) => {
  const scheduledDate = getFutureDate();
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/recurring");

  await page.getByRole("button", { name: "予定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("One-time Expense");
  await page.getByRole("radio", { name: "支出" }).first().click();
  await page.getByLabel("金額 (JPY)").first().fill("30000");
  await page.getByLabel("周期").first().selectOption("oneTime");
  await page.getByLabel("予定日").first().fill(scheduledDate);
  await page.getByLabel("引き落とし口座 *").selectOption(account.id);
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const row = page.getByRole("row", { name: /One-time Expense/ });
  await expect(row).toContainText("支出");
  await expect(row).toContainText(`単発 ${scheduledDate}`);

  await navigateTo(page, "/");
  await expect(page.getByText("One-time Expense").first()).toBeVisible();
});

test("creates a one-time transfer and reflects it in the dashboard forecast", async ({ page }) => {
  const scheduledDate = getFutureDate();
  const accountA = await seedAccount({ name: "Account A", balance: 100_000 });
  const accountB = await seedAccount({ name: "Account B", balance: 50_000 });

  await navigateTo(page, "/recurring");

  await page.getByRole("button", { name: "予定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("One-time Transfer");
  await page.getByRole("radio", { name: "振替" }).first().click();
  await page.getByLabel("金額 (JPY)").first().fill("50000");
  await page.getByLabel("周期").first().selectOption("oneTime");
  await page.getByLabel("予定日").first().fill(scheduledDate);
  await page.getByLabel("送金元口座").first().selectOption(accountA.id);
  await page.getByLabel("振替先口座").first().selectOption(accountB.id);
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const row = page.getByRole("row", { name: /One-time Transfer/ });
  await expect(row).toContainText("振替");
  await expect(row).toContainText(`単発 ${scheduledDate}`);

  await navigateTo(page, "/");
  await expect(page.getByText("One-time Transfer").first()).toBeVisible();
  const eventRow = page.getByRole("row", { name: /One-time Transfer/ }).first();
  await expect(eventRow).toContainText("振替");
  await expect(eventRow).toContainText(formatJapaneseDate(scheduledDate));
});
