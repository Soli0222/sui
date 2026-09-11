import { expect, test, type Page } from "@playwright/test";
import type { Account, SpendingResponse } from "@sui/shared";
import { resetDatabase, seedTransaction } from "./helpers/db";
import { navigateTo } from "./helpers/actions";

test.beforeEach(async () => { await resetDatabase(); });

async function seedApproval(page: Page) {
  await navigateTo(page, "/spending");
  return page.evaluate(async () => {
    const { apiFetch } = await import("/src/lib/api.ts");
    const post = <T>(path: string, body: unknown) => apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
    const src = await post<Account>("/api/accounts", { name: "架空資金元", balance: 100000, sortOrder: 0, supplementalBudgetEnabled: true });
    const dst = await post<Account>("/api/accounts", { name: "架空振替先", balance: 0, sortOrder: 1 });
    const current = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
    const s = await apiFetch<SpendingResponse>("/api/spending");
    const draft = await post<SpendingResponse>("/api/spending/commands", { version: s.version, command: { action: "request", input: {
      name: "架空の補正購入", amount: 30000, category: "特別な支出", reason: "架空の必要設備", payment: "架空カード",
      purchaseDate: current, kind: "supplemental", currency: "JPY", rateToJpy: 1, rateAt: current,
      urgency: "", replacement: "", alternatives: "", relatedIds: [],
      funding: { sourceId: src.id, destinationId: dst.id, amount: 30000, date: "2020-01-10" },
    } } });
    const id = draft.ledger.requests[0].id;
    await post(`/api/spending/${id}/override`, { version: draft.version, reason: "架空テストの例外承認" });
    const result = await apiFetch<SpendingResponse>("/api/spending");
    if (result.ledger.requests[0].status !== "approved") throw new Error("Fixture approval failed");
    return result.ledger.requests[0];
  });
}

async function cancel(page: Page, id: string) {
  await page.evaluate(async id => {
    const { apiFetch } = await import("/src/lib/api.ts");
    const s = await apiFetch<SpendingResponse>("/api/spending");
    await apiFetch("/api/spending/commands", { method: "POST", body: JSON.stringify({ version: s.version, command: { action: "cancel", id, reason: "架空取消" } }) });
  }, id);
}

test("cancelled approvals disappear from account actions and deleted schedule links", async ({ page }) => {
  const r = await seedApproval(page);
  await navigateTo(page, "/accounts");
  await expect(page.getByText("関連する支出決裁 (1件)")).toBeVisible();
  await cancel(page, r.id);
  await navigateTo(page, "/accounts");
  await expect(page.getByText(/関連する支出決裁を確認中/)).toHaveCount(0);
  await expect(page.getByText("関連する支出決裁 (1件)")).toHaveCount(0);
  await navigateTo(page, `/spending?request=${r.id}`);
  await page.getByRole("button", { name: "振替を確認", exact: true }).click();
  await expect(page.getByRole("link", { name: "振替予定を開く" })).toHaveCount(0);
  await navigateTo(page, `/recurring?item=${r.fundingLinks[0].recurringId}`);
  await expect(page.getByText("この振替予定は削除済み、または見つかりません。")).toBeVisible();
});

test("links reveal archived schedules and old confirmed transactions on desktop and mobile", async ({ page }, testInfo) => {
  const r = await seedApproval(page);
  await navigateTo(page, `/spending?request=${r.id}`);
  await page.getByRole("button", { name: "振替を確認", exact: true }).click();
  await page.getByRole("link", { name: "振替予定を開く" }).click();
  const schedule = page.getByRole("heading", { name: "関連する振替予定" }).locator("..");
  await expect(schedule.getByText("支出決裁 架空の補正購入", { exact: true })).toBeVisible();
  // Seed a historical actual outside the current forecast/list window.
  // Approval/confirmation behavior is covered by the integration suite.
  await seedTransaction({
    accountId: r.input.funding!.sourceId,
    transferToAccountId: r.input.funding!.destinationId,
    forecastEventId: r.fundingLinks[0].eventId,
    date: new Date("2020-01-10"), type: "transfer", amount: 30000,
    description: "支出決裁 架空の補正購入",
  });
  await navigateTo(page, `/spending?request=${r.id}`);
  await page.getByRole("button", { name: "振替を確認", exact: true }).click();
  await page.getByRole("link", { name: "確定取引を開く" }).click();
  const transaction = page.getByRole("heading", { name: "関連する確定取引" }).locator("..");
  await expect(transaction).toContainText("支出決裁 架空の補正購入");
  await expect(transaction).toContainText("2020");
  await page.screenshot({ path: testInfo.outputPath("linked-transaction-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(transaction).toContainText("支出決裁 架空の補正購入");
  await page.screenshot({ path: testInfo.outputPath("linked-transaction-mobile.png"), fullPage: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
