import { expect, test } from "@playwright/test";
import { fillAndSubmitAccountForm, navigateTo, waitForReload } from "../helpers/actions";
import { resetDatabase } from "../helpers/db";
import { formatCurrency, getForecastDayOfMonth, getFutureDate } from "../helpers/scenario";

test.beforeEach(async () => {
  await resetDatabase();
});

test("reflects newly created accounts and recurring items on the dashboard forecast", async ({ page }) => {
  const forecastDayOfMonth = getForecastDayOfMonth();

  await navigateTo(page, "/accounts");
  await fillAndSubmitAccountForm(page, {
    name: "メイン口座",
    balance: 500000,
    sortOrder: 1,
  });
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /メイン口座/ }).first()).toContainText(formatCurrency(500000));

  await navigateTo(page, "/recurring");

  await page.getByRole("button", { name: "固定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("給料");
  await page.getByLabel("種別").first().selectOption("income");
  await page.getByLabel("金額 (円)").first().fill("250000");
  await page.getByLabel("毎月の発生日").first().fill(String(forecastDayOfMonth));
  await page.getByLabel("振り込み先口座 *").selectOption({ label: "メイン口座" });
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /給料/ })).toContainText("収入");

  await page.getByRole("button", { name: "固定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("家賃");
  await page.getByLabel("種別").first().selectOption("expense");
  await page.getByLabel("金額 (円)").first().fill("80000");
  await page.getByLabel("毎月の発生日").first().fill(String(forecastDayOfMonth));
  await page.getByLabel("引き落とし口座 *").selectOption({ label: "メイン口座" });
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  await expect(page.getByRole("row", { name: /家賃/ })).toContainText("支出");

  await navigateTo(page, "/");

  await expect(page.getByText("総資産").locator("..")).toContainText(formatCurrency(500000));
  await expect(page.getByText("次の収入").locator("..")).toContainText("給料");
  await expect(page.getByText("次の支出").locator("..")).toContainText("家賃");

  const forecastTable = page.locator("table").last();
  await expect(forecastTable.getByRole("cell", { name: "給料" }).first()).toBeVisible();
  await expect(forecastTable.getByRole("cell", { name: "家賃" }).first()).toBeVisible();
  await expect(page.locator("svg.recharts-surface")).toBeVisible();
});

test("reflects recurring transfers in account forecasts and confirms them as transfer transactions", async ({ page }) => {
  const eventDate = getFutureDate(7);
  const dayOfMonth = Number(eventDate.slice(8, 10));

  await navigateTo(page, "/accounts");
  await fillAndSubmitAccountForm(page, {
    name: "給与口座",
    balance: 300000,
    sortOrder: 1,
  });
  await waitForReload(page);
  await fillAndSubmitAccountForm(page, {
    name: "引落口座",
    balance: 10000,
    sortOrder: 2,
  });
  await waitForReload(page);

  await navigateTo(page, "/recurring");
  await page.getByRole("button", { name: "固定収支を追加" }).click();
  await page.getByLabel("カテゴリ名 *").first().fill("資金移動");
  await page.getByLabel("種別").first().selectOption("transfer");
  await page.getByLabel("金額 (円)").first().fill("100000");
  await page.getByLabel("毎月の発生日").first().fill(String(dayOfMonth));
  await page.getByLabel("開始日").first().fill(eventDate);
  await page.getByLabel("終了日").first().fill(eventDate);
  await page.getByLabel("振替元口座 *").selectOption({ label: "給与口座" });
  await page.getByLabel("振替先口座 *").selectOption({ label: "引落口座" });
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const recurringRow = page.getByRole("row", { name: /資金移動/ });
  await expect(recurringRow).toContainText("振替");
  await expect(recurringRow).toContainText("給与口座 → 引落口座");

  await navigateTo(page, "/");
  await expect(page.getByText("総資産").locator("..")).toContainText(formatCurrency(310000));

  await page.getByRole("button", { name: "引落口座" }).click();
  const transferRow = page.locator("table").last().getByRole("row", { name: /資金移動/ });
  await expect(transferRow).toContainText("振替");
  await expect(transferRow).toContainText("給与口座 → 引落口座");
  await expect(transferRow).toContainText(formatCurrency(110000));

  await transferRow.getByRole("button", { name: "確定" }).click();
  await expect(page.getByRole("heading", { name: "予測イベントを確定" })).toBeVisible();
  await expect(page.getByLabel("対象口座")).toBeDisabled();
  await page.getByRole("button", { name: "確定する" }).click();
  await waitForReload(page);

  await expect(page.locator("table").last().getByRole("cell", { name: "資金移動" })).toHaveCount(0);

  await navigateTo(page, "/accounts");
  await expect(page.getByRole("row", { name: /給与口座/ }).first()).toContainText(formatCurrency(200000));
  await expect(page.getByRole("row", { name: /引落口座/ }).first()).toContainText(formatCurrency(110000));

  await navigateTo(page, "/transactions");
  await page.getByLabel("期間プリセット").selectOption("all");
  await waitForReload(page);
  const transactionRow = page.getByRole("row", { name: /資金移動/ }).first();
  await expect(transactionRow).toContainText("振替");
  await expect(transactionRow).toContainText("給与口座 -> 引落口座");
  await expect(transactionRow).toContainText(formatCurrency(100000));
});
