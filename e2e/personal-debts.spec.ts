import { expect, test } from "@playwright/test";
import { navigateTo, waitForReload } from "./helpers/actions";
import { resetDatabase, seedAccount } from "./helpers/db";
import { formatCurrency, getFutureDate } from "./helpers/scenario";

test.beforeEach(async () => {
  await resetDatabase();
});

test("creates and settles a one-to-one lent debt", async ({ page }) => {
  const account = await seedAccount({ name: "Wallet", balance: 10000, sortOrder: 1 });

  await navigateTo(page, "/personal-debts");
  await page.getByLabel("貸し借り種別").selectOption("lent");
  await page.getByLabel("相手").fill("A");
  await page.getByLabel("タイトル").fill("Lunch loan");
  await page.getByLabel("元金").fill("3000");
  await page.getByLabel("入出金口座").selectOption(account.id);
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const row = page.getByRole("row", { name: /Lunch loan/ }).first();
  await expect(row).toContainText("貸した");
  await expect(row).toContainText(formatCurrency(3000));

  await row.getByRole("button", { name: "返済登録" }).click();
  await page.getByLabel("精算額").fill("1000");
  await page.getByRole("button", { name: "登録" }).click();
  await waitForReload(page);

  const updatedRow = page.getByRole("row", { name: /Lunch loan/ }).first();
  await expect(updatedRow).toContainText(formatCurrency(1000));
  await expect(updatedRow).toContainText(formatCurrency(2000));

  await navigateTo(page, "/transactions");
  await page.getByLabel("期間プリセット").selectOption("all");
  await waitForReload(page);
  await expect(page.getByRole("row", { name: /貸し借り: Lunch loan/ })).toContainText("支出");
  await expect(page.getByRole("row", { name: /精算: Lunch loan/ })).toContainText("収入");
});

test("creates a self-paid split bill and settles generated participant debts", async ({ page }) => {
  const account = await seedAccount({ name: "Wallet", balance: 20000, sortOrder: 1 });

  await navigateTo(page, "/personal-debts");
  await page.getByRole("button", { name: "割り勘" }).click();
  await page.getByLabel("割り勘タイトル").fill("Dinner");
  await page.getByLabel("総額").fill("12000");
  await page.getByLabel("精算口座").selectOption(account.id);
  await expect(page.getByText(`Aさん: ${formatCurrency(4000)}`)).toBeVisible();
  await expect(page.getByText(`Bさん: ${formatCurrency(4000)}`)).toBeVisible();
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  await expect(page.getByText("総額 " + formatCurrency(12000))).toBeVisible();
  await expect(page.getByRole("row", { name: /Aさん/ })).toContainText(formatCurrency(4000));
  await expect(page.getByRole("row", { name: /Bさん/ })).toContainText(formatCurrency(4000));

  for (const name of ["Aさん", "Bさん"]) {
    await page.getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: "返済登録" }).click();
    await expect(page.getByLabel("精算額")).toHaveValue("4000");
    await page.getByRole("button", { name: "登録" }).click();
    await waitForReload(page);
  }

  await page.getByLabel("ステータス").selectOption("all");
  await waitForReload(page);
  await expect(page.getByText("自分が支払った / 完済")).toBeVisible();
});

test("confirms a due debt forecast from the dashboard", async ({ page }) => {
  const account = await seedAccount({ name: "Wallet", balance: 10000, sortOrder: 1 });

  await navigateTo(page, "/personal-debts");
  await page.getByLabel("貸し借り種別").selectOption("lent");
  await page.getByLabel("相手").fill("A");
  await page.getByLabel("タイトル").fill("Due loan");
  await page.getByLabel("元金").fill("5000");
  await page.getByLabel("返済予定日").fill(getFutureDate(7));
  await page.getByLabel("入出金口座").selectOption(account.id);
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  await navigateTo(page, "/");
  await expect(page.getByText("精算予定: Due loan (A)").first()).toBeVisible();
  await page.getByRole("button", { name: "確定" }).first().click();
  await expect(page.getByLabel("実際の金額")).toHaveValue("5000");
  await page.getByRole("button", { name: "確定する" }).click();
  await waitForReload(page);
  await expect(page.getByText("精算予定: Due loan (A)")).toHaveCount(0);

  await navigateTo(page, "/personal-debts");
  await page.getByLabel("ステータス").selectOption("all");
  await waitForReload(page);
  await expect(page.getByRole("row", { name: /Due loan/ })).toContainText("完済");
});
