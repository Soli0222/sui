import { expect, test, type Page } from "./helpers/test";
import { navigateTo, waitForReload } from "./helpers/actions";
import { seedAccount, seedBilling, seedCreditCard } from "./helpers/db";
import { getYearMonth } from "./helpers/scenario";

test.use({ viewport: { width: 1920, height: 900 } });

function getJstDate(offsetMonths = 0) {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth() + offsetMonths, 1));
}

function toYearMonth(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

function billingTable(page: Page) {
  return page.getByRole("table").first();
}

function billingRow(page: Page, cardName: string) {
  return billingTable(page).getByRole("row", { name: new RegExp(cardName) });
}

function billingTotalRow(page: Page) {
  return billingTable(page).getByRole("row", { name: /合計/ });
}

function billingInput(page: Page, cardName: string) {
  return billingRow(page, cardName).getByLabel(`${cardName} 実額`);
}

function cardListRow(page: Page, cardName: string) {
  return page.getByRole("button", { name: `${cardName}を編集` }).locator("xpath=ancestor::li");
}

test("creates a credit card", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });

  await navigateTo(page, "/credit-cards");

  await page.getByRole("button", { name: "カードを追加" }).click();
  const createDialog = page.getByRole("dialog");
  await createDialog.getByLabel("カード名 *").fill("Visa");
  await createDialog.getByLabel("毎月の発生日").fill("27");
  await createDialog.getByLabel("引き落とし口座 *").selectOption(account.id);
  await createDialog.getByLabel("金額 1 *").fill("50000");
  await createDialog.getByLabel("開始月 1").fill(getYearMonth(1));
  await createDialog.getByLabel("終了月 1").fill(getYearMonth(2));
  await createDialog.getByRole("button", { name: "期間を追加" }).click();
  await createDialog.getByLabel("金額 2 *").fill("30000");
  await createDialog.getByLabel("開始月 2").fill(getYearMonth(3));
  await createDialog.getByLabel("終了月 2").fill(getYearMonth(4));
  await createDialog.getByRole("button", { name: "詳細設定" }).click();
  await createDialog.getByLabel("表示順").fill("1");
  await createDialog.getByRole("button", { name: "カードを追加" }).click();
  await waitForReload(page);

  await expect(cardListRow(page, "Visa")).toContainText(formatCurrency(50000));
  await expect(cardListRow(page, "Visa")).toContainText(formatCurrency(30000));
  await expect(cardListRow(page, "Visa")).toContainText(getYearMonth(1));
  await expect(cardListRow(page, "Visa")).toContainText(getYearMonth(4));
  await expect(cardListRow(page, "Visa")).not.toContainText("表示順");

  const billing = billingRow(page, "Visa");
  await expect(billing).toBeVisible();
  const nameCenter = await billing.locator("td").first().evaluate((cell) => {
    const range = document.createRange();
    range.selectNodeContents(cell);
    const bounds = range.getBoundingClientRect();
    return bounds.y + bounds.height / 2;
  });
  const input = await billingInput(page, "Visa").boundingBox();
  expect(input).not.toBeNull();
  expect(Math.abs(nameCenter - (input!.y + input!.height / 2))).toBeLessThan(6);

  await page.setViewportSize({ width: 1280, height: 900 });
  const row = cardListRow(page, "Visa");
  const firstAmount = await row.getByText(formatCurrency(50000), { exact: true }).boundingBox();
  const secondAmount = await row.getByText(formatCurrency(30000), { exact: true }).boundingBox();
  const firstMonth = await row.getByText(getYearMonth(1), { exact: true }).boundingBox();
  const secondMonth = await row.getByText(getYearMonth(3), { exact: true }).boundingBox();
  expect(firstAmount).not.toBeNull();
  expect(secondAmount).not.toBeNull();
  expect(firstMonth).not.toBeNull();
  expect(secondMonth).not.toBeNull();
  expect(Math.abs(firstAmount!.x - secondAmount!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(firstMonth!.x - secondMonth!.x)).toBeLessThanOrEqual(1);
  const settlementDay = await row.getByText(/^引落日 /).boundingBox();
  const settlementAccount = await row.getByText(/^引落口座 /).boundingBox();
  expect(settlementDay).not.toBeNull();
  expect(settlementAccount).not.toBeNull();
  expect(settlementAccount!.y).toBeGreaterThan(settlementDay!.y);
});

test("keeps the new card's period button on one line at narrow widths", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await navigateTo(page, "/credit-cards");
  await page.getByRole("button", { name: "カードを追加" }).click();

  const dialog = page.getByRole("dialog");
  const buttonBox = await dialog.getByRole("button", { name: "期間を追加" }).boundingBox();
  const dialogBox = await dialog.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(dialogBox).not.toBeNull();
  expect(buttonBox!.height).toBeLessThanOrEqual(48);
  expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width);
});

test("keeps card details at the top as amount periods grow", async ({ page }) => {
  const account = await seedAccount({ name: "Card Account" });
  await seedCreditCard({ name: "Single Period", accountId: account.id,
    assumptions: [{ amount: 30000, startMonth: getYearMonth(0), endMonth: null }] });
  await seedCreditCard({ name: "Two Periods", accountId: account.id,
    assumptions: [
      { amount: 45000, startMonth: getYearMonth(0), endMonth: getYearMonth(1) },
      { amount: 1, startMonth: getYearMonth(2), endMonth: null },
    ] });
  await page.setViewportSize({ width: 1280, height: 900 });
  await navigateTo(page, "/credit-cards");

  const single = cardListRow(page, "Single Period");
  const double = cardListRow(page, "Two Periods");
  await expect(single).toContainText(formatCurrency(30000));
  await expect(double).toContainText(formatCurrency(45000));
  await expect(double).toContainText(formatCurrency(1));
  const singleHeight = await single.evaluate((element) => element.getBoundingClientRect().height);
  const doubleHeight = await double.evaluate((element) => element.getBoundingClientRect().height);
  expect(Math.abs(singleHeight - doubleHeight)).toBeLessThanOrEqual(1);

  const title = await double.getByText("Two Periods", { exact: true }).boundingBox();
  const details = await double.getByText(/^引落日 /).boundingBox();
  expect(title).not.toBeNull();
  expect(details).not.toBeNull();
  expect(details!.y - title!.y).toBeLessThan(36);
});

test("opens an empty assumption list from the edit button on mobile", async ({ page }) => {
  const account = await seedAccount({ name: "Empty Card Account" });
  await seedCreditCard({ name: "Empty Card", accountId: account.id, assumptions: [] });
  await page.setViewportSize({ width: 375, height: 800 });
  await navigateTo(page, "/credit-cards");
  await expect(page.getByRole("button", { name: "Empty Cardを編集" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Empty Card", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Empty Cardを編集" }).click();
  const editor = page.locator(".edit-editor-modal");
  await expect(editor.getByLabel("仮定額と適用請求月")).toContainText("仮定額の期間はありません");
  await expect(editor.getByRole("button", { name: "期間を追加" })).toBeVisible();
});

test("edits and deletes a credit card", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({
    name: "Master",
    accountId: account.id,
    assumptionAmount: 30000,
    sortOrder: 1,
  });

  await navigateTo(page, "/credit-cards");

  const row = cardListRow(page, "Master");
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "Master", exact: true })).toHaveCount(0);
  await row.getByRole("button", { name: /を編集/ }).click();
  await page.locator(".edit-editor-modal").getByRole("button", { name: "基本情報を編集" }).click();
  await page.getByLabel("カード名 *").last().fill("Master Gold");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await waitForReload(page);
  await page.locator(".edit-editor-modal").getByRole("button", { name: "閉じる" }).last().click();
  await expect(cardListRow(page, "Master Gold")).toBeVisible();

  await cardListRow(page, "Master Gold").getByRole("button", { name: /を削除/ }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await waitForReload(page);
  await expect(page.getByText("Master Gold")).toHaveCount(0);
});

test("suggests and applies an assumption amount from past billing averages", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  const card = await seedCreditCard({
    name: "Average Card",
    accountId: account.id,
    assumptionAmount: 10000,
    sortOrder: 1,
  });
  await seedBilling(toYearMonth(getJstDate(-3)), [{ creditCardId: card.id, amount: 10000 }]);
  await seedBilling(toYearMonth(getJstDate(-2)), [{ creditCardId: card.id, amount: 30000 }]);
  await seedBilling(toYearMonth(getJstDate(-1)), [{ creditCardId: card.id, amount: 20000 }]);

  await navigateTo(page, "/credit-cards");

  await cardListRow(page, "Average Card").getByRole("button", { name: "Average Cardを編集" }).click();
  await expect(page.getByLabel("仮定額と適用請求月")).toBeVisible();
  await page.getByRole("button", { name: "過去実績から提案" }).click();

  await expect(page.getByText(`提案額 ${formatCurrency(20000)}`)).toBeVisible();
  await expect(page.getByText("3 件")).toBeVisible();

  await page.getByRole("button", { name: "最後の期間に反映" }).click();
  await expect(page.getByLabel("金額 *")).toHaveValue("20000");

  await page.getByLabel("金額 *").fill("21000");
  await page.getByRole("button", { name: "訂正を保存" }).click();
  await waitForReload(page);
  await expect(page.locator(".edit-editor-modal")).toContainText(formatCurrency(21000));
  await page.locator(".edit-editor-modal").getByRole("button", { name: "閉じる" }).last().click();
  await expect(cardListRow(page, "Average Card")).toContainText(formatCurrency(21000));
});

test("adds, corrects, and deletes a credit card assumption period", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  const firstMonth = getYearMonth(1);
  const secondMonth = getYearMonth(2);
  const thirdMonth = getYearMonth(3);
  const fourthMonth = getYearMonth(4);
  await seedCreditCard({
    name: "Period Card",
    accountId: account.id,
    assumptions: [{ amount: 10000, startMonth: firstMonth, endMonth: firstMonth }],
  });

  await navigateTo(page, "/credit-cards");
  await cardListRow(page, "Period Card").getByRole("button", { name: "Period Cardを編集" }).click();
  const dialog = page.locator(".edit-editor-modal");
  await expect(dialog.getByLabel("仮定額と適用請求月")).toBeVisible();
  await dialog.getByRole("button", { name: "期間を追加" }).click();
  await dialog.getByLabel("金額 *").fill("20000");
  await dialog.getByLabel("開始月").fill(thirdMonth);
  await dialog.getByLabel("終了月").fill(fourthMonth);
  await dialog.getByRole("button", { name: "期間を追加", exact: true }).first().click();
  await waitForReload(page);
  await expect(dialog).toContainText(formatCurrency(20000));

  await dialog.getByRole("button", { name: `${thirdMonth} 〜 ${fourthMonth}の仮定額を訂正` }).click();
  await dialog.getByLabel("開始月").fill(firstMonth);
  await dialog.getByRole("button", { name: "訂正を保存" }).first().click();
  await expect(dialog.getByText("同じカードの適用請求月は重複できません。")).toBeVisible();
  await dialog.getByLabel("開始月").fill(secondMonth);
  await dialog.getByRole("button", { name: "訂正を保存" }).click();
  await waitForReload(page);
  await expect(dialog).toContainText(secondMonth);

  await dialog.getByRole("button", { name: `${firstMonth} 〜 ${firstMonth}の仮定額を削除` }).click();
  await dialog.getByRole("button", { name: "削除を確認" }).click();
  await expect(page.getByRole("heading", { name: "仮定額の期間を削除しますか？" })).toBeVisible();
  await page.getByRole("button", { name: "削除する" }).click();
  await waitForReload(page);
  await expect(dialog).not.toContainText(formatCurrency(10000));
  await dialog.getByRole("button", { name: "閉じる" }).last().click();
  await expect(cardListRow(page, "Period Card")).not.toContainText(formatCurrency(10000));
  await expect(cardListRow(page, "Period Card")).toContainText(formatCurrency(20000));
});

test("saves monthly billing and switches the badge to actual", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({
    name: "Visa",
    accountId: account.id,
    assumptionAmount: 50000,
    sortOrder: 1,
  });

  await navigateTo(page, "/credit-cards");

  await billingInput(page, "Visa").fill("42000");
  await expect(page.getByText("未保存の変更あり")).toBeVisible();
  await page.getByRole("button", { name: "請求額を保存" }).click();
  await waitForReload(page);

  await expect(billingRow(page, "Visa")).toContainText("実額を使用");
  await expect(page.getByRole("button", { name: "請求額を保存" })).toBeDisabled();
});

test("shows assumption badges when switching to a month without billing data", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({
    name: "Visa",
    accountId: account.id,
    assumptionAmount: 50000,
    sortOrder: 1,
  });

  await navigateTo(page, "/credit-cards");

  await page.locator('input[type="month"]').fill(toYearMonth(getJstDate(1)));
  await waitForReload(page);

  await expect(billingRow(page, "Visa")).toContainText("仮定値を使用");
});

test("shows billing totals including assumptions and actual inputs", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  const actualCard = await seedCreditCard({
    name: "Actual Card",
    accountId: account.id,
    assumptionAmount: 10000,
    sortOrder: 1,
  });
  await seedCreditCard({
    name: "Assumption Card",
    accountId: account.id,
    assumptionAmount: 20000,
    sortOrder: 2,
  });

  await seedBilling(toYearMonth(getJstDate()), [{ creditCardId: actualCard.id, amount: 12345 }]);

  await navigateTo(page, "/credit-cards");

  await expect(billingTotalRow(page)).toContainText(formatCurrency(30000));
  await expect(billingTotalRow(page)).toContainText(formatCurrency(12345));
  await expect(billingTotalRow(page)).toContainText(formatCurrency(32345));
});

test("validates monthly billing changes and confirms before switching months", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({
    name: "Visa",
    accountId: account.id,
    assumptionAmount: 50000,
    sortOrder: 1,
  });

  await navigateTo(page, "/credit-cards");

  const saveButton = page.getByRole("button", { name: "請求額を保存" });
  await expect(saveButton).toBeDisabled();

  await billingInput(page, "Visa").fill("-1");
  await expect(billingRow(page, "Visa").getByText("0円以上で入力してください")).toBeVisible();
  await expect(saveButton).toBeDisabled();

  await billingInput(page, "Visa").fill("42000");
  await expect(page.getByText("未保存の変更あり")).toBeVisible();
  await expect(saveButton).toBeEnabled();
  await expect(billingRow(page, "Visa")).toContainText("実額を使用");
  await expect(billingTotalRow(page)).toContainText(formatCurrency(50000));
  await expect(billingTotalRow(page)).toContainText(formatCurrency(42000));

  const monthInput = page.locator('input[type="month"]');
  const currentMonth = await monthInput.inputValue();
  await monthInput.fill(toYearMonth(getJstDate(1)));
  await expect(page.getByRole("heading", { name: "未保存の月次請求があります" })).toBeVisible();
  await page.getByRole("button", { name: "キャンセル" }).click();
  await expect(monthInput).toHaveValue(currentMonth);
});

test("advances to next month via the next month button and crosses years", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({
    name: "Visa",
    accountId: account.id,
    assumptionAmount: 50000,
    sortOrder: 1,
  });

  await navigateTo(page, "/credit-cards");

  const monthInput = page.locator('input[type="month"]');

  await page.getByRole("button", { name: "次月" }).click();
  await expect(monthInput).toHaveValue(toYearMonth(getJstDate(1)));

  // eslint-disable-next-line sui/no-fixed-e2e-date -- 入力月を明示した年越し・うるう年の境界値検証。
  await monthInput.fill("2026-12");
  await waitForReload(page);
  await page.getByRole("button", { name: "次月" }).click();
  // eslint-disable-next-line sui/no-fixed-e2e-date -- 入力月を明示した年越し・うるう年の境界値検証。
  await expect(monthInput).toHaveValue("2027-01");

  // eslint-disable-next-line sui/no-fixed-e2e-date -- 入力月を明示した年越し・うるう年の境界値検証。
  await monthInput.fill("2024-02");
  await waitForReload(page);
  await page.getByRole("button", { name: "次月" }).click();
  // eslint-disable-next-line sui/no-fixed-e2e-date -- 入力月を明示した年越し・うるう年の境界値検証。
  await expect(monthInput).toHaveValue("2024-03");
});

test("confirms or cancels before switching to next month with unsaved changes", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({
    name: "Visa",
    accountId: account.id,
    assumptionAmount: 50000,
    sortOrder: 1,
  });

  await navigateTo(page, "/credit-cards");

  const monthInput = page.locator('input[type="month"]');
  const currentMonth = await monthInput.inputValue();

  await billingInput(page, "Visa").fill("42000");
  await expect(page.getByText("未保存の変更あり")).toBeVisible();

  await page.getByRole("button", { name: "次月" }).click();
  await expect(page.getByRole("heading", { name: "未保存の月次請求があります" })).toBeVisible();

  await page.getByRole("button", { name: "キャンセル" }).click();
  await expect(monthInput).toHaveValue(currentMonth);
  await expect(billingInput(page, "Visa")).toHaveValue("42000");
  await expect(page.getByText("未保存の変更あり")).toBeVisible();

  await page.getByRole("button", { name: "次月" }).click();
  await expect(page.getByRole("heading", { name: "未保存の月次請求があります" })).toBeVisible();
  await page.getByRole("button", { name: "切り替える" }).click();
  await expect(monthInput).toHaveValue(toYearMonth(getJstDate(1)));
});

test("returns to the previous month via the previous month button and crosses years", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({
    name: "Visa",
    accountId: account.id,
    assumptionAmount: 50000,
    sortOrder: 1,
  });

  await navigateTo(page, "/credit-cards");

  const monthInput = page.locator('input[type="month"]');

  await page.getByRole("button", { name: "前月" }).click();
  await expect(monthInput).toHaveValue(toYearMonth(getJstDate(-1)));

  // eslint-disable-next-line sui/no-fixed-e2e-date -- 入力月を明示した年越し・うるう年の境界値検証。
  await monthInput.fill("2026-01");
  await waitForReload(page);
  await page.getByRole("button", { name: "前月" }).click();
  // eslint-disable-next-line sui/no-fixed-e2e-date -- 入力月を明示した年越し・うるう年の境界値検証。
  await expect(monthInput).toHaveValue("2025-12");

  // eslint-disable-next-line sui/no-fixed-e2e-date -- 入力月を明示した年越し・うるう年の境界値検証。
  await monthInput.fill("2024-03");
  await waitForReload(page);
  await page.getByRole("button", { name: "前月" }).click();
  // eslint-disable-next-line sui/no-fixed-e2e-date -- 入力月を明示した年越し・うるう年の境界値検証。
  await expect(monthInput).toHaveValue("2024-02");
});

test("confirms or cancels before switching to the previous month with unsaved changes", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({
    name: "Visa",
    accountId: account.id,
    assumptionAmount: 50000,
    sortOrder: 1,
  });

  await navigateTo(page, "/credit-cards");

  const monthInput = page.locator('input[type="month"]');
  const currentMonth = await monthInput.inputValue();

  await billingInput(page, "Visa").fill("42000");
  await expect(page.getByText("未保存の変更あり")).toBeVisible();

  await page.getByRole("button", { name: "前月" }).click();
  await expect(page.getByRole("heading", { name: "未保存の月次請求があります" })).toBeVisible();

  await page.getByRole("button", { name: "キャンセル" }).click();
  await expect(monthInput).toHaveValue(currentMonth);
  await expect(billingInput(page, "Visa")).toHaveValue("42000");

  await page.getByRole("button", { name: "前月" }).click();
  await expect(page.getByRole("heading", { name: "未保存の月次請求があります" })).toBeVisible();
  await page.getByRole("button", { name: "切り替える" }).click();
  await expect(monthInput).toHaveValue(toYearMonth(getJstDate(-1)));
});

test("supports keyboard entry across cards", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({
    name: "Visa",
    accountId: account.id,
    assumptionAmount: 50000,
    sortOrder: 1,
  });
  await seedCreditCard({
    name: "Master",
    accountId: account.id,
    assumptionAmount: 30000,
    sortOrder: 2,
  });

  await navigateTo(page, "/credit-cards");

  await billingInput(page, "Visa").fill("43210");
  await expect(billingInput(page, "Visa")).toHaveValue("43210");
  await expect(page.getByText("未保存の変更あり")).toBeVisible();

  await billingInput(page, "Visa").focus();
  await page.keyboard.press("Enter");
  await expect(billingInput(page, "Master")).toBeFocused();
});

test("uses the assumption for next month when the actual amount is lower", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({
    name: "Visa",
    accountId: account.id,
    assumptionAmount: 50000,
    sortOrder: 1,
  });

  await navigateTo(page, "/credit-cards");

  await page.locator('input[type="month"]').fill(toYearMonth(getJstDate(1)));

  const row = billingRow(page, "Visa");
  await billingInput(page, "Visa").fill("42000");
  await page.getByRole("button", { name: "請求額を保存" }).click();
  await waitForReload(page);

  await expect(row).toContainText("仮定値を使用");
  await expect(row).toContainText(formatCurrency(50000));
  await expect(billingTotalRow(page)).toContainText(formatCurrency(42000));
  await expect(billingTotalRow(page)).toContainText(formatCurrency(50000));
});

test("keeps an unsaved billing draft while card settings are saved", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({ name: "Draft Card", accountId: account.id, assumptionAmount: 30000 });
  await navigateTo(page, "/credit-cards");
  await expect(cardListRow(page, "Draft Card")).toBeVisible();
  await billingInput(page, "Draft Card").fill("12000");
  await cardListRow(page, "Draft Card").getByRole("button", { name: /を編集/ }).click();
  const editor = page.locator(".edit-editor-modal");
  await expect(editor.getByRole("heading", { name: "Draft Card" })).toBeVisible();
  await editor.getByRole("button", { name: "基本情報を編集" }).click();
  await editor.getByLabel("カード名 *").fill("Renamed Card");
  await editor.getByRole("button", { name: "変更を保存" }).click();
  await editor.getByRole("button", { name: "閉じる" }).last().click();
  await expect(cardListRow(page, "Renamed Card")).toBeVisible();
  await expect(billingInput(page, "Renamed Card")).toHaveValue("12000");
  await expect(page.getByText("未保存の変更あり")).toBeVisible();
  await page.getByRole("button", { name: "請求額を保存" }).click();
  await expect(billingInput(page, "Renamed Card")).toHaveValue("12000");
});

test("keeps a billing draft and focus while switching between table and cards", async ({ page }) => {
  const account = await seedAccount({ name: "Resize Account" });
  await seedCreditCard({ name: "Resize Card", accountId: account.id, assumptionAmount: 30000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateTo(page, "/credit-cards");

  const input = page.getByLabel("Resize Card 実額");
  await input.fill("12000");
  await expect(input).toBeFocused();
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(input).toHaveCount(1);
  await expect(input).toHaveValue("12000");
  await expect(input).toBeFocused();
  await expect(page.getByText("未保存の変更あり")).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(input).toHaveCount(1);
  await expect(input).toHaveValue("12000");
  await expect(input).toBeFocused();
  await expect(billingTotalRow(page)).toContainText(formatCurrency(12000));
  const tableWidth = await billingTable(page).evaluate((table) => ({
    content: table.parentElement?.scrollWidth ?? 0,
    visible: table.parentElement?.clientWidth ?? 0,
  }));
  expect(tableWidth.content).toBeLessThanOrEqual(tableWidth.visible + 1);
});

test("distinguishes an unregistered billing from a saved zero", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({ name: "Zero Card", accountId: account.id, assumptionAmount: 30000 });
  await navigateTo(page, "/credit-cards");
  await expect(cardListRow(page, "Zero Card")).toBeVisible();
  await expect(billingInput(page, "Zero Card")).toHaveValue("");
  await billingInput(page, "Zero Card").fill("0");
  await expect(page.getByText("未保存の変更あり")).toBeVisible();
  await page.getByRole("button", { name: "請求額を保存" }).click();
  await expect(billingInput(page, "Zero Card")).toHaveValue("0");
  await expect(page.getByText("保存済み", { exact: false }).first()).toBeVisible();
});

test("retries a failed billing refresh without resending the saved amount", async ({ page }) => {
  const account = await seedAccount({ name: "Settlement Account" });
  await seedCreditCard({ name: "Retry Card", accountId: account.id, assumptionAmount: 30000 });
  await navigateTo(page, "/credit-cards");
  await expect(cardListRow(page, "Retry Card")).toBeVisible();
  let failNextRefresh = true;
  let saves = 0;
  await page.route("**/api/billings?month=*", async (route) => {
    if (failNextRefresh) { failNextRefresh = false; await route.fulfill({ status: 503, body: JSON.stringify({ error: "temporarily unavailable" }) }); }
    else await route.continue();
  });
  await page.route("**/api/billings/*", async (route) => { if (route.request().method() === "PUT") saves += 1; await route.continue(); });
  await billingInput(page, "Retry Card").fill("12000");
  await page.getByRole("button", { name: "請求額を保存" }).click();
  await expect(page.getByRole("alert")).toContainText("保存済みですが表示を更新できませんでした");
  expect(saves).toBe(1);
  await page.getByRole("button", { name: "表示を再取得" }).click();
  await expect(billingInput(page, "Retry Card")).toHaveValue("12000");
  expect(saves).toBe(1);
});
