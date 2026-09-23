import { expect, test } from "./helpers/test";
import { navigateTo, waitForReload } from "./helpers/actions";
import { seedSubscription } from "./helpers/db";
import { getFutureDate, getYearMonth } from "./helpers/scenario";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

test("creates a subscription", async ({ page }) => {
  await navigateTo(page, "/subscriptions");

  await page.getByRole("button", { name: "サブスクを追加" }).click();
  await page.getByLabel("サービス名 *").first().fill("Netflix");
  await page.getByLabel("金額 (JPY) *").fill("1490");

  await page.getByLabel("課金開始日 *").fill(`${getYearMonth()}-01`);
  await page.getByLabel("毎月の発生日").fill("5");
  await page.getByLabel("支払い元").fill("Visa");
  await page.getByRole("button", { name: "追加する" }).click();
  await waitForReload(page);

  const listCard = page.getByRole("heading", { name: "サブスク一覧" }).locator("../..");
  const monthlyCard = page.getByRole("heading", { name: "月別一覧" }).locator("../..");
  const row = listCard.getByRole("row", { name: /Netflix/ });
  await expect(row).toContainText(formatCurrency(1490));
  await expect(monthlyCard).toContainText(formatCurrency(1490));
});

test("edits and deletes a subscription", async ({ page }) => {
  await seedSubscription({
    name: "Spotify",
    amount: 980,
    interval: 1,
    startDate: new Date(getFutureDate(-7)),
    dayOfMonth: 3,
    paymentSource: "Master",
  });

  await navigateTo(page, "/subscriptions");

  const row = page.getByRole("row", { name: /Spotify/ });
  await row.getByRole("button", { name: "編集" }).click();
  const panel = page.locator(".edit-editor-modal");
  await expect(panel).toContainText("Spotifyを編集");
  await panel.getByLabel("支払い元").fill("Master Gold");
  await panel.getByRole("button", { name: "変更を保存" }).click();
  await expect(panel).toContainText("Spotify");
  await panel.getByRole("button", { name: "価格履歴" }).click();
  await panel.getByRole("button", { name: "初期金額を訂正" }).click();
  await panel.getByLabel("初期金額（訂正） (JPY)").fill("1280");
  await panel.getByRole("button", { name: "訂正を保存" }).click();
  await expect(panel).toContainText(formatCurrency(1280));
  await panel.locator("header button[aria-label='閉じる']").click();
  await waitForReload(page);

  const listCard = page.getByRole("heading", { name: "サブスク一覧" }).locator("../..");
  await expect(listCard.getByRole("row", { name: /Spotify/ })).toContainText(formatCurrency(1280));
  await expect(listCard.getByRole("row", { name: /Spotify/ })).toContainText("Master Gold");

  await listCard.getByRole("row", { name: /Spotify/ }).getByRole("button", { name: "削除" }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await waitForReload(page);

  await expect(page.getByText("Spotify")).toHaveCount(0);
});

test("keeps a basic draft when closing is cancelled and shows its saved impact", async ({ page }) => {
  await seedSubscription({ name: "Guarded Sub", amount: 950, interval: 1,
    startDate: new Date(getFutureDate(-7)), dayOfMonth: 3, paymentSource: "Visa" });
  await navigateTo(page, "/subscriptions");
  const row = page.getByRole("heading", { name: "サブスク一覧" }).locator("../..")
    .getByRole("row", { name: /Guarded Sub/ });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "編集" }).click();
  const panel = page.locator(".edit-editor-modal");
  await panel.getByLabel("支払い元").fill("Bank");
  await expect(panel).toContainText("Visa → Bank");
  await expect(panel).toContainText("口座残高・残高予測には直接反映しません");
  await panel.locator("header button[aria-label='閉じる']").click();
  await page.getByRole("dialog", { name: "未保存の変更を破棄しますか？" })
    .getByRole("button", { name: "編集を続ける" }).click();
  await expect(panel.getByLabel("支払い元")).toHaveValue("Bank");
  await panel.getByRole("button", { name: "変更を保存" }).click();
  await panel.locator("header button[aria-label='閉じる']").click();
  await expect(row).toContainText("Bank");
});

test("reserves a subscription price and applies it from the next month", async ({ page }) => {
  await seedSubscription({
    name: "Price History",
    amount: 1000,
    interval: 1,
    startDate: new Date(`${getYearMonth()}-01T00:00:00.000Z`),
    dayOfMonth: 5,
  });
  await navigateTo(page, "/subscriptions");
  const monthlyCard = page.getByRole("heading", { name: "月別一覧" }).locator("../..");
  const row = page.getByRole("row", { name: /Price History/ });
  await expect(monthlyCard.getByRole("row", { name: /Price History/ })).toContainText(formatCurrency(1000));
  await row.getByRole("button", { name: "編集" }).click();
  const panel = page.locator(".edit-editor-modal");
  await panel.getByRole("button", { name: "金額変更を予約" }).click();
  await panel.getByLabel("適用開始日").fill(`${getYearMonth(-1)}-01`);
  await panel.getByRole("button", { name: "金額変更を記録" }).click();
  await expect(panel.getByText(/適用開始日は契約開始日/)).toBeVisible();
  await panel.getByLabel("適用開始日").fill(`${getYearMonth()}-01`);
  await panel.getByRole("button", { name: "金額変更を記録" }).click();
  await expect(panel.getByText(/適用開始日は契約開始日/)).toBeVisible();
  await panel.getByLabel("適用開始日").fill(`${getYearMonth(1)}-01`);
  await panel.getByLabel("金額 (JPY)").fill("1200");
  await panel.getByRole("button", { name: "変更を予約" }).click();
  await panel.getByRole("button", { name: "価格履歴" }).click();
  await expect(panel).toContainText(`${getYearMonth(1)}-01 〜 無期限`);
  await panel.locator("header button[aria-label='閉じる']").click();

  const priceRows = page.getByRole("heading", { name: "サブスク一覧" }).locator("../..").getByRole("row", { name: /Price History/ });
  await expect(priceRows).toHaveCount(1);
  await expect(priceRows).toContainText(formatCurrency(1000));
  await expect(priceRows).toContainText(formatCurrency(1200));
  await expect(priceRows).toContainText(`${getYearMonth(1)}-01`);
  await expect(monthlyCard.getByRole("row", { name: /Price History/ })).toContainText(formatCurrency(1000));
  await page.getByRole("button", { name: "次月" }).click();
  await expect(monthlyCard.getByRole("row", { name: /Price History/ })).toContainText(formatCurrency(1200));
  await expect(monthlyCard).toContainText(formatCurrency(1200));

  await priceRows.getByRole("button", { name: "編集" }).click();
  await panel.getByRole("button", { name: "価格履歴" }).click();
  await panel.getByRole("button", { name: `${getYearMonth(1)}-01 の履歴を訂正` }).click();
  await panel.getByLabel("金額 (JPY)").fill("1300");
  await panel.getByRole("button", { name: "訂正を保存" }).click();
  await expect(panel).toContainText(formatCurrency(1300));
  await panel.locator("header button[aria-label='閉じる']").click();
  await expect(panel).not.toBeVisible();
  await expect(priceRows).toContainText(formatCurrency(1300));
  await expect(monthlyCard.getByRole("row", { name: /Price History/ })).toContainText(formatCurrency(1300));

  await priceRows.getByRole("button", { name: "編集" }).click();
  await panel.getByRole("button", { name: "価格履歴" }).click();
  await panel.getByRole("button", { name: `${getYearMonth(1)}-01 の履歴を削除` }).click();
  await panel.getByRole("button", { name: "削除を確認" }).click();
  await page.getByRole("dialog", { name: "価格履歴を削除しますか？" }).getByRole("button", { name: "削除する" }).click();
  await panel.locator("header button[aria-label='閉じる']").click();
  await expect(priceRows).not.toContainText(formatCurrency(1300));
  await expect(monthlyCard.getByRole("row", { name: /Price History/ })).toContainText(formatCurrency(1000));
});

test("shows the current price and hides expired price periods", async ({ page }) => {
  await seedSubscription({
    name: "Archived Price",
    amount: 1000,
    interval: 1,
    startDate: new Date(`${getYearMonth(-2)}-01T00:00:00.000Z`),
    dayOfMonth: 5,
  });
  await navigateTo(page, "/subscriptions");
  await page.getByRole("row", { name: /Archived Price/ }).getByRole("button", { name: "編集" }).click();
  const panel = page.locator(".edit-editor-modal");
  await panel.getByRole("button", { name: "金額変更を予約" }).click();
  await panel.getByLabel("適用開始日").fill(getFutureDate(-1));
  await panel.getByLabel("金額 (JPY)").fill("1200");
  await panel.getByRole("button", { name: "金額変更を記録" }).click();
  await panel.getByRole("button", { name: "価格履歴" }).click();
  await expect(panel).toContainText(formatCurrency(1000));
  await expect(panel).toContainText(formatCurrency(1200));
  await panel.locator("header button[aria-label='閉じる']").click();

  const listCard = page.getByRole("heading", { name: "サブスク一覧" }).locator("../..");
  const activeTable = listCard.locator("table").first();
  const priceRow = activeTable.getByRole("row", { name: /Archived Price/ });
  await expect(priceRow).toHaveCount(1);
  await expect(priceRow).toContainText(formatCurrency(1200));
  await expect(priceRow).not.toContainText(formatCurrency(1000));
});

test("switches monthly targets and annual totals correctly", async ({ page }) => {
  // eslint-disable-next-line sui/no-fixed-e2e-date -- ブラウザ時計を固定した月別集計・終了済み表示の検証。
  await page.clock.install({ time: new Date("2026-03-14T00:00:00.000Z") });

  await seedSubscription({
    name: "Netflix",
    amount: 1500,
    interval: 1,
    // eslint-disable-next-line sui/no-fixed-e2e-date -- ブラウザ時計を固定した月別集計・終了済み表示の検証。
    startDate: new Date("2026-01-05T00:00:00.000Z"),
    dayOfMonth: 5,
    paymentSource: "Visa",
  });
  await seedSubscription({
    name: "Adobe CC",
    amount: 3000,
    interval: 3,
    // eslint-disable-next-line sui/no-fixed-e2e-date -- ブラウザ時計を固定した月別集計・終了済み表示の検証。
    startDate: new Date("2026-02-10T00:00:00.000Z"),
    dayOfMonth: 10,
    paymentSource: "Main Account",
  });

  await navigateTo(page, "/subscriptions");

  const monthlyCard = page.getByRole("heading", { name: "月別一覧" }).locator("../..");
  // eslint-disable-next-line sui/no-fixed-e2e-date -- ブラウザ時計を固定した月別集計・終了済み表示の検証。
  const annualCard = page.getByText("2026年の年間合計").locator("../..");

  await page.getByRole("button", { name: "前月" }).click();
  // eslint-disable-next-line sui/no-fixed-e2e-date -- ブラウザ時計を固定した月別集計・終了済み表示の検証。
  await expect(monthlyCard).toContainText("2026年2月");
  await expect(monthlyCard).toContainText("Netflix");
  await expect(monthlyCard).toContainText("Adobe CC");
  await expect(monthlyCard).toContainText(formatCurrency(4500));

  await page.getByRole("button", { name: "次月" }).click();
  // eslint-disable-next-line sui/no-fixed-e2e-date -- ブラウザ時計を固定した月別集計・終了済み表示の検証。
  await expect(monthlyCard).toContainText("2026年3月");
  await expect(monthlyCard).not.toContainText("Adobe CC");
  await expect(monthlyCard).toContainText(formatCurrency(1500));

  await expect(annualCard).toContainText(formatCurrency(30000));
  await expect(annualCard).toContainText(formatCurrency(2500));
  await expect(annualCard).toContainText("2件");
});

test("creates and edits a weekly subscription", async ({ page }) => {
  await navigateTo(page, "/subscriptions");

  await page.getByRole("button", { name: "サブスクを追加" }).click();
  await page.getByLabel("サービス名 *").first().fill("Gym");
  await page.getByLabel("金額 (JPY) *").fill("5000");
  await page.getByLabel("周期").first().selectOption("weekly");
  await page.getByLabel("曜日").first().selectOption("5");
  await page.getByLabel("課金開始日 *").first().fill(getFutureDate(-7));
  await page.getByLabel("支払い元").first().fill("Visa");
  await page.getByRole("button", { name: "追加する" }).click();
  await waitForReload(page);

  const listCard = page.getByRole("heading", { name: "サブスク一覧" }).locator("../..");
  const row = listCard.getByRole("row", { name: /Gym/ });
  await expect(row).toContainText("毎週 金曜日");

  await row.getByRole("button", { name: "編集" }).click();
  await page.locator(".edit-editor-modal").getByLabel("曜日").selectOption("6");
  await page.locator(".edit-editor-modal").getByRole("button", { name: "変更を保存" }).click();
  await page.locator(".edit-editor-modal header button[aria-label='閉じる']").click();
  await waitForReload(page);

  await expect(listCard.getByRole("row", { name: /Gym/ })).toContainText("毎週 土曜日");
});

test("shows weekly subscription occurrences in the monthly summary", async ({ page }) => {
  // eslint-disable-next-line sui/no-fixed-e2e-date -- ブラウザ時計を固定した月別集計・終了済み表示の検証。
  await page.clock.install({ time: new Date("2026-11-01T00:00:00.000Z") });
  await navigateTo(page, "/subscriptions");

  await page.getByRole("button", { name: "サブスクを追加" }).click();
  await page.getByLabel("サービス名 *").first().fill("Gym");
  await page.getByLabel("金額 (JPY) *").fill("1000");
  await page.getByLabel("周期").first().selectOption("weekly");
  await page.getByLabel("曜日").first().selectOption("0");
  // eslint-disable-next-line sui/no-fixed-e2e-date -- ブラウザ時計を固定した月別集計・終了済み表示の検証。
  await page.getByLabel("課金開始日 *").first().fill("2026-11-01");
  await page.getByRole("button", { name: "追加する" }).click();
  await waitForReload(page);

  const monthlyCard = page.getByRole("heading", { name: "月別一覧" }).locator("../..");
  await expect(monthlyCard).toContainText("5 件");
  await expect(monthlyCard).toContainText(formatCurrency(5000));
  await expect(monthlyCard.getByRole("row", { name: /Gym/ })).toHaveCount(5);
  // eslint-disable-next-line sui/no-fixed-e2e-date -- ブラウザ時計を固定した月別集計・終了済み表示の検証。
  await expect(monthlyCard).toContainText("2026年11月1日（毎週 日曜日）");
  // eslint-disable-next-line sui/no-fixed-e2e-date -- ブラウザ時計を固定した月別集計・終了済み表示の検証。
  await expect(monthlyCard).toContainText("2026年11月29日（毎週 日曜日）");
});

test("creates a USD subscription and displays monthly totals in JPY", async ({ page }) => {
  await navigateTo(page, "/subscriptions");

  await page.getByRole("button", { name: "サブスクを追加" }).click();
  await page.getByLabel("サービス名 *").first().fill("USD Service");
  await page.getByLabel("通貨").first().selectOption("USD");
  await page.getByLabel("JPY換算レート").first().fill("150");
  await page.getByLabel("金額 (USD) *").fill("10.99");
  await page.getByLabel("課金開始日 *").first().fill(`${getYearMonth()}-01`);
  await page.getByLabel("毎月の発生日").first().fill("5");
  await page.getByRole("button", { name: "追加する" }).click();
  await waitForReload(page);

  const listCard = page.getByRole("heading", { name: "サブスク一覧" }).locator("../..");
  const monthlyCard = page.getByRole("heading", { name: "月別一覧" }).locator("../..");
  const row = listCard.getByRole("row", { name: /USD Service/ });
  await expect(row).toContainText(new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(10.99));
  await expect(monthlyCard).toContainText(formatCurrency(1649));
});

test("archives an ended subscription and restores it by clearing end date", async ({ page }) => {
  // eslint-disable-next-line sui/no-fixed-e2e-date -- ブラウザ時計を固定した月別集計・終了済み表示の検証。
  await page.clock.install({ time: new Date("2026-03-14T00:00:00.000Z") });
  await navigateTo(page, "/subscriptions");

  await page.getByRole("button", { name: "サブスクを追加" }).click();
  await page.getByLabel("サービス名 *").first().fill("Archived Sub");
  await page.getByLabel("金額 (JPY) *").first().fill("1000");
  // eslint-disable-next-line sui/no-fixed-e2e-date -- ブラウザ時計を固定した月別集計・終了済み表示の検証。
  await page.getByLabel("課金開始日 *").first().fill("2026-01-05");
  await page.getByLabel("毎月の発生日").first().fill("5");
  // eslint-disable-next-line sui/no-fixed-e2e-date -- ブラウザ時計を固定した月別集計・終了済み表示の検証。
  await page.getByLabel("終了日").first().fill("2026-02-28");
  await page.getByLabel("支払い元").first().fill("Visa");
  await page.getByRole("button", { name: "追加する" }).click();
  await waitForReload(page);

  const listCard = page.getByRole("heading", { name: "サブスク一覧" }).locator("../..");
  const activeTable = listCard.locator("table").first();
  await expect(activeTable.getByRole("row", { name: /Archived Sub/ })).toHaveCount(0);

  const archivedDetails = page.locator("details").filter({
    has: page.locator("summary", { hasText: /終了済み/ }),
  });
  await expect(archivedDetails).toBeVisible();
  await archivedDetails.locator("summary").click();
  await expect(archivedDetails.getByRole("row", { name: /Archived Sub/ })).toBeVisible();
  await expect(archivedDetails.getByRole("row", { name: /Archived Sub/ })).toContainText("適用中の金額なし");

  await archivedDetails.getByRole("button", { name: "編集" }).click();
  await page.locator(".edit-editor-modal").getByLabel("終了日").fill("");
  await page.locator(".edit-editor-modal").getByRole("button", { name: "変更を保存" }).click();
  await page.locator(".edit-editor-modal header button[aria-label='閉じる']").click();
  await waitForReload(page);

  await expect(activeTable.getByRole("row", { name: /Archived Sub/ })).toBeVisible();
  await expect(page.locator("details").filter({
    has: page.locator("summary", { hasText: /終了済み/ }),
  })).toHaveCount(0);
});
