import { expect, test } from "@playwright/test";
import { fillAndSubmitAccountForm, navigateTo, waitForReload } from "../helpers/actions";
import { resetDatabase } from "../helpers/db";
import { formatCurrency, getFutureDate } from "../helpers/scenario";

test.beforeEach(async () => {
  await resetDatabase();
});

test("keeps the total balance unchanged while reflecting transfers across accounts", async ({ page }) => {
  await navigateTo(page, "/accounts");

  await fillAndSubmitAccountForm(page, {
    name: "メイン口座",
    balance: 500000,
    sortOrder: 1,
  });
  await waitForReload(page);

  await fillAndSubmitAccountForm(page, {
    name: "貯蓄口座",
    balance: 100000,
    sortOrder: 2,
  });
  await waitForReload(page);

  await navigateTo(page, "/transactions");

  await page.locator("select").nth(0).selectOption({ label: "メイン口座" });
  await page.locator("select").nth(1).selectOption("transfer");
  await page.locator('input[type="date"]').fill(getFutureDate(0));
  await page.locator("select").nth(2).selectOption({ label: "貯蓄口座" });
  await page.getByPlaceholder("内容").fill("口座移動");
  await page.getByPlaceholder("金額").fill("100000");
  await page.getByRole("button", { name: "取引を記録" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /口座移動/ }).first()).toContainText("メイン口座 -> 貯蓄口座");

  await navigateTo(page, "/accounts");
  await expect(page.getByRole("row", { name: /メイン口座/ }).first()).toContainText(formatCurrency(400000));
  await expect(page.getByRole("row", { name: /貯蓄口座/ }).first()).toContainText(formatCurrency(200000));

  await navigateTo(page, "/");
  await expect(page.getByText("総所持金").locator("..")).toContainText(formatCurrency(600000));
});
