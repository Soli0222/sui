import { expect, test } from "./helpers/test";
import { navigateTo, waitForReload } from "./helpers/actions";
import { seedSalary } from "./helpers/db";

test.use({ viewport: { width: 1920, height: 900 } });

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
  await page.getByRole("button", { name: "その他の控除・拠出" }).click();
  await page.getByLabel("その他控除").fill("5000");
  await page.getByLabel("持株会拠出金").fill("10000");
  await page.getByLabel("持株会奨励金(控除)").fill("500");
  await page.getByLabel("DCマッチング拠出金").fill("7000");

  await page.getByRole("button", { name: "明細を追加" }).click();
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

  await page.getByRole("button", { name: "明細を追加" }).click();
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
  await expect(page).toHaveURL(/\/salaries\/[^/]+\/edit/);
  await page.getByLabel("額面 *").fill("400000");
  await page.getByLabel("所得税").fill("30000");
  await page.getByRole("button", { name: "変更を保存" }).click();
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

test("opens a salary directly and round trips every field including a negative adjustment", async ({ page }) => {
  const record = await seedSalary({
    paidOn: new Date(`${previousYear}-12-20T00:00:00.000Z`), kind: "bonus", name: "Full bonus",
    grossAmount: 500000, healthInsurance: 1000, pensionInsurance: 2000,
    employmentInsurance: 3000, childcareSupportLevy: 4000, incomeTax: 5000,
    residentTax: 6000, yearEndTaxAdjustment: -7000, otherDeductions: 8000,
    employeeStockContribution: 9000, employeeStockIncentive: 10000, dcMatchingContribution: 11000,
  });
  await navigateTo(page, `/salaries/${record.id}/edit?year=${previousYear}`);
  await expect(page.getByRole("heading", { name: /Full bonus.*編集/ })).toBeVisible();
  await expect(page.getByLabel("種別")).toHaveValue("bonus");
  const fields = [
    ["額面 *", "500000"], ["健康保険", "1000"], ["厚生年金", "2000"],
    ["雇用保険", "3000"], ["子ども子育て支援金", "4000"], ["所得税", "5000"],
    ["住民税", "6000"], ["年末調整過不足税額", "-7000"], ["その他控除", "8000"],
    ["持株会拠出金", "9000"], ["持株会奨励金(控除)", "10000"], ["DCマッチング拠出金", "11000"],
  ] as const;
  for (const [label, value] of fields) await expect(page.getByLabel(label)).toHaveValue(value);
  await page.getByLabel("年末調整過不足税額").fill("-9000");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(page).toHaveURL(new RegExp(`/salaries\\?year=${previousYear}`));
  await expect(page.getByRole("row", { name: /Full bonus/ })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("年を選択")).toHaveValue(String(previousYear));
  await page.getByRole("row", { name: /Full bonus/ }).getByRole("button", { name: "編集" }).click();
  await expect(page.getByLabel("年末調整過不足税額")).toHaveValue("-9000");
  for (const [label, value] of fields.filter(([label]) => label !== "年末調整過不足税額")) {
    await expect(page.getByLabel(label)).toHaveValue(value);
  }
});

test("keeps salary draft on mutation failure and refreshes without sending a second update", async ({ page }) => {
  const record = await seedSalary({ paidOn: new Date(`${currentYear}-06-15T00:00:00.000Z`), name: "Retry bonus", grossAmount: 100000 });
  let patches = 0;
  let failMutation = true;
  let failRefresh = true;
  await page.route(`**/api/salary-records/${record.id}`, async (route) => {
    if (route.request().method() === "PATCH") {
      patches++;
      if (failMutation) {
        failMutation = false;
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "保存できません" }) });
        return;
      }
    }
    if (route.request().method() === "GET" && patches === 2 && failRefresh) {
      failRefresh = false;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "再取得できません" }) });
      return;
    }
    await route.continue();
  });
  await navigateTo(page, `/salaries/${record.id}/edit`);
  await page.getByLabel("額面 *").fill("120000");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(page.getByRole("alert")).toContainText("保存できません");
  await expect(page.getByLabel("額面 *")).toHaveValue("120000");
  await page.getByRole("button", { name: "キャンセル" }).click();
  await expect(page.getByRole("dialog", { name: "未保存の変更を破棄しますか？" })).toBeVisible();
  await page.getByRole("button", { name: "編集を続ける" }).click();
  await page.getByRole("button", { name: "変更を保存" }).dispatchEvent("click");
  await page.getByRole("button", { name: "変更を保存" }).dispatchEvent("click");
  await expect(page.getByText("保存済み・表示更新失敗")).toBeVisible();
  await page.getByRole("button", { name: "表示を再取得" }).click();
  await expect(page.getByRole("row", { name: /Retry bonus/ })).toBeVisible();
  expect(patches).toBe(2);
});

test("shows a recoverable error for a missing salary URL", async ({ page }) => {
  // eslint-disable-next-line sui/no-fixed-e2e-date -- 存在しないレコード ID の固定 UUID であり日付ではない
  await navigateTo(page, "/salaries/11111111-1111-4111-a111-111111111111/edit");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "給与ログに戻る" }).click();
  await expect(page.getByRole("heading", { name: "給与ログ" })).toBeVisible();
});

test("keeps salary input and save reachable in a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 500 });
  await navigateTo(page, "/salaries/new");
  await expect(page.getByLabel("支給日 *")).not.toHaveValue("");
  await page.getByLabel("名称").fill("Narrow salary");
  await page.getByLabel("額面 *").fill("1000");
  await page.getByRole("button", { name: "明細を追加" }).click();
  await expect(page.getByText("Narrow salary")).toBeVisible();
});
