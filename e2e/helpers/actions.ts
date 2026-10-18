import { expect, type Locator, type Page } from "@playwright/test";
import { addMonthsToYearMonth, getTotalMonths } from "@sui/shared";
import { getCurrentDates } from "./scenario";

export async function navigateTo(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main")).toBeVisible();
}

export async function expectCurrentDate(input: Locator, openedAt: Date) {
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(new RegExp(`^(?:${getCurrentDates(openedAt).join("|")})$`));
}

export async function navigateToBillingMonth(page: Page, yearMonth: string) {
  await navigateTo(page, "/credit-cards");
  await page.getByLabel("対象年月").fill(yearMonth);
}

export async function selectSubscriptionMonth(page: Page, target: string) {
  const monthlyCard = page.getByRole("heading", { name: "月別一覧" }).locator("../..");
  const monthLabel = monthlyCard.getByText(/^\d{4}年\d+月$/);
  await expect(monthLabel).toBeVisible();
  const match = (await monthLabel.innerText()).match(/^(\d{4})年(\d+)月$/)!;
  let selected = `${match[1]}-${match[2].padStart(2, "0")}`;
  const offset = getTotalMonths(target) - getTotalMonths(selected);
  const step = Math.sign(offset);
  for (let index = 0; index < Math.abs(offset); index++) {
    await monthlyCard.getByRole("button", { name: step > 0 ? "次月" : "前月" }).click();
    selected = addMonthsToYearMonth(selected, step);
    const [year, month] = selected.split("-").map(Number);
    await expect(monthLabel).toHaveText(`${year}年${month}月`);
  }
}

export async function fillAndSubmitAccountForm(
  page: Page,
  values: {
    name: string;
    balance: number;
    balanceOffset?: number;
    currencyCode?: "JPY" | "USD" | "EUR";
    exchangeRateToJpy?: number;
    sortOrder: number;
  },
) {
  const currencyCode = values.currencyCode ?? "JPY";

  await page.getByRole("button", { name: "口座を追加" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("口座名 *").fill(values.name);
  await dialog.getByLabel("通貨").selectOption(currencyCode);
  if (currencyCode !== "JPY") {
    await dialog.getByLabel("JPY換算レート").fill(String(values.exchangeRateToJpy ?? 1));
  }
  await dialog.getByLabel(`初期残高 (${currencyCode})`).fill(String(values.balance));
  await dialog.getByLabel(`オフセット (${currencyCode})`).fill(String(values.balanceOffset ?? 0));
  await dialog.getByRole("button", { name: "詳細設定" }).click();
  await dialog.getByLabel("表示順").fill(String(values.sortOrder));
  await dialog.getByRole("button", { name: "口座を追加" }).click();
}

export async function expectTableRowCount(scope: Locator, count: number) {
  await expect(scope.locator("tbody tr")).toHaveCount(count);
}

export async function waitForReload(page: Page) {
  await page.waitForTimeout(150);
}
