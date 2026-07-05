import { expect, test } from "@playwright/test";
import { navigateTo, waitForReload } from "./helpers/actions";
import {
  resetDatabase,
  seedAccount,
  seedBilling,
  seedCreditCard,
  seedLoan,
  seedRecurringItem,
} from "./helpers/db";

function formatCurrency(value: number, currency = "JPY") {
  return new Intl.NumberFormat(currency === "JPY" ? "ja-JP" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "JPY" ? 0 : 2,
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
  }).format(value);
}

function getJstDateParts() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth();
  return { year, month };
}

function getYearMonth(offsetMonths = 0) {
  const { year, month } = getJstDateParts();
  const date = new Date(Date.UTC(year, month + offsetMonths, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getDateString(offsetDays = 0) {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000 + offsetDays * 24 * 60 * 60 * 1000);
  const year = jst.getUTCFullYear();
  const month = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jst.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLastDayOfMonth(offsetMonths = 0) {
  const { year, month } = getJstDateParts();
  return new Date(Date.UTC(year, month + offsetMonths + 1, 0)).getUTCDate();
}

function getFutureDayOfMonth() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return Math.min(jst.getUTCDate() + 1, 31);
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("shows zero summaries and none labels on an empty dashboard", async ({ page }) => {
  await navigateTo(page, "/");

  await expect(page.getByText("総資産").locator("..")).toContainText(formatCurrency(0));
  await expect(page.getByText("次の収入").locator("..")).toContainText("なし");
  await expect(page.getByText("次の支出").locator("..")).toContainText("なし");
});

test("shows summaries, events, and chart when data exists", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account", balance: 100000, sortOrder: 1 });

  await seedRecurringItem({
    name: "Salary",
    type: "income",
    amount: 300000,
    dayOfMonth: getFutureDayOfMonth(),
    accountId: account.id,
    sortOrder: 1,
  });
  await seedRecurringItem({
    name: "Rent",
    type: "expense",
    amount: 80000,
    dayOfMonth: getFutureDayOfMonth(),
    accountId: account.id,
    sortOrder: 2,
  });

  await navigateTo(page, "/");

  await expect(page.getByText("総資産").locator("..")).toContainText(formatCurrency(100000));
  await expect(page.getByRole("cell", { name: "Salary" }).first()).toBeVisible();
  await expect(page.locator("svg.recharts-surface")).toBeVisible();
});

test("opens the forecast contribution explanation from the level header", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account", balance: 100000, sortOrder: 1 });
  const eventDate = getDateString(7);

  await seedRecurringItem({
    name: "Explain Rent",
    type: "expense",
    amount: 80000,
    dayOfMonth: Number(eventDate.slice(8, 10)),
    startDate: new Date(`${eventDate}T00:00:00.000Z`),
    endDate: new Date(`${eventDate}T00:00:00.000Z`),
    accountId: account.id,
    sortOrder: 1,
  });

  await navigateTo(page, "/");

  await page.getByRole("button", { name: "期間内最小の寄与分解を表示" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "全体の最小残高の寄与分解" })).toBeVisible();
  await expect(dialog.getByText("source 別小計")).toBeVisible();
  await expect(dialog.getByText("固定支出")).toBeVisible();
  await expect(dialog.getByRole("row", { name: /Explain Rent/ })).toBeVisible();
  await expect(dialog).toContainText(formatCurrency(20000));
});

test("shows foreign-currency account totals in JPY with source amounts on forecast rows", async ({ page }) => {
  const account = await seedAccount({
    name: "USD Wallet",
    balance: 100000,
    currencyCode: "USD",
    exchangeRateToJpy: 150,
    sortOrder: 1,
  });

  await seedRecurringItem({
    name: "USD Hosting",
    type: "expense",
    amount: 2500,
    dayOfMonth: getFutureDayOfMonth(),
    accountId: account.id,
    sortOrder: 1,
  });

  await navigateTo(page, "/");

  await expect(page.getByText("総資産").locator("..")).toContainText(formatCurrency(150000));
  const forecastTable = page.locator("table").last();
  const totalRow = forecastTable.getByRole("row", { name: /USD Hosting/ }).first();
  await expect(totalRow).toContainText(formatCurrency(25, "USD"));
  await expect(totalRow).toContainText(formatCurrency(3750));
  await expect(totalRow).toContainText(formatCurrency(146250));

  await page.getByRole("button", { name: "USD Wallet" }).click();
  await expect(page.getByText("USD Wallet の予測イベント")).toBeVisible();
  const accountRow = page.locator("table").last().getByRole("row", { name: /USD Hosting/ }).first();
  await expect(accountRow).toContainText(formatCurrency(25, "USD"));
  await expect(accountRow).toContainText(formatCurrency(975, "USD"));
  await expect(accountRow).toContainText(formatCurrency(146250));
});

test("filters forecast events when switching account tabs", async ({ page }) => {
  const firstAccount = await seedAccount({ name: "Checking", balance: 50000, sortOrder: 1 });
  const secondAccount = await seedAccount({ name: "Savings", balance: 60000, sortOrder: 2 });

  await seedRecurringItem({
    name: "Checking Salary",
    type: "income",
    amount: 200000,
    dayOfMonth: getFutureDayOfMonth(),
    accountId: firstAccount.id,
    sortOrder: 1,
  });
  await seedRecurringItem({
    name: "Savings Rent",
    type: "expense",
    amount: 30000,
    dayOfMonth: getFutureDayOfMonth(),
    accountId: secondAccount.id,
    sortOrder: 1,
  });

  await navigateTo(page, "/");

  await page.getByRole("button", { name: "Savings" }).click();
  const forecastTable = page.locator("table").last();
  await expect(page.getByText("Savings の予測イベント")).toBeVisible();
  await expect(forecastTable.getByRole("cell", { name: "Savings Rent" }).first()).toBeVisible();
  await expect(forecastTable.getByRole("cell", { name: "Checking Salary" })).toHaveCount(0);
});

test("confirms a forecast event from the dialog", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account", balance: 100000, sortOrder: 1 });

  await seedRecurringItem({
    name: "Salary",
    type: "income",
    amount: 300000,
    dayOfMonth: getFutureDayOfMonth(),
    accountId: account.id,
    sortOrder: 1,
  });

  await navigateTo(page, "/");

  const salaryCells = page.locator("table").last().getByRole("cell", { name: "Salary" });
  const beforeCount = await salaryCells.count();
  await page.getByRole("button", { name: "確定" }).first().click();
  await expect(page.getByRole("heading", { name: "予測イベントを確定" })).toBeVisible();
  await expect(page.getByLabel("実際の金額")).toHaveValue("300000");
  await expect(page.getByLabel("対象口座")).toHaveValue(account.id);
  await page.getByRole("button", { name: "確定する" }).click();
  await waitForReload(page);

  await expect(page.locator("table").last().getByRole("cell", { name: "Salary" })).toHaveCount(beforeCount - 1);
});

test("confirms overdue forecast events from the confirm queue", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account", balance: 100000, sortOrder: 1 });
  const firstCard = await seedCreditCard({
    name: "Past Card",
    accountId: account.id,
    settlementDay: getFutureDayOfMonth(),
    assumptionAmount: 0,
    sortOrder: 1,
  });
  const secondCard = await seedCreditCard({
    name: "Backup Card",
    accountId: account.id,
    settlementDay: getFutureDayOfMonth(),
    assumptionAmount: 0,
    sortOrder: 2,
  });
  await seedBilling(
    getYearMonth(0),
    [
      { creditCardId: firstCard.id, amount: 12000 },
      { creditCardId: secondCard.id, amount: 5000 },
    ],
    new Date(`${getDateString(-1)}T00:00:00.000Z`),
  );

  await navigateTo(page, "/");

  // モーダルは自動で開かず、ダッシュボード内の確定キューに件数バッジ付きで表示される
  await expect(page.getByRole("heading", { name: "確定キュー" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("2 件", { exact: true })).toBeVisible();
  await expect(page.getByText("予定日を過ぎた未確定イベントです")).toBeVisible();
  await expect(page.getByRole("button", { name: "選択した 2 件を確定" })).toBeVisible();
  await expect(page.getByText("Past Card 引き落とし").first()).toBeVisible();
  await expect(page.getByText("Backup Card 引き落とし").first()).toBeVisible();

  const queueTable = page.locator("table").first();
  await queueTable.getByRole("row", { name: /Past Card 引き落とし/ }).getByRole("spinbutton").fill("9000");
  await page.getByRole("button", { name: "選択した 2 件を確定" }).click();
  await waitForReload(page);

  await expect(page.getByText("2 件を確定しました", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "確定キュー" })).toHaveCount(0);
  await expect(page.getByText("総資産").locator("..").first()).toContainText(formatCurrency(86000));

  await navigateTo(page, "/transactions");
  await page.getByLabel("期間プリセット").selectOption("all");
  await waitForReload(page);
  await expect(page.getByRole("row", { name: /Past Card 引き落とし/ }).first()).toContainText(formatCurrency(9000));
  await expect(page.getByRole("row", { name: /Backup Card 引き落とし/ }).first()).toContainText(formatCurrency(5000));
});

test("shows a critical judgement when an account is forecast to go negative", async ({ page }) => {
  const account = await seedAccount({ name: "Warning Account", balance: 1000, sortOrder: 1 });

  await seedRecurringItem({
    name: "Large Expense",
    type: "expense",
    amount: 100000,
    dayOfMonth: getFutureDayOfMonth(),
    accountId: account.id,
    sortOrder: 1,
  });

  await navigateTo(page, "/");

  // 水位ヘッダーが危険の言い切り文と「あと N 日」を表示する
  await expect(page.getByText(/に Warning Account が赤字になります/)).toBeVisible();
  await expect(page.getByText("危険")).toBeVisible();
  // 口座別水位リストにも同じ 3 値が反映される
  await expect(page.getByRole("button", { name: /Warning Account/ })).toContainText("赤字見込み");
});

test("shows a warning judgement for disposable balance without the critical one", async ({ page }) => {
  const account = await seedAccount({
    name: "Disposable Warning Account",
    balance: 100000,
    balanceOffset: 80000,
    sortOrder: 1,
  });

  await seedRecurringItem({
    name: "Buffered Expense",
    type: "expense",
    amount: 30000,
    dayOfMonth: getFutureDayOfMonth(),
    startDate: new Date(`${getYearMonth(0)}-01T00:00:00.000Z`),
    endDate: new Date(`${getYearMonth(0)}-${String(getLastDayOfMonth()).padStart(2, "0")}T00:00:00.000Z`),
    accountId: account.id,
    sortOrder: 1,
  });

  await navigateTo(page, "/");

  // 水位ヘッダーが警告（黄）の言い切り文を表示し、危険（朱）の文は出さない
  await expect(page.getByText(/に Disposable Warning Account の可処分残高がマイナスになります/)).toBeVisible();
  await expect(page.getByText("警告")).toBeVisible();
  await expect(page.getByText(/が赤字になります/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Disposable Warning Account/ })).toContainText("可処分注意");
});

test("shows actual and assumed credit card events together with loan events", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account", balance: 100000, sortOrder: 1 });
  const actualCard = await seedCreditCard({
    name: "Actual Card",
    accountId: account.id,
    settlementDay: getFutureDayOfMonth(),
    assumptionAmount: 10000,
    sortOrder: 1,
  });
  await seedCreditCard({
    name: "Assumption Card",
    accountId: account.id,
    settlementDay: getFutureDayOfMonth(),
    assumptionAmount: 20000,
    sortOrder: 2,
  });
  await seedBilling(getYearMonth(1), [{ creditCardId: actualCard.id, amount: 12345 }], new Date(`${getYearMonth(1)}-01T00:00:00.000Z`));
  await seedLoan({
    name: "Laptop Loan",
    accountId: account.id,
    totalAmount: 60000,
    paymentCount: 12,
  });
  await seedRecurringItem({
    name: "Salary",
    type: "income",
    amount: 300000,
    dayOfMonth: getFutureDayOfMonth(),
    accountId: account.id,
    sortOrder: 1,
  });

  await navigateTo(page, "/");

  await expect(page.getByText("Actual Card 引き落とし").first()).toBeVisible();
  await expect(page.getByText("Assumption Card 仮定値").first()).toBeVisible();
  await expect(page.getByText("ローン: Laptop Loan").first()).toBeVisible();
});
