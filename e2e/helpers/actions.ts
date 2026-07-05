import { expect, type Locator, type Page } from "@playwright/test";

export async function navigateTo(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main")).toBeVisible();
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
  await dialog.getByLabel(`現在残高 (${currencyCode})`).fill(String(values.balance));
  await dialog.getByLabel(`オフセット (${currencyCode})`).fill(String(values.balanceOffset ?? 0));
  await dialog.getByRole("button", { name: "詳細設定" }).click();
  await dialog.getByLabel("表示順").fill(String(values.sortOrder));
  await dialog.getByRole("button", { name: "追加" }).click();
}

export async function expectTableRowCount(scope: Locator, count: number) {
  await expect(scope.locator("tbody tr")).toHaveCount(count);
}

export async function waitForReload(page: Page) {
  await page.waitForTimeout(150);
}
