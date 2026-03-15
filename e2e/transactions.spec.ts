import { expect, test } from "@playwright/test";
import { navigateTo, waitForReload } from "./helpers/actions";
import { resetDatabase, seedAccount, seedTransaction, seedTransactions } from "./helpers/db";

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

test("records a manual expense transaction", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account", balance: 10000 });

  await navigateTo(page, "/transactions");

  await page.locator("select").nth(0).selectOption(account.id);
  await page.locator("select").nth(1).selectOption("expense");
  await page.locator('input[type="date"]').fill("2026-03-14");
  await page.getByPlaceholder("内容").fill("Lunch");
  await page.getByPlaceholder("金額").fill("1200");
  await page.getByRole("button", { name: "取引を記録" }).click();
  await waitForReload(page);

  const row = page.getByRole("row", { name: /Lunch/ });
  await expect(row).toContainText("支出");
  await expect(row).toContainText(formatCurrency(1200));
});

test("edits an existing transaction from the history table", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account", balance: 10000 });

  await seedTransaction({
    accountId: account.id,
    description: "Lunch",
    amount: 1200,
    type: "expense",
    date: new Date("2026-03-14T00:00:00.000Z"),
  });

  await navigateTo(page, "/transactions");

  const row = page.getByRole("row", { name: /Lunch/ });
  await row.getByRole("button", { name: "編集" }).click();

  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("内容").fill("Dinner");
  await dialog.getByPlaceholder("金額").fill("1800");
  await dialog.getByRole("button", { name: "保存" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /Dinner/ })).toContainText(formatCurrency(1800));
  await expect(page.getByText("Lunch")).toHaveCount(0);
});

test("records a transfer transaction and shows both account names", async ({ page }) => {
  const source = await seedAccount({ name: "Account A", balance: 10000, sortOrder: 1 });
  const destination = await seedAccount({ name: "Account B", balance: 5000, sortOrder: 2 });

  await navigateTo(page, "/transactions");

  await page.locator("select").nth(0).selectOption(source.id);
  await page.locator("select").nth(1).selectOption("transfer");
  await page.locator('input[type="date"]').fill("2026-03-14");
  await page.locator("select").nth(2).selectOption(destination.id);
  await page.getByPlaceholder("内容").fill("Move");
  await page.getByPlaceholder("金額").fill("3000");
  await page.getByRole("button", { name: "取引を記録" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /Move/ })).toContainText("Account A -> Account B");
});

test("filters transactions by account", async ({ page }) => {
  const first = await seedAccount({ name: "First Account", balance: 10000, sortOrder: 1 });
  const second = await seedAccount({ name: "Second Account", balance: 10000, sortOrder: 2 });

  await seedTransaction({
    accountId: first.id,
    description: "First Expense",
    amount: 1000,
    type: "expense",
  });
  await seedTransaction({
    accountId: second.id,
    description: "Second Expense",
    amount: 2000,
    type: "expense",
  });

  await navigateTo(page, "/transactions");

  await page.locator("select").nth(2).selectOption(first.id);
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
        date: new Date(`2026-03-${String(30 - index).padStart(2, "0")}T00:00:00.000Z`),
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
