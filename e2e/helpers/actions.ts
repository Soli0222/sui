import { expect, type Locator, type Page } from "@playwright/test";

export async function navigateTo(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main")).toBeVisible();
}

export async function fillAndSubmitAccountForm(
  page: Page,
  values: { name: string; balance: number; balanceOffset?: number; sortOrder: number },
) {
  await page.getByRole("button", { name: "口座を追加" }).click();
  await page.getByLabel("口座名 *").fill(values.name);
  await page.getByLabel("現在残高 (円)").fill(String(values.balance));
  await page.getByLabel("オフセット (円)").fill(String(values.balanceOffset ?? 0));
  await page.getByLabel("表示順").fill(String(values.sortOrder));
  await page.getByRole("button", { name: "追加" }).first().click();
}

export async function expectTableRowCount(scope: Locator, count: number) {
  await expect(scope.locator("tbody tr")).toHaveCount(count);
}

export async function waitForReload(page: Page) {
  await page.waitForTimeout(150);
}
