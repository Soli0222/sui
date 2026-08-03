import { expect, test } from "@playwright/test";
import { navigateTo, waitForReload } from "./helpers/actions";
import { resetDatabase, seedSalary } from "./helpers/db";

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

test("creates a salary record and shows derived net", async ({ page }) => {
  await navigateTo(page, "/salaries");

  await page.getByRole("button", { name: "給与明細を追加" }).click();
  await page.getByLabel("支給日 *").fill(`${currentYear}-05-10`);
  await page.getByLabel("名称").fill("May Salary");
  await page.getByLabel("額面 *").fill("350000");
  await page.getByLabel("健康保険").fill("15000");
  await page.getByLabel("厚生年金").fill("25000");
  await page.getByLabel("雇用保険").fill("1000");
  await page.getByLabel("子ども子育て支援金").fill("2000");
  await page.getByLabel("所得税").fill("20000");
  await page.getByLabel("住民税").fill("12000");
  await page.getByLabel("その他控除").fill("5000");
  await page.getByLabel("持株会拠出金").fill("10000");
  await page.getByLabel("持株会奨励金(控除)").fill("500");
  await page.getByLabel("DCマッチング拠出金").fill("7000");

  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const listCard = page.getByRole("heading", { name: "明細一覧" }).locator("../..");
  const row = listCard.getByRole("row", { name: /May Salary/ });
  await expect(row).toContainText(formatCurrency(350000));
  await expect(row).toContainText(formatCurrency(43000));
  await expect(row).toContainText(formatCurrency(97500));
  await expect(row).toContainText(formatCurrency(252500));

  const summaryCard = page.getByText(`${currentYear}年の額面合計`).locator("../..");
  await expect(summaryCard).toContainText(formatCurrency(97500));
});

test("accepts a negative year-end tax adjustment and raises the net amount", async ({ page }) => {
  await navigateTo(page, "/salaries");

  await page.getByRole("button", { name: "給与明細を追加" }).click();
  await page.getByLabel("支給日 *").fill(`${currentYear}-12-25`);
  await page.getByLabel("名称").fill("December Salary");
  await page.getByLabel("額面 *").fill("350000");
  await page.getByLabel("健康保険").fill("15000");
  await page.getByLabel("所得税").fill("20000");
  await page.getByLabel("年末調整過不足税額").fill("-30000");

  await page.getByRole("button", { name: "追加" }).click();
  await waitForReload(page);

  const listCard = page.getByRole("heading", { name: "明細一覧" }).locator("../..");
  const row = listCard.getByRole("row", { name: /December Salary/ });
  await expect(row).toContainText(formatCurrency(350000));
  await expect(row).toContainText(formatCurrency(5000));
  await expect(row).toContainText(formatCurrency(345000));
});

test("edits and deletes a salary record", async ({ page }) => {
  await seedSalary({
    paidOn: new Date(`${currentYear}-03-15T00:00:00.000Z`),
    kind: "salary",
    name: "March",
    grossAmount: 300000,
    incomeTax: 20000,
    residentTax: 10000,
  });

  await navigateTo(page, "/salaries");

  const row = page.getByRole("row", { name: /March/ });
  await row.getByRole("button", { name: "編集" }).click();
  await page.getByRole("dialog").getByLabel("額面 *").fill("400000");
  await page.getByRole("dialog").getByLabel("所得税").last().fill("30000");
  await page.getByRole("dialog").getByRole("button", { name: "保存" }).click();
  await waitForReload(page);

  const listCard = page.getByRole("heading", { name: "明細一覧" }).locator("../..");
  const updatedRow = listCard.getByRole("row", { name: /March/ });
  await expect(updatedRow).toContainText(formatCurrency(400000));
  await expect(updatedRow).toContainText(formatCurrency(360000));

  await updatedRow.getByRole("button", { name: "削除" }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await waitForReload(page);

  await expect(page.getByText("March")).toHaveCount(0);
});

test("switches year and shows annual summary", async ({ page }) => {
  await seedSalary({
    paidOn: new Date(`${previousYear}-12-15T00:00:00.000Z`),
    kind: "salary",
    name: "Previous Year",
    grossAmount: 300000,
  });
  await seedSalary({
    paidOn: new Date(`${currentYear}-06-15T00:00:00.000Z`),
    kind: "bonus",
    name: "Summer Bonus",
    grossAmount: 500000,
  });

  await navigateTo(page, "/salaries");

  await expect(page.getByText(`${currentYear}年の額面合計`).locator("../..")).toContainText(
    formatCurrency(500000),
  );
  await expect(page.getByText("手取り合計").locator("../..")).toContainText(formatCurrency(500000));

  await page.getByLabel("年を選択").selectOption(String(previousYear));
  await waitForReload(page);

  await expect(page.getByText(`${previousYear}年の額面合計`).locator("../..")).toContainText(
    formatCurrency(300000),
  );
});
