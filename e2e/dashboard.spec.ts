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

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
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

function getFutureDayOfMonth() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return Math.min(jst.getUTCDate() + 1, 28);
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("shows zero summaries and none labels on an empty dashboard", async ({ page }) => {
  await navigateTo(page, "/");

  await expect(page.getByText("総所持金").locator("..")).toContainText(formatCurrency(0));
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

  await expect(page.getByText("総所持金").locator("..")).toContainText(formatCurrency(100000));
  await expect(page.getByRole("cell", { name: "Salary" }).first()).toBeVisible();
  await expect(page.locator("svg.recharts-surface")).toBeVisible();
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

test("shows a red balance warning card", async ({ page }) => {
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

  await expect(page.getByText("🔴 実残高がマイナスになる見込み")).toBeVisible();
  await expect(page.getByText(/Warning Account（/).first()).toBeVisible();
});

test("shows a yellow disposable balance warning card without the red warning", async ({ page }) => {
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
    endDate: new Date(`${getYearMonth(0)}-28T00:00:00.000Z`),
    accountId: account.id,
    sortOrder: 1,
  });

  await navigateTo(page, "/");

  await expect(page.getByText("⚠️ 可処分残高がマイナスになる見込み")).toBeVisible();
  await expect(page.getByText(/Disposable Warning Account（/).first()).toBeVisible();
  await expect(page.getByText("🔴 実残高がマイナスになる見込み")).toHaveCount(0);
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
