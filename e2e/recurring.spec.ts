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

  await expect(page.getByRole("listitem").filter({ hasText: /Salary/ })).toContainText("収入");
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

  const row = page.getByRole("listitem").filter({ hasText: /Rent/ });
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

  const row = page.getByRole("listitem").filter({ hasText: /Subscription/ });
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Subscription", exact: true })).toHaveCount(0);
  await row.getByRole("button", { name: "Subscriptionを編集" }).click();
  await expect(page.getByLabel("金額と適用期間")).toBeVisible();
  await page.getByRole("button", { name: "初期金額を訂正" }).click();
  await page.getByLabel("初期金額（訂正）").fill("2500");
  await page.getByRole("button", { name: "訂正を保存" }).click();
  await page.locator(".edit-editor-modal").getByRole("button", { name: "閉じる" }).first().click();
  await waitForReload(page);

  await expect(page.getByRole("listitem").filter({ hasText: /Subscription/ })).toContainText(formatCurrency(2500));
});

test("shows current and future recurring amounts on one row and keeps history in the editor", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });
  await seedRecurringItem({ name: "Rent history", amount: 80000, dayOfMonth: 5, accountId: account.id, sortOrder: 1 });
  const pastDate = getFutureDate(-30);
  const futureDate = getFutureDate(30);
  await navigateTo(page, "/recurring");
  const row = page.getByRole("listitem").filter({ hasText: /Rent history/ });
  await expect(row).toBeVisible();
  await expect(row.getByText("金額", { exact: true })).toBeVisible();
  await expect(row.getByText("適用期間", { exact: true })).toBeVisible();
  await expect(row).toContainText("有効期間");
  await row.getByRole("button", { name: "Rent historyを編集" }).click();
  await expect(page.getByLabel("金額と適用期間")).toBeVisible();
  await page.getByRole("button", { name: "期間を追加" }).click();
  await page.getByLabel("適用開始日").fill(pastDate);
  await page.locator("#recurring-editor-amount").fill("82000");
  await page.getByRole("button", { name: "金額変更を記録" }).click();
  await expect(page.getByRole("button", { name: `${pastDate}からの期間を訂正` })).toBeVisible();
  await page.getByRole("button", { name: "期間を追加" }).click();
  await page.getByLabel("適用開始日").fill(futureDate);
  await page.locator("#recurring-editor-amount").fill("85000");
  await page.getByRole("button", { name: "変更を予約" }).click();
  await expect(page.getByRole("button", { name: `${futureDate}からの期間を訂正` })).toBeVisible();
  await expect(page.getByLabel("金額と適用期間")).toContainText(formatCurrency(80000));
  await page.locator(".edit-editor-modal").getByRole("button", { name: "閉じる" }).first().click();
  await expect(row).toContainText(formatCurrency(82000));
  await expect(row).toContainText(formatCurrency(85000));
  await expect(row).not.toContainText(formatCurrency(80000));
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(row).toContainText(formatCurrency(82000));
  await expect(row).toContainText(formatCurrency(85000));
  await expect(row).not.toContainText(formatCurrency(80000));
});

test("keeps recurring item date shift policy through create and edit", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/recurring");

  await page.getByRole("button", { name: "予定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("Shifted Rent");
  await page.getByRole("radio", { name: "支出" }).first().click();
  await page.getByLabel("金額 (JPY)").first().fill("80000");
  await page.getByLabel("毎月の発生日").first().fill("31");
  await page.getByRole("button", { name: "詳細設定" }).click();
  await page.getByLabel("土日祝の扱い").first().selectOption("next");
  await page.getByLabel("引き落とし口座 *").selectOption(account.id);
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const row = page.getByRole("listitem").filter({ hasText: /Shifted Rent/ });
  await row.getByRole("button", { name: "Shifted Rentを編集" }).click();
  await page.getByRole("button", { name: "基本情報を編集" }).click();
  await page.getByRole("button", { name: "詳細設定" }).click();
  await expect(page.getByLabel("土日祝の扱い").last()).toHaveValue("next");
  await page.getByLabel("カテゴリ名 *").last().fill("Shifted Rent updated");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await waitForReload(page);
  await page.locator(".edit-editor-modal").getByRole("button", { name: "閉じる" }).first().click();

  const updatedRow = page.getByRole("listitem").filter({ hasText: /Shifted Rent updated/ });
  await expect(updatedRow).toContainText(formatCurrency(80000));
  await expect(updatedRow.getByRole("button", { name: "Shifted Rent updatedを編集" })).toBeFocused();
  await updatedRow.getByRole("button", { name: "Shifted Rent updatedを編集" }).click();
  await page.getByRole("button", { name: "基本情報を編集" }).click();
  await page.getByRole("button", { name: "詳細設定" }).click();
  await expect(page.getByLabel("土日祝の扱い").last()).toHaveValue("next");
});

test("keeps initial amount correction separate from basic edits and amount history", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });
  const item = await seedRecurringItem({ name: "通信費", amount: 8000, dayOfMonth: 1, accountId: account.id });
  const effectiveFrom = getFutureDate(30);
  await navigateTo(page, "/recurring");

  const row = page.getByRole("listitem").filter({ hasText: /通信費/ });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "通信費を編集" }).click();
  await page.getByRole("button", { name: "初期金額を訂正" }).click();
  await page.getByLabel("初期金額（訂正）").fill("8500");
  const correctionRequest = page.waitForRequest((request) => request.method() === "PUT" && request.url().endsWith(`/api/recurring-items/${item.id}`));
  await page.getByRole("button", { name: "訂正を保存" }).click();
  expect((await correctionRequest).postDataJSON()).toMatchObject({ name: "通信費", dayOfMonth: 1, amount: 8500 });

  await page.getByRole("button", { name: "基本情報を編集" }).click();
  await page.getByLabel("毎月の発生日").fill("5");
  await expect(page.getByText("周期:")).toBeVisible();
  const basicRequest = page.waitForRequest((request) => request.method() === "PUT" && request.url().endsWith(`/api/recurring-items/${item.id}`));
  await page.getByLabel("毎月の発生日").press("Enter");
  expect((await basicRequest).postDataJSON()).toMatchObject({ name: "通信費", dayOfMonth: 5, amount: 8500 });

  await page.getByRole("button", { name: "期間を追加" }).click();
  await page.getByLabel("適用開始日").fill(effectiveFrom);
  await page.locator("#recurring-editor-amount").fill("");
  await page.getByRole("button", { name: "変更を予約" }).click();
  await expect(page.getByText("0以上の有効な金額を入力してください。")).toBeVisible();
  await page.locator("#recurring-editor-amount").fill("9000");
  const historyRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith(`/api/recurring-items/${item.id}/amount-changes`));
  await page.getByRole("button", { name: "変更を予約" }).click();
  expect((await historyRequest).postDataJSON()).toMatchObject({ effectiveFrom, amount: 9000 });
  await page.locator(".edit-editor-modal").getByRole("button", { name: "閉じる" }).first().click();
  await expect(row).toContainText(formatCurrency(8500));
  await expect(row).toContainText(formatCurrency(9000));
  await expect(row).toContainText("毎月 5日");
});

test("keeps an unsaved basic draft through close cancellation and restores focus after discard", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });
  await seedRecurringItem({ name: "Focus Rent", amount: 8000, dayOfMonth: 1, accountId: account.id });
  await page.setViewportSize({ width: 1920, height: 900 });
  await navigateTo(page, "/recurring");

  const row = page.getByRole("listitem").filter({ hasText: /Focus Rent/ });
  await expect(row).toBeVisible();
  const edit = row.getByRole("button", { name: "Focus Rentを編集" });
  await edit.click();
  await page.getByRole("button", { name: "基本情報を編集" }).click();
  await page.getByLabel("カテゴリ名 *").fill("Focus Rent changed");
  await page.locator(".edit-editor-modal").getByRole("button", { name: "閉じる" }).first().click();
  await page.getByRole("button", { name: "編集を続ける" }).click();
  await expect(page.getByLabel("カテゴリ名 *")).toHaveValue("Focus Rent changed");
  await page.locator(".edit-editor-modal").getByRole("button", { name: "閉じる" }).first().click();
  await page.getByRole("button", { name: "変更を破棄" }).click();
  await expect(edit).toBeFocused();
  await expect(row).toContainText("Focus Rent");
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

  await page.getByRole("listitem").filter({ hasText: /To Delete/ }).getByRole("button", { name: /を削除/ }).click();
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

  const row = page.getByRole("listitem").filter({ hasText: /Lunch/ });
  await expect(row).toContainText("毎週 金曜日");

  await row.getByRole("button", { name: "Lunchを編集" }).click();
  await page.getByRole("button", { name: "基本情報を編集" }).click();
  await page.getByLabel("曜日").last().selectOption("6");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await waitForReload(page);
  await page.locator(".edit-editor-modal").getByRole("button", { name: "閉じる" }).first().click();

  await expect(page.getByRole("listitem").filter({ hasText: /Lunch/ })).toContainText("毎週 土曜日");
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

  const row = page.getByRole("listitem").filter({ hasText: /External In/ });
  await expect(row).toContainText("未設定 → Main Account");

  await row.getByRole("button", { name: "External Inを編集" }).click();
  await page.getByRole("button", { name: "基本情報を編集" }).click();
  await page.getByLabel("送金元口座").last().selectOption(account.id);
  await page.getByLabel("振替先口座").last().selectOption("");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await waitForReload(page);
  await page.locator(".edit-editor-modal").getByRole("button", { name: "閉じる" }).first().click();

  await expect(page.getByRole("listitem").filter({ hasText: /External In/ })).toContainText("Main Account → 未設定");
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

  await expect(page.getByRole("listitem").filter({ hasText: /External Out/ })).toContainText("Main Account → 未設定");

  await page.getByRole("button", { name: "予定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("No Accounts");
  await page.getByRole("radio", { name: "振替" }).first().click();
  await page.getByLabel("金額 (JPY)").first().fill("1000");
  await page.getByLabel("毎月の発生日").first().fill("15");
  await page.getByLabel("送金元口座").first().selectOption("");
  await page.getByRole("dialog").getByRole("button", { name: "予定収支を追加" }).click();
  await expect(page.getByText("送金元または振替先を選択してください。")).toBeVisible();
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

  const row = page.getByRole("listitem").filter({ hasText: /USD Rent/ });
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

  const row = page.getByRole("listitem").filter({ hasText: /USD External In/ });
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

  const row = page.getByRole("listitem").filter({ hasText: /One-time Expense/ });
  await expect(row).toContainText("支出");
  await expect(row).toContainText(`単発 ${scheduledDate}`);
  await row.getByRole("button", { name: "One-time Expenseを編集" }).click();
  await expect(page.getByLabel("金額と適用期間")).toContainText("初期金額");
  await expect(page.getByRole("button", { name: "期間を追加" })).toHaveCount(0);
  await page.locator(".edit-editor-modal").getByRole("button", { name: "閉じる" }).first().click();

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

  const row = page.getByRole("listitem").filter({ hasText: /One-time Transfer/ });
  await expect(row).toContainText("振替");
  await expect(row).toContainText(`単発 ${scheduledDate}`);

  await navigateTo(page, "/");
  const eventRow = page.getByRole("listitem").filter({ hasText: /One-time Transfer/ }).first();
  await expect(eventRow).toBeVisible();
  await expect(eventRow).toContainText("振替");
  await expect(eventRow).toContainText(formatJapaneseDate(scheduledDate));
});
