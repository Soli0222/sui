import { expect, test } from "@playwright/test";
import { navigateTo, waitForReload } from "./helpers/actions";
import { resetDatabase, seedAccount, seedLoan } from "./helpers/db";

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

test("creates a loan in normal mode", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/loans");

  await page.getByLabel("商品名 *").first().fill("Laptop");
  await page.getByLabel("総支払額 *").first().fill("120000");
  await page.getByLabel("初回引落日 *").fill("2026-04-15");
  await page.getByLabel("支払回数 *").fill("12");
  await page.getByLabel("引き落とし口座 *").first().selectOption(account.id);
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  await expect(page.getByText("Laptop")).toBeVisible();
});

test("creates a loan in midway mode", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/loans");

  await page.getByText("途中から入力する").first().click();
  await page.getByLabel("商品名 *").first().fill("Camera");
  await page.getByLabel("残り残高 *").first().fill("60000");
  await page.getByLabel("次回引落日 *").first().fill("2026-04-20");
  await page.getByLabel("残り回数 *").first().fill("6");
  await page.getByLabel("引き落とし口座 *").first().selectOption(account.id);
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  await expect(page.getByText("Camera")).toBeVisible();
  await expect(page.getByText("残り 6 回")).toBeVisible();
});

test("updates the monthly payment preview in real time", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/loans");

  await page.getByLabel("商品名 *").first().fill("Preview Loan");
  await page.getByLabel("総支払額 *").first().fill("1000");
  await page.getByLabel("支払回数 *").fill("3");
  await page.getByLabel("引き落とし口座 *").first().selectOption(account.id);

  await expect(page.getByText("月々の支払額プレビュー:").locator("..")).toContainText(formatCurrency(334));
});

test("edits and deletes a loan", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });
  await seedLoan({
    name: "Phone",
    accountId: account.id,
    totalAmount: 24000,
    paymentCount: 12,
  });

  await navigateTo(page, "/loans");

  const loanCard = page.locator("div.grid.gap-4.rounded-2xl").filter({ hasText: "Phone" }).first();
  await loanCard.getByRole("button", { name: "編集" }).click();
  await page.getByLabel("商品名 *").last().fill("Phone Updated");
  await page.getByRole("button", { name: "保存" }).click();
  await waitForReload(page);
  await expect(page.getByText("Phone Updated")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("div.grid.gap-4.rounded-2xl").filter({ hasText: "Phone Updated" }).first().getByRole("button", { name: "削除" }).click();
  await waitForReload(page);
  await expect(page.getByText("Phone Updated")).toHaveCount(0);
});
