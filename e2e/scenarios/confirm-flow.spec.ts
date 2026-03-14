import { expect, test } from "@playwright/test";
import { navigateTo, waitForReload } from "../helpers/actions";
import { resetDatabase, seedAccount, seedRecurringItem } from "../helpers/db";
import { formatCurrency, getFutureDate } from "../helpers/scenario";

test.beforeEach(async () => {
  await resetDatabase();
});

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
  await expect(page.getByText("総所持金").locator("..")).toContainText(formatCurrency(250000));

  await navigateTo(page, "/accounts");
  await expect(page.getByRole("row", { name: /生活口座/ }).first()).toContainText(formatCurrency(250000));

  await navigateTo(page, "/transactions");
  const row = page.getByRole("row", { name: /家賃/ }).first();
  await expect(row).toContainText("支出");
  await expect(row).toContainText(formatCurrency(50000));
});
