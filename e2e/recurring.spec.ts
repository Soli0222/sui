import { expect, test } from "@playwright/test";
import { navigateTo, waitForReload } from "./helpers/actions";
import { resetDatabase, seedAccount, seedRecurringItem } from "./helpers/db";

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

test("creates an income recurring item", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/recurring");

  await page.getByLabel("カテゴリ名 *").first().fill("Salary");
  await page.getByLabel("種別").first().selectOption("income");
  await page.getByLabel("金額 (円)").first().fill("300000");
  await page.getByLabel("毎月の発生日 (1-31)").first().fill("25");
  await page.getByLabel("振り込み先口座 *").selectOption(account.id);
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /Salary/ })).toContainText("収入");
});

test("creates an expense recurring item with a period", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/recurring");

  await page.getByLabel("カテゴリ名 *").first().fill("Rent");
  await page.getByLabel("種別").first().selectOption("expense");
  await page.getByLabel("金額 (円)").first().fill("80000");
  await page.getByLabel("毎月の発生日 (1-31)").first().fill("27");
  await page.getByLabel("開始日").first().fill("2026-03-01");
  await page.getByLabel("終了日").first().fill("2026-12-31");
  await page.getByLabel("引き落とし口座 *").selectOption(account.id);
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const row = page.getByRole("row", { name: /Rent/ });
  await expect(row).toContainText("支出");
  await expect(row).toContainText("2026年3月1日 〜 2026年12月31日");
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

  const row = page.getByRole("row", { name: /Subscription/ });
  await row.getByRole("button", { name: "編集" }).click();
  await page.getByLabel("金額 (円)").last().fill("2500");
  await page.getByRole("button", { name: "保存" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /Subscription/ })).toContainText(formatCurrency(2500));
});

test("keeps recurring item date shift policy through create and edit", async ({ page }) => {
  const account = await seedAccount({ name: "Main Account" });

  await navigateTo(page, "/recurring");

  await page.getByLabel("カテゴリ名 *").first().fill("Shifted Rent");
  await page.getByLabel("種別").first().selectOption("expense");
  await page.getByLabel("金額 (円)").first().fill("80000");
  await page.getByLabel("毎月の発生日 (1-31)").first().fill("31");
  await page.getByLabel("土日祝の扱い").first().selectOption("next");
  await page.getByLabel("引き落とし口座 *").selectOption(account.id);
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const row = page.getByRole("row", { name: /Shifted Rent/ });
  await row.getByRole("button", { name: "編集" }).click();
  await expect(page.getByLabel("土日祝の扱い").last()).toHaveValue("next");

  await page.getByLabel("金額 (円)").last().fill("81000");
  await page.getByRole("button", { name: "保存" }).click();
  await waitForReload(page);

  const updatedRow = page.getByRole("row", { name: /Shifted Rent/ });
  await expect(updatedRow).toContainText(formatCurrency(81000));
  await updatedRow.getByRole("button", { name: "編集" }).click();
  await expect(page.getByLabel("土日祝の扱い").last()).toHaveValue("next");
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

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("row", { name: /To Delete/ }).getByRole("button", { name: "削除" }).click();
  await waitForReload(page);

  await expect(page.getByText("To Delete")).toHaveCount(0);
});
