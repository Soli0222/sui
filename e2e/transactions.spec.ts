import { expect, test } from "./helpers/test";
import { navigateTo, waitForReload } from "./helpers/actions";
import { seedAccount, seedTransaction, seedTransactions } from "./helpers/db";
import { formatCurrency, getFutureDate } from "./helpers/scenario";

test("records a manual expense transaction", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account", balance: 10000 });
  const today = getFutureDate(0);

  await navigateTo(page, "/transactions");

  await page.getByRole("button", { name: "取引を追加" }).click();
  await page.getByLabel("内容").fill("Lunch");
  await page.getByRole("radio", { name: "支出" }).click();
  await page.getByLabel("金額").fill("1200");
  await page.getByLabel("取引日").fill(today);
  await page.getByLabel("対象口座").selectOption(account.id);
  await page.getByRole("dialog").getByRole("button", { name: "取引を追加" }).click();
  await waitForReload(page);

  const row = page.getByRole("row", { name: /Lunch/ });
  await expect(row).toContainText("支出");
  await expect(row).toContainText(formatCurrency(1200));
});

test("keeps the transaction draft after a failed save and guards discard", async ({ page }) => {
  const account = await seedAccount({ name: "Draft Account", balance: 10000 });
  let failNext = true;
  await page.route("**/api/transactions", async (route) => {
    if (route.request().method() === "POST" && failNext) {
      failNext = false;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "一時的な失敗" }) });
      return;
    }
    await route.continue();
  });
  await navigateTo(page, "/transactions");
  await page.getByRole("button", { name: "取引を追加" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("取引日")).toHaveValue(getFutureDate(0));
  await expect(dialog.getByLabel("対象口座")).toHaveValue("");
  await dialog.getByLabel("内容").fill("Preserved draft");
  await dialog.getByLabel("金額").fill("1200");
  await dialog.getByLabel("対象口座").selectOption(account.id);
  await dialog.getByLabel("金額").fill("");
  await dialog.getByRole("button", { name: "取引を追加" }).click();
  await expect(dialog.getByText(/0より大きく/)).toBeVisible();
  await dialog.getByLabel("金額").fill("1200");
  await dialog.getByRole("button", { name: "取引を追加" }).click();
  await expect(dialog.getByRole("alert")).toContainText("一時的な失敗");
  await expect(dialog.getByLabel("内容")).toHaveValue("Preserved draft");
  await dialog.getByRole("button", { name: "キャンセル" }).click();
  const discard = page.getByRole("dialog", { name: "未保存の変更を破棄しますか？" });
  await discard.getByRole("button", { name: "編集を続ける" }).click();
  await expect(dialog.getByLabel("内容")).toHaveValue("Preserved draft");
  await dialog.getByRole("button", { name: "取引を追加" }).click();
  await expect(page.getByRole("row", { name: /Preserved draft/ })).toBeVisible();
});

test("retries only the display refresh after a successful transaction save", async ({ page }) => {
  const account = await seedAccount({ name: "Refresh Account", balance: 10000 });
  let posts = 0;
  let failRefresh = true;
  await page.route("**/api/transactions", async (route) => {
    if (route.request().method() === "POST") posts += 1;
    await route.continue();
  });
  await page.route("**/api/accounts", async (route) => {
    if (posts > 0 && failRefresh) {
      failRefresh = false;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "再取得に失敗" }) });
      return;
    }
    await route.continue();
  });
  await navigateTo(page, "/transactions");
  await page.getByRole("button", { name: "取引を追加" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("内容").fill("Refresh once");
  await dialog.getByLabel("金額").fill("100");
  await dialog.getByLabel("対象口座").selectOption(account.id);
  await dialog.getByRole("button", { name: "取引を追加" }).click();
  await expect(dialog.getByText("保存済み・表示更新失敗")).toBeVisible();
  await dialog.getByRole("button", { name: "表示を再取得" }).click();
  await expect(page.getByRole("row", { name: /Refresh once/ })).toBeVisible();
  expect(posts).toBe(1);
});

test("saves a USD fractional amount once and keeps the chosen account", async ({ page }) => {
  const account = await seedAccount({ name: "Dollar Account", balance: 10000, currencyCode: "USD", exchangeRateToJpy: 150 });
  let posts = 0;
  let postedAmount: number | undefined;
  await page.route("**/api/transactions", async (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      postedAmount = route.request().postDataJSON().amount as number;
    }
    await route.continue();
  });
  await navigateTo(page, "/transactions");
  await page.getByRole("button", { name: "Dollar Account" }).click();
  await page.getByRole("button", { name: "取引を追加" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("対象口座")).toHaveValue(account.id);
  await dialog.getByLabel("内容").fill("Coffee USD");
  await dialog.getByLabel("金額").fill("12.34");
  await dialog.getByRole("button", { name: "取引を追加" }).dispatchEvent("click");
  await dialog.getByRole("button", { name: "取引を追加" }).dispatchEvent("click");
  await expect(page.getByRole("row", { name: /Coffee USD/ })).toBeVisible();
  expect(posts).toBe(1);
  expect(postedAmount).toBe(1234);
});

test("keeps minor units stable when switching from a JPY to a USD account", async ({ page }) => {
  await seedAccount({ name: "Yen Account", currencyCode: "JPY" });
  const dollar = await seedAccount({ name: "Dollar Account", currencyCode: "USD", exchangeRateToJpy: 150 });
  await navigateTo(page, "/transactions");
  await page.getByRole("button", { name: "取引を追加" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("金額").fill("1200");
  await dialog.getByLabel("対象口座").selectOption(dollar.id);
  await expect(dialog.getByLabel("金額")).toHaveValue("12.00");
});

test("edits an existing transaction from the history table", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account", balance: 10000 });
  const today = getFutureDate(0);

  await seedTransaction({
    accountId: account.id,
    description: "Lunch",
    amount: 1200,
    type: "expense",
    date: new Date(`${today}T00:00:00.000Z`),
  });

  await navigateTo(page, "/transactions");

  const row = page.getByRole("row", { name: /Lunch/ });
  await row.getByRole("button", { name: "編集" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("内容").fill("Dinner");
  await dialog.getByLabel("金額").fill("1800");
  await dialog.getByRole("button", { name: "変更を保存" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /Dinner/ })).toContainText(formatCurrency(1800));
  await expect(page.getByText("Lunch")).toHaveCount(0);
});

test("closes an unchanged or reverted transaction without a discard prompt", async ({ page }) => {
  const account = await seedAccount({ name: "Original Account", balance: 10000 });
  await seedTransaction({ accountId: account.id, description: "Original", amount: 1000,
    type: "expense", date: new Date(`${getFutureDate(0)}T00:00:00.000Z`) });
  await navigateTo(page, "/transactions");
  const row = page.getByRole("row", { name: /Original/ });
  await row.getByRole("button", { name: "編集" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(dialog).toHaveCount(0);
  await row.getByRole("button", { name: "編集" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("内容").fill("Changed");
  await dialog.getByLabel("内容").fill("Original");
  await dialog.getByRole("button", { name: "キャンセル" }).click();
  await expect(dialog).toHaveCount(0);
});

test("deletes a manual transaction and restores the account balance", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account", balance: 8800 });
  const today = getFutureDate(0);

  await seedTransaction({
    accountId: account.id,
    description: "Lunch",
    amount: 1200,
    type: "expense",
    date: new Date(`${today}T00:00:00.000Z`),
  });

  await navigateTo(page, "/transactions");

  const row = page.getByRole("row", { name: /Lunch/ });
  await row.getByRole("button", { name: "削除" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("残高が元に戻ります");
  await dialog.getByRole("button", { name: "削除する" }).click();
  await waitForReload(page);

  await expect(page.getByText("Lunch")).toHaveCount(0);
  await expect(page.getByText(formatCurrency(10000))).toBeVisible();
});

test("disables the delete button for forecast-confirmed transactions", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account", balance: 8800 });
  const today = getFutureDate(0);

  await seedTransaction({
    accountId: account.id,
    description: "Forecast Lunch",
    amount: 1200,
    type: "expense",
    forecastEventId: "forecast:1",
    date: new Date(`${today}T00:00:00.000Z`),
  });

  await navigateTo(page, "/transactions");

  const row = page.getByRole("row", { name: /Forecast Lunch/ });
  await expect(row.getByRole("button", { name: "編集" })).toBeVisible();
  await expect(row.getByRole("button", { name: "削除" })).toBeDisabled();
});

test("records a transfer transaction and shows both account names", async ({ page }) => {
  const source = await seedAccount({ name: "Account A", balance: 10000, sortOrder: 1 });
  const destination = await seedAccount({ name: "Account B", balance: 5000, sortOrder: 2 });
  const today = getFutureDate(0);

  await navigateTo(page, "/transactions");

  await page.getByRole("button", { name: "取引を追加" }).click();
  await page.getByLabel("内容").fill("Move");
  await page.getByLabel("対象口座").selectOption(source.id);
  await page.getByRole("radio", { name: "振替" }).click();
  await page.getByLabel("金額").fill("3000");
  await page.getByLabel("取引日").fill(today);
  await page.getByLabel("振替先口座").selectOption(destination.id);
  await page.getByRole("dialog").getByRole("button", { name: "取引を追加" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /Move/ })).toContainText("Account A -> Account B");
});

test("records transfers with an empty source or destination account", async ({ page }) => {
  const source = await seedAccount({ name: "Account A", balance: 10000, sortOrder: 1 });
  const destination = await seedAccount({ name: "Account B", balance: 5000, sortOrder: 2 });
  const today = getFutureDate(0);

  await navigateTo(page, "/transactions");

  await page.getByRole("button", { name: "取引を追加" }).click();
  await page.getByLabel("内容").fill("Inbound");
  await page.getByRole("radio", { name: "振替" }).click();
  await page.getByLabel("金額").fill("1000");
  await page.getByLabel("取引日").fill(today);
  await page.getByLabel("振替先口座").selectOption(destination.id);
  await page.getByRole("dialog").getByRole("button", { name: "取引を追加" }).click();
  await waitForReload(page);

  await page.getByRole("button", { name: "取引を追加" }).click();
  await page.getByLabel("内容").fill("Outbound");
  await page.getByLabel("対象口座").selectOption(source.id);
  await page.getByRole("radio", { name: "振替" }).click();
  await page.getByLabel("金額").fill("1500");
  await page.getByLabel("取引日").fill(today);
  await page.getByRole("dialog").getByRole("button", { name: "取引を追加" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /Inbound/ })).toContainText("未指定 -> Account B");
  await expect(page.getByRole("row", { name: /Outbound/ })).toContainText("Account A -> 未指定");

  await navigateTo(page, "/accounts");
  await expect(page.getByText("Account A", { exact: true }).locator("xpath=ancestor::tr | ancestor::li")).toContainText(formatCurrency(8500));
  await expect(page.getByText("Account B", { exact: true }).locator("xpath=ancestor::tr | ancestor::li")).toContainText(formatCurrency(6000));
});

test("filters transactions by account", async ({ page }) => {
  const first = await seedAccount({ name: "First Account", balance: 10000, sortOrder: 1 });
  const second = await seedAccount({ name: "Second Account", balance: 10000, sortOrder: 2 });
  const today = getFutureDate(0);

  await seedTransaction({
    accountId: first.id,
    description: "First Expense",
    amount: 1000,
    type: "expense",
    date: new Date(`${today}T00:00:00.000Z`),
  });
  await seedTransaction({
    accountId: second.id,
    description: "Second Expense",
    amount: 2000,
    type: "expense",
    date: new Date(`${today}T00:00:00.000Z`),
  });

  await navigateTo(page, "/transactions");

  await page.getByRole("button", { name: "First Account" }).click();
  await waitForReload(page);

  await expect(page.getByText("First Expense")).toBeVisible();
  await expect(page.getByText("Second Expense")).toHaveCount(0);
});

test("moves between pages with pagination controls", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account", balance: 10000 });

  await seedTransactions(
    Array.from({ length: 21 }, (_, offset) => {
      const index = offset + 1;
      return {
        accountId: account.id,
        date: new Date(`${getFutureDate(-offset)}T00:00:00.000Z`),
        description: `Transaction ${index}`,
        amount: index,
        type: "expense",
      };
    }),
  );

  await navigateTo(page, "/transactions");

  await expect(page.getByText("Transaction 21")).toHaveCount(0);
  await page.getByRole("button", { name: "次へ" }).click();
  await waitForReload(page);
  await expect(page.getByText("Transaction 21")).toBeVisible();
  await page.getByRole("button", { name: "前へ" }).click();
  await waitForReload(page);
  await expect(page.getByText("Transaction 21")).toHaveCount(0);
});

test("filters transactions by period preset", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account", balance: 10000 });

  await seedTransaction({
    accountId: account.id,
    description: "Recent Expense",
    amount: 1000,
    type: "expense",
    date: new Date(`${getFutureDate(-10)}T00:00:00.000Z`),
  });
  await seedTransaction({
    accountId: account.id,
    description: "Old Expense",
    amount: 2000,
    type: "expense",
    date: new Date(`${getFutureDate(-130)}T00:00:00.000Z`),
  });

  await navigateTo(page, "/transactions");

  await expect(page.getByText("Recent Expense")).toBeVisible();
  await expect(page.getByText("Old Expense")).toHaveCount(0);

  await page.getByLabel("期間プリセット").selectOption("all");
  await waitForReload(page);

  await expect(page.getByText("Old Expense")).toBeVisible();
});

test("changes page size from the filter controls", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account", balance: 10000 });

  await seedTransactions(
    Array.from({ length: 21 }, (_, offset) => ({
      accountId: account.id,
      date: new Date(`${getFutureDate(-offset)}T00:00:00.000Z`),
      description: `Limit Transaction ${offset + 1}`,
      amount: offset + 1,
      type: "expense",
    })),
  );

  await navigateTo(page, "/transactions");

  await expect(page.getByText("Limit Transaction 21")).toHaveCount(0);
  await page.getByLabel("表示件数").selectOption("50");
  await waitForReload(page);
  await expect(page.getByText("Limit Transaction 21")).toBeVisible();
});
