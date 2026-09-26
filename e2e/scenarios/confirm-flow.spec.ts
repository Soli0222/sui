import { expect, test } from "../helpers/test";
test.use({ viewport: { width: 1920, height: 900 } });
import { navigateTo, waitForReload } from "../helpers/actions";
import { seedAccount, seedRecurringItem } from "../helpers/db";
import { formatCurrency, getFutureDate } from "../helpers/scenario";

test("confirms a forecast event and reflects it in balances and transactions", async ({ page }) => {
  const account = await seedAccount({ name: "生活口座", balance: 300000, sortOrder: 1 });
  const eventDate = getFutureDate(7);
  const recurringMonth = new Date(`${eventDate}T00:00:00.000Z`);

  await seedRecurringItem({
    name: "家賃",
    type: "expense",
    amount: 50000,
    dayOfMonth: Number(eventDate.slice(8, 10)),
    startDate: recurringMonth,
    endDate: recurringMonth,
    accountId: account.id,
    sortOrder: 1,
  });

  await navigateTo(page, "/");

  await expect(page.getByRole("button", { name: "確定" }).first()).toBeVisible();
  await page.getByRole("button", { name: "確定" }).first().click();
  await expect(page.getByRole("heading", { name: "予測イベントを確定" })).toBeVisible();
  await expect(page.getByLabel("実際の金額")).toHaveValue("50000");
  await page.getByRole("button", { name: "確定する" }).click();
  await waitForReload(page);

  await expect(page.locator("table").last().getByRole("cell", { name: "家賃" })).toHaveCount(0);
  await expect(page.getByText("総資産").locator("..")).toContainText(formatCurrency(250000));

  await navigateTo(page, "/accounts");
  await expect(page.getByText("生活口座", { exact: true }).locator("xpath=ancestor::tr | ancestor::li")).toContainText(formatCurrency(250000));

  await navigateTo(page, "/transactions");
  await page.getByLabel("期間プリセット").selectOption("all");
  await waitForReload(page);
  const row = page.getByRole("row", { name: /家賃/ }).first();
  await expect(row).toContainText("支出");
  await expect(row).toContainText(formatCurrency(50000));
});

test("saves a foreign-currency confirmation in USD cents after an API error", async ({ page }) => {
  const usdAccount = await seedAccount({
    name: "USD Wallet",
    balance: 10_000,
    currencyCode: "USD",
    exchangeRateToJpy: 150,
    sortOrder: 1,
  });
  const eventDate = getFutureDate(7);
  const recurringMonth = new Date(`${eventDate}T00:00:00.000Z`);
  await seedRecurringItem({
    name: "USD Hosting", type: "expense", amount: 2_500,
    dayOfMonth: Number(eventDate.slice(8, 10)),
    startDate: recurringMonth, endDate: recurringMonth,
    accountId: usdAccount.id, sortOrder: 1,
  });

  await navigateTo(page, "/");
  const forecastTable = page.locator("table").last();
  const usdRow = forecastTable.getByRole("row", { name: /USD Hosting/ });
  await expect(usdRow).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "予測イベントを確定" });
  const amountInput = dialog.getByLabel("実際の金額");
  await usdRow.getByRole("button", { name: "確定" }).click();
  await expect(amountInput).toHaveValue("25.00");
  await amountInput.fill("1.23");

  let attempts = 0;
  const postedAmounts: number[] = [];
  await page.route("**/api/dashboard/confirm", async (route) => {
    postedAmounts.push(JSON.parse(route.request().postData() ?? "{}").amount);
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"temporary failure"}' });
    } else {
      await route.continue();
    }
  });

  await dialog.getByRole("button", { name: "確定する" }).click();
  await expect(page.getByText("確定に失敗しました", { exact: true })).toBeVisible();
  await expect(amountInput).toHaveValue("1.23");
  await amountInput.fill("12.34");
  await dialog.getByRole("button", { name: "確定する" }).click();
  await expect(dialog).toHaveCount(0);
  expect(postedAmounts).toEqual([123, 1234]);

  await navigateTo(page, "/accounts");
  await expect(page.getByText("USD Wallet", { exact: true }).locator("xpath=ancestor::tr | ancestor::li")).toContainText("$87.66");
  await navigateTo(page, "/transactions");
  await page.getByLabel("期間プリセット").selectOption("all");
  await waitForReload(page);
  await expect(page.getByRole("row", { name: /USD Hosting/ }).first()).toContainText("$12.34");
});
