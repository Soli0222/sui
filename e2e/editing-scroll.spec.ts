import { expect, test, type Page } from "./helpers/test";
import { navigateTo } from "./helpers/actions";
import { seedAccount, seedRecurringItem, seedSubscription } from "./helpers/db";
import { getFutureDate } from "./helpers/scenario";

async function scrollTargetIntoView(page: Page, target: ReturnType<Page["locator"]>) {
  await expect(target).toBeVisible();
  await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const position = await page.evaluate(() => window.scrollY);
  expect(position).toBeGreaterThan(500);
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  return position;
}

async function expectPageScroll(page: Page, expected: number) {
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(expected - 2);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThanOrEqual(expected + 2);
}

async function seedLongRecurringList() {
  const account = await seedAccount({ name: "スクロール確認口座" });
  for (let index = 0; index < 36; index++) {
    await seedRecurringItem({ name: `スクロール予定 ${String(index).padStart(2, "0")}`,
      type: "expense", amount: 1000 + index, dayOfMonth: 15,
      accountId: account.id, sortOrder: index });
  }
}

test("wide modal preserves a deep row, full list width, and scroll through mode and target changes", async ({ page }) => {
  await seedLongRecurringList();
  await page.setViewportSize({ width: 1920, height: 700 });
  await navigateTo(page, "/recurring");

  const first = page.getByRole("row", { name: /スクロール予定 28/ });
  const second = page.getByRole("row", { name: /スクロール予定 29/ });
  const before = await scrollTargetIntoView(page, first);
  const listWidth = await first.locator("xpath=ancestor::table").evaluate((element) => element.getBoundingClientRect().width);
  await first.getByRole("button", { name: "スクロール予定 28", exact: true }).click();
  const panel = page.locator(".edit-editor-modal");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "スクロール予定 28" })).toBeFocused();
  await expectPageScroll(page, before);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll("table")]
    .find((element) => element.textContent?.includes("スクロール予定 28"))!.getBoundingClientRect().width)).toBeCloseTo(listWidth, 1);
  const geometry = await panel.evaluate((element) => {
    const modal = element.getBoundingClientRect();
    const footer = element.querySelector("footer")!.getBoundingClientRect();
    return { top: modal.top, bottom: modal.bottom, left: modal.left, right: modal.right, footerBottom: footer.bottom,
      position: getComputedStyle(element).position };
  });
  expect(geometry.position).toBe("fixed");
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.footerBottom).toBeLessThanOrEqual(700);
  expect(geometry.bottom).toBeLessThanOrEqual(700);
  expect(Math.abs((geometry.left + geometry.right) / 2 - 960)).toBeLessThan(2);
  await panel.getByRole("button", { name: "基本情報を編集" }).click();
  await expect(panel.getByRole("heading", { name: "スクロール予定 28を編集" })).toBeFocused();
  await expectPageScroll(page, before);
  await expect(panel.getByRole("button", { name: "変更を保存" })).toBeInViewport();

  await panel.getByRole("button", { name: "閉じる" }).first().click();
  await expect(panel).toBeHidden();
  await expectPageScroll(page, before);
  await second.getByRole("button", { name: "スクロール予定 29", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "スクロール予定 29" })).toBeFocused();
  await expectPageScroll(page, before);
  await panel.getByRole("button", { name: "閉じる" }).first().click();
  await expect(panel).toBeHidden();
  await expectPageScroll(page, before);
  await expect(second.getByRole("button", { name: "スクロール予定 29", exact: true })).toBeFocused();
});

test("compact editor keeps the underlying deep-row position after closing", async ({ page }) => {
  await seedLongRecurringList();
  await page.setViewportSize({ width: 375, height: 700 });
  await navigateTo(page, "/recurring");
  const target = page.getByRole("button", { name: "スクロール予定 28", exact: true }).first();
  await expect(target).toBeVisible();
  await target.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(500);
  const row = page.getByRole("button", { name: "スクロール予定 28", exact: true }).first().locator("../../..");
  await row.getByRole("button", { name: "スクロール予定 28を編集" }).click();
  const panel = page.locator(".edit-editor-modal");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("heading", { name: "スクロール予定 28を編集" })).toBeFocused();
  await expect.poll(() => panel.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
  await expectPageScroll(page, before);
  await panel.getByRole("button", { name: "閉じる" }).first().click();
  await expect(panel).toBeHidden();
  await expectPageScroll(page, before);
  await expect(target).toBeInViewport();
  await expect(row.getByRole("button", { name: "スクロール予定 28を編集" })).toBeFocused();
});

test("subscription field focus does not pull a deep row to the top", async ({ page }) => {
  for (let index = 0; index < 30; index++) {
    await seedSubscription({ name: `スクロール契約 ${String(index).padStart(2, "0")}`,
      amount: 1000 + index, interval: 1, startDate: new Date(getFutureDate(-7)), dayOfMonth: 15 });
  }
  await page.setViewportSize({ width: 1920, height: 700 });
  await navigateTo(page, "/subscriptions");
  const row = page.getByRole("row", { name: /スクロール契約 28/ }).last();
  const before = await scrollTargetIntoView(page, row);
  const trigger = row.getByRole("button", { name: "編集" });
  await trigger.click();
  const panel = page.locator(".edit-editor-modal");
  await expect(panel).toBeVisible();
  await expect.poll(() => panel.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await expectPageScroll(page, before);
  await expect(page.locator("tr").filter({ hasText: "スクロール契約 28" }).last()).toBeInViewport();
  await panel.getByRole("button", { name: "閉じる" }).first().click();
  await expect(panel).toBeHidden();
  await expectPageScroll(page, before);
  await expect(trigger).toBeFocused();
});

test("account modal restores focus without moving a long account list", async ({ page }) => {
  for (let index = 0; index < 36; index++) {
    await seedAccount({ name: `スクロール口座 ${String(index).padStart(2, "0")}`, sortOrder: index });
  }
  await page.setViewportSize({ width: 1440, height: 700 });
  await navigateTo(page, "/accounts");
  const row = page.getByRole("row", { name: /スクロール口座 28/ });
  await expect(row).toBeVisible();
  await row.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(500);
  const trigger = row.getByRole("button", { name: "編集" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "スクロール口座 28の基本情報を編集" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "スクロール口座 28の基本情報を編集" })).toBeFocused();
  await expectPageScroll(page, before);
  await dialog.getByRole("button", { name: "閉じる" }).click();
  await expect(dialog).toBeHidden();
  await expectPageScroll(page, before);
  await expect(trigger).toBeInViewport();
  await expect(trigger).toBeFocused();
});
