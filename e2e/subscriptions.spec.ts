import { expect, test } from "@playwright/test";
import { navigateTo, waitForReload } from "./helpers/actions";
import { resetDatabase, seedSubscription } from "./helpers/db";

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

test("creates a subscription", async ({ page }) => {
  await navigateTo(page, "/subscriptions");

  await page.getByLabel("サービス名 *").first().fill("Netflix");
  await page.getByLabel("金額 (円) *").fill("1490");
  await page.getByLabel("頻度").selectOption("1");
  await page.getByLabel("課金開始日 *").fill("2026-03-05");
  await page.getByLabel("課金日 (1-31)").fill("5");
  await page.getByLabel("支払い元").fill("Visa");
  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const listCard = page.getByRole("heading", { name: "サブスク一覧" }).locator("../..");
  const monthlyCard = page.getByRole("heading", { name: "月別一覧" }).locator("../..");
  const row = listCard.getByRole("row", { name: /Netflix/ });
  await expect(row).toContainText(formatCurrency(1490));
  await expect(monthlyCard).toContainText(formatCurrency(1490));
});

test("edits and deletes a subscription", async ({ page }) => {
  await seedSubscription({
    name: "Spotify",
    amount: 980,
    intervalMonths: 1,
    startDate: new Date("2026-01-03T00:00:00.000Z"),
    dayOfMonth: 3,
    paymentSource: "Master",
  });

  await navigateTo(page, "/subscriptions");

  const row = page.getByRole("row", { name: /Spotify/ });
  await row.getByRole("button", { name: "編集" }).click();
  await page.getByLabel("金額 (円) *").last().fill("1280");
  await page.getByLabel("支払い元").last().fill("Master Gold");
  await page.getByRole("button", { name: "保存" }).click();
  await waitForReload(page);

  const listCard = page.getByRole("heading", { name: "サブスク一覧" }).locator("../..");
  await expect(listCard.getByRole("row", { name: /Spotify/ })).toContainText(formatCurrency(1280));
  await expect(listCard.getByRole("row", { name: /Spotify/ })).toContainText("Master Gold");

  page.once("dialog", (dialog) => dialog.accept());
  await listCard.getByRole("row", { name: /Spotify/ }).getByRole("button", { name: "削除" }).click();
  await waitForReload(page);

  await expect(page.getByText("Spotify")).toHaveCount(0);
});

test("switches monthly targets and annual totals correctly", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-03-14T00:00:00.000Z") });

  await seedSubscription({
    name: "Netflix",
    amount: 1500,
    intervalMonths: 1,
    startDate: new Date("2026-01-05T00:00:00.000Z"),
    dayOfMonth: 5,
    paymentSource: "Visa",
  });
  await seedSubscription({
    name: "Adobe CC",
    amount: 3000,
    intervalMonths: 3,
    startDate: new Date("2026-02-10T00:00:00.000Z"),
    dayOfMonth: 10,
    paymentSource: "Main Account",
  });

  await navigateTo(page, "/subscriptions");

  const monthlyCard = page.getByRole("heading", { name: "月別一覧" }).locator("../..");
  const annualCard = page.getByText("2026年の年間合計").locator("../..");

  await page.getByRole("button", { name: "前月" }).click();
  await expect(monthlyCard).toContainText("2026年2月");
  await expect(monthlyCard).toContainText("Netflix");
  await expect(monthlyCard).toContainText("Adobe CC");
  await expect(monthlyCard).toContainText(formatCurrency(4500));

  await page.getByRole("button", { name: "次月" }).click();
  await expect(monthlyCard).toContainText("2026年3月");
  await expect(monthlyCard).not.toContainText("Adobe CC");
  await expect(monthlyCard).toContainText(formatCurrency(1500));

  await expect(annualCard).toContainText(formatCurrency(30000));
});
