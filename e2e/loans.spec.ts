import { expect, test } from "./helpers/test";
import { navigateTo, waitForReload } from "./helpers/actions";
import { seedAccount, seedLoan } from "./helpers/db";
import { getFutureDate } from "./helpers/scenario";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

test("creates a loan in normal mode", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/loans");

  await page.getByRole("button", { name: "ローンを追加" }).click();
  await page.getByLabel("商品名 *").first().fill("Laptop");
  await page.getByLabel("総支払額 *").first().fill("120000");
  await page.getByLabel("初回引落日 *").fill(getFutureDate());
  await page.getByLabel("支払回数 *").fill("12");
  await page.getByLabel("引き落とし口座 *").first().selectOption(account.id);
  await page.getByRole("dialog").getByRole("button", { name: "ローンを追加" }).click();
  await waitForReload(page);

  await expect(page.getByText("Laptop", { exact: true })).toBeVisible();
});

test("creates a loan in midway mode", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/loans");

  await page.getByRole("button", { name: "ローンを追加" }).click();
  await page.getByText("途中から入力する").first().click();
  await page.getByLabel("商品名 *").first().fill("Camera");
  await page.getByLabel("残り残高 *").first().fill("60000");
  await page.getByLabel("次回引落日 *").first().fill(getFutureDate());
  await page.getByLabel("残り回数 *").first().fill("6");
  await page.getByLabel("引き落とし口座 *").first().selectOption(account.id);
  await page.getByRole("dialog").getByRole("button", { name: "ローンを追加" }).click();
  await waitForReload(page);

  await expect(page.getByText("Camera", { exact: true })).toBeVisible();
  await expect(page.getByText("残り 6 回")).toBeVisible();
});

test("updates the monthly payment preview in real time", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/loans");

  await page.getByRole("button", { name: "ローンを追加" }).click();
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

  await page.getByRole("button", { name: "Phoneを編集" }).click();
  await page.getByLabel("商品名 *").last().fill("Phone Updated");
  await page.getByRole("dialog").getByRole("button", { name: "変更を保存" }).click();
  await waitForReload(page);
  await expect(page.getByText("Phone Updated", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Phone Updatedを削除" }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await waitForReload(page);
  await expect(page.getByText("Phone Updated")).toHaveCount(0);
});
