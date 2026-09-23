import { expect, test, type Page } from "./helpers/test";
import { navigateTo } from "./helpers/actions";
import { seedAccount, seedRecurringItem, seedSalary } from "./helpers/db";
import { getFutureDate } from "./helpers/scenario";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const widths = [320, 375, 414, 640, 768, 1280, 1440, 1920];
const subject = "横断確認用のとても長い予定収支名と対象を識別するための説明";

async function seedEditorSubject() {
  const account = await seedAccount({ name: "編集画面確認口座", balance: 123_456, sortOrder: 1 });
  await seedRecurringItem({ name: subject, type: "expense", amount: 12_345, dayOfMonth: 15,
    accountId: account.id, sortOrder: 1 });
}

async function openEditor(page: Page, alreadyOnPage = false) {
  if (!alreadyOnPage) await navigateTo(page, "/recurring");
  const nameButton = page.getByRole("button", { name: subject, exact: true }).first();
  await expect(nameButton).toBeVisible();
  await nameButton.click();
  const panel = page.locator(".edit-editor-modal");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "基本情報を編集" }).click();
  await expect(panel.getByRole("heading", { name: `${subject}を編集` })).toBeVisible();
  return panel;
}

test("keeps one draft and the save area usable across editing widths and a short screen", async ({ page }) => {
  await seedEditorSubject();
  await page.setViewportSize({ width: 1920, height: 900 });
  const panel = await openEditor(page);
  const name = panel.getByLabel("カテゴリ名 *");
  await name.fill(`${subject}・変更中`);
  await expect(panel.getByRole("status")).toContainText("未保存の変更");
  await name.evaluate((element) => {
    element.dataset.editingProbe = "same-node";
  });

  for (const width of widths) {
    const height = width === 640 ? 450 : 600; // Layout-width approximation for 200% zoom on a 1280×900 display.
    await page.setViewportSize({ width, height });
    await expect(name).toHaveValue(`${subject}・変更中`);
    await expect(name).toHaveAttribute("data-editing-probe", "same-node");
    await expect(panel.getByRole("button", { name: "変更を保存" })).toBeVisible();
    if (width >= 768) await expect.poll(() => page.locator("table").filter({ hasText: "金額と適用期間" }).count()).toBeGreaterThan(0);
    const geometry = await page.evaluate(() => {
      const dialog = document.querySelector<HTMLElement>(".edit-editor-modal")!;
      const footer = dialog.querySelector<HTMLElement>(".edit-shell footer")!;
      const body = dialog.querySelector<HTMLElement>(".edit-shell-body")!;
      const rect = dialog.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const bodyRect = body.getBoundingClientRect();
      const table = [...document.querySelectorAll<HTMLTableElement>("table")]
        .find((element) => element.textContent?.includes("金額と適用期間"));
      return { viewport: document.documentElement.clientWidth, documentWidth: document.documentElement.scrollWidth,
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width,
        footerTop: footerRect.top, footerBottom: footerRect.bottom, bodyBottom: bodyRect.bottom,
        overlays: document.querySelectorAll(".dialog-overlay").length,
        tableWidth: table?.getBoundingClientRect().width ?? null,
        tableParentWidth: table?.parentElement?.getBoundingClientRect().width ?? null };
    });
    expect(geometry.documentWidth, JSON.stringify({ width, geometry })).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(geometry.left, JSON.stringify({ width, geometry })).toBeGreaterThanOrEqual(0);
    expect(geometry.right, JSON.stringify({ width, geometry })).toBeLessThanOrEqual(width + 1);
    expect(Math.abs((geometry.left + geometry.right) / 2 - width / 2), JSON.stringify({ width, geometry })).toBeLessThan(2);
    expect(geometry.width, JSON.stringify({ width, geometry })).toBeLessThanOrEqual(576);
    expect(geometry.footerBottom, JSON.stringify({ width, geometry })).toBeLessThanOrEqual(height + 1);
    expect(geometry.bodyBottom, JSON.stringify({ width, geometry })).toBeLessThanOrEqual(geometry.footerTop + 1);
    expect(geometry.overlays).toBe(1);
    if (width >= 768) {
      expect(geometry.tableWidth).not.toBeNull();
      expect(geometry.tableParentWidth).not.toBeNull();
      expect(geometry.tableWidth!).toBeGreaterThanOrEqual(geometry.tableParentWidth! - 1);
    }
  }

  await page.setViewportSize({ width: 375, height: 600 });
  await name.focus();
  await page.setViewportSize({ width: 1920, height: 600 });
  await expect(name).toBeFocused();
  await name.fill(subject);
  await expect(panel.getByRole("status")).toContainText("変更なし");
  await panel.getByRole("button", { name: "閉じる" }).click();
  await expect(panel).toBeHidden();
});

test("guards keyboard exit and restores focus after discarding a modal draft", async ({ page }) => {
  await seedEditorSubject();
  await page.setViewportSize({ width: 1920, height: 900 });
  const panel = await openEditor(page);
  const name = panel.getByLabel("カテゴリ名 *");
  await name.fill(`${subject}・未保存`);
  await name.press("Escape");
  const discard = page.getByRole("dialog", { name: "未保存の変更を破棄しますか？" });
  await expect(discard).toBeVisible();
  await expect(discard).toHaveCount(1);
  await discard.getByRole("button", { name: "編集を続ける" }).click();
  await expect(name).toHaveValue(`${subject}・未保存`);
  await panel.getByRole("button", { name: "閉じる" }).click();
  await discard.getByRole("button", { name: "変更を破棄" }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: subject, exact: true }).first()).toBeFocused();
});

test("the editing modal traps Tab at wide and narrow widths", async ({ page }) => {
  await seedEditorSubject();
  await page.setViewportSize({ width: 1920, height: 900 });
  const dialog = await openEditor(page);
  const name = dialog.getByLabel("カテゴリ名 *");
  for (const width of [1920, 375]) {
    await page.setViewportSize({ width, height: 600 });
    await name.focus();
    await page.keyboard.press("Tab");
    await expect.poll(async () => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await dialog.getByRole("button", { name: "変更を保存" }).focus();
    await page.keyboard.press("Tab");
    await expect.poll(async () => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await dialog.getByRole("button", { name: "閉じる" }).first().focus();
    await page.keyboard.press("Shift+Tab");
    await expect.poll(async () => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
});

test("route changes and browser back guard the unsaved modal draft", async ({ page }) => {
  await seedEditorSubject();
  await page.setViewportSize({ width: 1920, height: 900 });
  await navigateTo(page, "/accounts");
  await page.getByRole("link", { name: "予定収支" }).click();
  const panel = await openEditor(page, true);
  const name = panel.getByLabel("カテゴリ名 *");
  await name.fill(`${subject}・draft`);
  await expect.poll(() => page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  await panel.getByRole("button", { name: "閉じる" }).click();
  const discard = page.getByRole("dialog", { name: "未保存の変更を破棄しますか？" });
  await discard.getByRole("button", { name: "編集を続ける" }).click();
  await expect(name).toHaveValue(`${subject}・draft`);
  // Simulate an external router transition while Radix prevents pointer interaction with the background.
  await page.locator('a[href="/accounts"]').evaluate((element: HTMLElement) => element.click());
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "編集を続ける" }).click();
  await expect(page).toHaveURL(/\/recurring$/);
  await expect(name).toHaveValue(`${subject}・draft`);
  await page.goBack();
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "編集を続ける" }).click();
  await expect(name).toHaveValue(`${subject}・draft`);
  await panel.getByRole("button", { name: "閉じる" }).click();
  await discard.getByRole("button", { name: "変更を破棄" }).click();
  await expect(panel).toBeHidden();
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
});

test("captures demo editing states for review", async ({ page }) => {
  test.skip(process.env.SUI_CAPTURE_EDITING_DEMO !== "1", "Run explicitly to refresh documentation images.");
  await seedEditorSubject();
  const output = resolve("docs/assets/editing-ui");
  await mkdir(output, { recursive: true });
  const shot = async (name: string) => page.screenshot({ path: resolve(output, `${name}.png`), animations: "disabled" });
  await page.setViewportSize({ width: 1920, height: 900 });
  const panel = await openEditor(page);
  await shot("wide");
  const name = panel.getByLabel("カテゴリ名 *");
  await name.fill(`${subject}・編集中`);
  await shot("dirty");
  await page.setViewportSize({ width: 375, height: 600 });
  await shot("narrow-dirty");
  await page.setViewportSize({ width: 1920, height: 900 });
  await name.fill("");
  await panel.getByRole("button", { name: "変更を保存" }).click();
  await expect(panel.getByText("カテゴリ名を入力してください。")).toBeVisible();
  await shot("input-error");
  await name.fill(`${subject}・保存試行`);
  await page.route("**/api/recurring-items/*", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "デモ用の保存エラー" }) });
      return;
    }
    await route.continue();
  });
  await panel.getByRole("button", { name: "変更を保存" }).click();
  await expect(panel.getByRole("alert")).toContainText("デモ用の保存エラー");
  await shot("save-error");
  await page.setViewportSize({ width: 375, height: 600 });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "閉じる" }).click();
  await page.getByRole("dialog", { name: "未保存の変更を破棄しますか？" }).getByRole("button", { name: "変更を破棄" }).click();
});

test("a dedicated salary editor discards once when returning to its list", async ({ page }) => {
  const record = await seedSalary({ paidOn: new Date(`${getFutureDate(-30)}T00:00:00.000Z`),
    name: "破棄確認用の給与", grossAmount: 100_000 });
  await navigateTo(page, `/salaries/${record.id}/edit`);
  const gross = page.getByLabel("額面 *");
  await expect(gross).toHaveValue("100000");
  await gross.fill("120000");
  await page.getByRole("button", { name: "給与ログに戻る" }).click();
  const discard = page.getByRole("dialog", { name: "未保存の変更を破棄しますか？" });
  await expect(discard).toHaveCount(1);
  await discard.getByRole("button", { name: "変更を破棄" }).click();
  await expect(page).toHaveURL(/\/salaries(?:\?year=\d+)?$/);
  await expect(page.getByRole("heading", { name: "給与ログ" })).toBeVisible();
  await expect(discard).toHaveCount(0);
});

test("correcting an invalid salary field clears the stale submit error", async ({ page }) => {
  const record = await seedSalary({ paidOn: new Date(`${getFutureDate(-30)}T00:00:00.000Z`),
    name: "入力修正確認用の給与", grossAmount: 100_000 });
  await navigateTo(page, `/salaries/${record.id}/edit`);
  const gross = page.getByLabel("額面 *");
  await expect(gross).toHaveValue("100000");
  await gross.fill("-");
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(gross).toHaveAttribute("aria-invalid", "true");
  await gross.fill("120000");
  await expect(gross).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("status")).toContainText("未保存の変更");
});

test("a missing target and a concurrent conflict keep the draft with distinct errors", async ({ page }) => {
  await seedEditorSubject();
  await page.setViewportSize({ width: 1920, height: 900 });
  let puts = 0;
  await page.route("**/api/recurring-items/*", async (route) => {
    if (route.request().method() !== "PUT") { await route.continue(); return; }
    puts += 1;
    await route.fulfill({ status: puts === 1 ? 404 : 409, contentType: "application/json",
      body: JSON.stringify({ error: puts === 1 ? "対象が見つかりません" : "他の変更と競合しました" }) });
  });
  const panel = await openEditor(page);
  const name = panel.getByLabel("カテゴリ名 *");
  await name.fill(`${subject}・保持するdraft`);
  await panel.getByRole("button", { name: "変更を保存" }).click();
  await expect(panel.getByRole("alert")).toContainText("対象が見つかりません");
  await expect(name).toHaveValue(`${subject}・保持するdraft`);
  await panel.getByRole("button", { name: "変更を保存" }).click();
  await expect(panel.getByRole("alert")).toContainText("他の変更と競合しました");
  await expect(name).toHaveValue(`${subject}・保持するdraft`);
  expect(puts).toBe(2);
});

test("a short edit modal traps keyboard focus, saves with Enter, and restores its opener", async ({ page }) => {
  await seedAccount({ name: "キーボード確認口座", balance: 1000, sortOrder: 1 });
  await navigateTo(page, "/accounts");
  const row = page.getByRole("row", { name: /キーボード確認口座/ }).first();
  await expect(row).toBeVisible();
  const opener = row.getByRole("button", { name: "編集" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "キーボード確認口座の基本情報を編集" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "キーボード確認口座の基本情報を編集" })).toBeFocused();
  await dialog.getByRole("button", { name: "閉じる" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect.poll(async () => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Tab");
  await expect.poll(async () => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(dialog).toBeVisible();
  const name = dialog.getByLabel("口座名 *");
  await name.fill("キーボード確認口座 更新後");
  const save = dialog.getByRole("button", { name: "変更を保存" });
  await save.focus();
  await page.keyboard.press("Enter");
  const updatedRow = page.getByRole("row", { name: /キーボード確認口座 更新後/ });
  await expect(updatedRow).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(updatedRow.getByRole("button", { name: "編集" })).toBeFocused();
});
