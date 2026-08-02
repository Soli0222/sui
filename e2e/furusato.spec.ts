import { expect, test } from "@playwright/test";
import { navigateTo, waitForReload } from "./helpers/actions";
import { resetDatabase, seedDonation } from "./helpers/db";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

function getJstYear() {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
    }).format(new Date()),
  );
}

const currentYear = getJstYear();
const previousYear = currentYear - 1;

test.beforeEach(async () => {
  await resetDatabase();
});

test("creates a donation and shows annual total", async ({ page }) => {
  await navigateTo(page, "/furusato");

  await page.getByRole("button", { name: "寄付を追加" }).click();
  await page.getByLabel("寄付先 *").fill("Furusato City");
  await page.getByLabel("金額 *").fill("20000");
  await page.getByLabel("寄付日 *").fill(`${currentYear}-05-10`);
  await page.getByLabel("メモ").fill("Rice set");

  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const listCard = page.getByRole("heading", { name: "寄付一覧" }).locator("../..");
  const row = listCard.getByRole("row", { name: /Furusato City/ });
  await expect(row).toContainText(formatCurrency(20000));

  await expect(page.getByText(`${currentYear}年の寄付合計`).locator("../..")).toContainText(
    formatCurrency(20000),
  );
});

test("edits and deletes a donation", async ({ page }) => {
  await seedDonation({
    recipient: "Old City",
    amount: 10000,
    donatedOn: new Date(`${currentYear}-03-15T00:00:00.000Z`),
  });

  await navigateTo(page, "/furusato");

  const row = page.getByRole("row", { name: /Old City/ });
  await row.getByRole("button", { name: "編集" }).click();
  await page.getByRole("dialog").getByLabel("金額 *").fill("15000");
  await page.getByRole("dialog").getByRole("button", { name: "保存" }).click();
  await waitForReload(page);

  const listCard = page.getByRole("heading", { name: "寄付一覧" }).locator("../..");
  const updatedRow = listCard.getByRole("row", { name: /Old City/ });
  await expect(updatedRow).toContainText(formatCurrency(15000));

  await updatedRow.getByRole("button", { name: "削除" }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await waitForReload(page);

  await expect(page.getByText("Old City")).toHaveCount(0);
});

test("switches year and shows annual summary", async ({ page }) => {
  await seedDonation({
    recipient: "Previous Year",
    amount: 10000,
    donatedOn: new Date(`${previousYear}-12-31T00:00:00.000Z`),
  });
  await seedDonation({
    recipient: "Current Year",
    amount: 30000,
    donatedOn: new Date(`${currentYear}-01-01T00:00:00.000Z`),
  });

  await navigateTo(page, "/furusato");

  await expect(page.getByText(`${currentYear}年の寄付合計`).locator("../..")).toContainText(
    formatCurrency(30000),
  );

  await page.getByLabel("年を選択").selectOption(String(previousYear));
  await waitForReload(page);

  await expect(page.getByText(`${previousYear}年の寄付合計`).locator("../..")).toContainText(
    formatCurrency(10000),
  );
});
