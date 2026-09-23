import { createApiClient } from "./helpers/api";
import type { Account, SpendingResponse } from "@sui/shared";
import { expect, test } from "./helpers/test";
import { navigateTo } from "./helpers/actions";
test("request page keeps USD units and an unsaved edit across a version conflict", async ({ page }) => {
  await navigateTo(page, "/spending/requests/new?tab=budgets");
  await expect(page.getByRole("heading", { name: "買い物の申請" })).toBeVisible();
  await page.getByLabel(/^買うもの/).fill("架空の輸入書籍");
  await page.getByLabel("金額（円）").fill("1234");
  await page.getByLabel(/^カテゴリ/).fill("教養");
  await page.getByLabel(/^購入理由/).fill("外貨入力の確認");
  await page.getByLabel(/^支払手段/).fill("架空カード");
  await page.getByRole("button", { name: "補足情報・外貨設定" }).click();
  await page.getByLabel("通貨", { exact: true }).fill("USD");
  await expect(page.getByLabel("金額（USD）")).toHaveValue("12.34");
  await page.getByLabel("1 USD あたりのJPY換算率").fill("150");
  await page.getByRole("button", { name: "下書きを保存" }).click();
  await expect(page).toHaveURL(/\/spending\?tab=budgets/);
  const apiFetch = createApiClient(page.request);
  const saved = await apiFetch<SpendingResponse>("/api/spending");
  const request = saved.ledger.requests.find((item) => item.input.name === "架空の輸入書籍");
  expect(request).toBeDefined();
  expect(request!.input.items[0].amount).toBe(1234);
  expect(request!.input.rateToJpy).toBe(1.5);
  await navigateTo(page, `/spending/requests/${request!.id}/edit?tab=budgets&request=${request!.id}`);
  await page.reload();
  await expect(page.getByLabel("金額（USD）")).toHaveValue("12.34");
  await page.getByLabel(/^買うもの/).fill("架空の輸入書籍・改訂");
  await page.getByRole("button", { name: "支出決裁に戻る" }).click();
  await expect(page.getByRole("dialog", { name: "未保存の変更を破棄しますか？" })).toBeVisible();
  await page.getByRole("button", { name: "編集を続ける" }).click();
  await page.route("**/api/spending/commands", (route) => route.fulfill({ status: 500, json: { error: "一時的な失敗" } }));
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(page.getByLabel(/^買うもの/)).toHaveValue("架空の輸入書籍・改訂");
  await expect(page.getByRole("alert").filter({ hasText: "一時的な失敗" })).toBeVisible();
  await page.unroute("**/api/spending/commands");
  await page.route("**/api/spending/commands", (route) => route.fulfill({ status: 409, json: { error: "競合" } }));
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(page.getByLabel(/^買うもの/)).toHaveValue("架空の輸入書籍・改訂");
  await expect(page.getByRole("button", { name: "最新状態を確認して再編集" })).toBeVisible();
  await page.unroute("**/api/spending/commands");
  await page.getByRole("button", { name: "最新状態を確認して再編集" }).click();
  await page.getByRole("button", { name: "変更を破棄" }).click();
  await expect(page.getByLabel(/^買うもの/)).toHaveValue("架空の輸入書籍");
  await page.getByLabel(/^買うもの/).fill("架空の輸入書籍・保存済み");
  let posts = 0;
  let failRefresh = true;
  await page.route("**/api/spending/commands", (route) => { posts++; return route.continue(); });
  await page.route("**/api/spending", (route) => {
    if (route.request().method() === "GET" && failRefresh) {
      failRefresh = false;
      return route.fulfill({ status: 500, json: { error: "再取得の失敗" } });
    }
    return route.continue();
  });
  await page.getByRole("button", { name: "変更を保存" }).click();
  await expect(page.getByText("保存済み・表示更新失敗")).toBeVisible();
  expect(posts).toBe(1);
  await page.getByRole("button", { name: "表示を再取得" }).click();
  await expect(page).toHaveURL(/\/spending\?tab=budgets/);
  expect(posts).toBe(1);
  await page.unroute("**/api/spending/commands");
  await page.unroute("**/api/spending");
  await navigateTo(page, "/spending/requests/missing-request/edit");
  await expect(page.getByText("申請が見つかりません。")).toBeVisible();
});
test("unknown currency stays in minor units and AI secret stays out of the change summary", async ({ page }) => {
  await navigateTo(page, "/spending/requests/new");
  await expect(page.getByRole("heading", { name: "買い物の申請" })).toBeVisible();
  await page.getByLabel(/^買うもの/).fill("架空の未知通貨購入");
  await page.getByLabel(/^カテゴリ/).fill("教養");
  await page.getByLabel(/^購入理由/).fill("単位の互換入力を確認");
  await page.getByLabel(/^支払手段/).fill("架空カード");
  await page.getByRole("button", { name: "補足情報・外貨設定" }).click();
  await page.getByLabel("通貨", { exact: true }).fill("ZZZ");
  await page.getByLabel("金額（最小通貨単位）").fill("1234");
  await page.getByLabel("最小通貨単位からJPYへの換算率").fill("1.5");
  await page.getByRole("button", { name: "下書きを保存" }).click();
  await expect(page.getByRole("region", { name: "架空の未知通貨購入の申請" })).toBeVisible();
  const apiFetch = createApiClient(page.request);
  const state = await apiFetch<SpendingResponse>("/api/spending");
  const request = state.ledger.requests.find((item) => item.input.name === "架空の未知通貨購入");
  expect(request).toBeDefined();
  expect(request!.input.currency).toBe("ZZZ");
  expect(request!.input.items[0].amount).toBe(1234);
  expect(request!.input.rateToJpy).toBe(1.5);
  await page.getByRole("button", { name: "決裁設定", exact: true }).click();
  const secret = "test-only-secret-never-render";
  await page.getByLabel("APIキー").fill(secret);
  await expect(page.getByText("APIキーを変更", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(secret);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(secret);
  await page.getByRole("button", { name: "通常予算", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "未保存の変更を破棄しますか？" })).toBeVisible();
  await page.getByRole("button", { name: "編集を続ける" }).click();
  await expect(page.getByLabel("APIキー")).toHaveValue(secret);
});
test("spending setup, manual draft, AI hold and synthetic MF import", async ({
  page,
}, testInfo) => {
  await navigateTo(page, "/spending");
  await expect(
    page.getByRole("heading", { name: "支出決裁", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "決裁設定", exact: true }).click();
  await expect(
    page.getByLabel("決裁が必要な金額（この額以上・円）"),
  ).toHaveValue("10000");
  await expect(page.getByLabel("承認有効期間（日）")).toHaveValue("14");
  await page.getByLabel("承認有効期間（日）").fill("7");
  await page
    .getByText("データ更新と補正予算の詳細設定", { exact: true })
    .click();
  await page.getByLabel("当月のMFデータを更新する目安（日）").fill("3");
  await page.getByLabel("補正予算で考慮する支払予定の期間（日）").fill("30");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  await page.getByRole("button", { name: "設定を保存", exact: true }).click();
  await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新規申請", exact: true }).click();
  await expect(page.getByLabel(/^購入予定日/)).toBeVisible();
  await expect(
    page.getByLabel("予測から充当する額", { exact: false }),
  ).toHaveCount(0);
  await page.getByLabel(/^買うもの/).fill("架空の学習用書架");
  await page
    .getByLabel(/^購入理由/)
    .fill("架空の学習資料を収納する");
  await page.getByLabel(/^支払手段/).fill("架空カード");
  await page.getByLabel("金額（円）").fill("10000");
  await page.getByLabel(/^カテゴリ/).fill("学習");
  await expect(
    page.getByText("決裁対象の金額です", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("simple-request-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("simple-request-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "下書きを保存" }).click();
  await page.getByRole("button", { name: "申請", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "架空の学習用書架の申請", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("request-card-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: testInfo.outputPath("request-card-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "購入した", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "AI審査", exact: true }),
  ).toHaveClass(/bg-brand/);
  await expect(
    page.getByRole("button", { name: "購入した", exact: true }),
  ).toHaveClass(/bg-brand/);
  await page.getByRole("button", { name: "AI審査", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "今回の審査結果" })
      .getByText("AI接続先とモデルを設定してください"),
  ).toBeVisible();
  await expect(page.getByLabel("購入実績の理由")).not.toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("simple-result-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await expect(
    page.getByRole("button", { name: "購入した", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "MF取込・明細", exact: true }).click();
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
  }).format(new Date());
  const csv =
    "計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID\n" +
    `1,${date.replaceAll("-", "/")},架空の文具店,-1100,架空カード,教養,学習,,0,synthetic-e2e`;
  await page.getByLabel("CSVファイル").setInputFiles({
    name: "synthetic-only.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page
    .getByRole("button", { name: "取込プレビュー", exact: true })
    .click();
  await expect(
    page.getByText("synthetic-only.csv · 1行 · エラー 0件"),
  ).toBeVisible();
  await page.getByRole("button", { name: "確認して月のデータを更新" }).click();
  await expect(
    page.getByRole("cell", { name: "教養/学習", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("カテゴリ・支払手段の対応付け", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "架空の文具店", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "MF明細", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "補足を保存" })).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  await page.getByRole("button", { name: "申請", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "購入した", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "新規申請", exact: true }).click();
  await page.getByLabel(/^買うもの/).fill("架空の追加申請");
  await page.getByLabel("金額（円）").fill("1500");
  await page.getByLabel(/^カテゴリ/).fill("教養");
  await page.getByLabel(/^購入理由/).fill("別カードの操作確認");
  await page.getByLabel(/^支払手段/).fill("架空カード");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await page.getByRole("button", { name: "申請", exact: true }).click();
  const first = page.getByRole("region", {
    name: "架空の学習用書架の申請",
    exact: true,
  });
  const second = page.getByRole("region", {
    name: "架空の追加申請の申請",
    exact: true,
  });
  await expect(
    first.getByRole("button", { name: "AI審査", exact: true }),
  ).toBeVisible();
  await expect(
    second.getByRole("button", { name: "AI審査", exact: true }),
  ).toBeVisible();
  await first.getByRole("button", { name: "根拠を見る", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "審査の根拠", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("evidence-dialog-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await expect(
    second.getByRole("heading", { name: "審査の根拠", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  await first.getByRole("button", { name: "履歴を見る", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "変更・審査履歴", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  await first.getByRole("button", { name: "購入した", exact: true }).click();
  const purchaseDialog = page.getByRole("dialog", { name: "架空の学習用書架の購入を記録", exact: true });
  await expect(purchaseDialog).toBeVisible();
  await purchaseDialog.getByLabel("購入実額", { exact: true }).fill("9800");
  await page.screenshot({
    path: testInfo.outputPath("purchase-dialog-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await purchaseDialog
    .getByRole("button", { name: "購入を記録", exact: true })
    .click();
  await expect(purchaseDialog).not.toBeVisible();
  await expect(first).not.toBeVisible();
  await expect(second).toBeVisible();
  await page.getByText("購入完了 (1)", { exact: true }).click();
  await expect(first).toBeVisible();
  await first
    .getByRole("button", { name: "購入記録を訂正", exact: true })
    .click();
  const correctionDialog = page.getByRole("dialog", { name: "架空の学習用書架の購入記録を訂正", exact: true });
  await expect(
    correctionDialog.getByLabel("購入実額", { exact: true }),
  ).toHaveValue("9800");
  await correctionDialog
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  await expect(first.getByText(/JPY · 完了/)).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: testInfo.outputPath("multiple-request-cards.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("effective MF budgets, provider presets and responsive import viewer", async ({
  page,
}, testInfo) => {
  await navigateTo(page, "/spending");
  await page.getByRole("button", { name: "通常予算", exact: true }).click();
  await page.getByLabel("カテゴリ1", { exact: true }).fill("教養");
  await page.getByLabel("月額予算1（円）").fill("20000");
  await page.getByLabel("改定理由", { exact: true }).fill("架空のMF予算");
  await page.getByRole("button", { name: "予算案を保存" }).click();
  await expect(page.getByText("月額合計 20,000円")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("budget-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "決裁設定", exact: true }).click();
  await expect(page.getByLabel("サービス", { exact: true })).toHaveValue(
    "openai",
  );
  await expect(page.getByLabel("接続先URL", { exact: true })).not.toBeVisible();
  await page.getByLabel("サービス", { exact: true }).selectOption("anthropic");
  await page.getByLabel("APIキー", { exact: true }).fill("synthetic-only");
  await page.route("**/api/spending/ai/models", (route) =>
    route.fulfill({
      json: { models: [{ id: "synthetic-model", name: "架空モデル" }] },
    }),
  );
  await page.getByRole("button", { name: "モデル一覧を取得" }).click();
  await expect(page.getByText("1件のモデルを取得しました")).toBeVisible();
  await page.getByLabel("モデル", { exact: true }).fill("synthetic-model");
  await page.route("**/api/spending/ai/test", (route) =>
    route.fulfill({ json: { ok: true, model: "synthetic-model" } }),
  );
  await page.getByRole("button", { name: "接続を確認", exact: true }).click();
  await expect(page.getByText("接続と審査形式を確認できました")).toBeVisible();
  await page.getByLabel("サービス", { exact: true }).selectOption("custom");
  await page
    .getByRole("button", { name: "接続の詳細設定", exact: true })
    .click();
  await expect(page.getByLabel("接続先URL", { exact: true })).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByLabel("サービス", { exact: true }).selectOption("openai");
  await page.screenshot({
    path: testInfo.outputPath("settings-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
  await page.getByRole("button", { name: "MF取込・明細", exact: true }).click();
  await expect(page.getByLabel("CSVファイル", { exact: true })).toBeVisible();
  await expect(page.getByLabel("対象期間の開始")).toHaveCount(0);
  await expect(page.getByLabel("文字コード", { exact: true })).toHaveCount(0);
  const date = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
  }).format(new Date());
  const csv =
    "計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID\n" +
    `1,${date},架空の長い名前の文具専門店,-1200,架空カード,教養,学習,,0,synthetic-layout`;
  await page.getByLabel("CSVファイル", { exact: true }).setInputFiles({
    name: "synthetic-layout.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page
    .getByRole("button", { name: "取込プレビュー", exact: true })
    .click();
  await page.getByRole("button", { name: "確認して月のデータを更新" }).click();
  await expect(page.getByRole("cell", { name: "教養/学習" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("import-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: testInfo.outputPath("import-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "通常予算", exact: true }).click();
  const budgetRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("cell", { name: "教養", exact: true }) });
  await expect(budgetRow).toContainText("1,200円");
  await expect(budgetRow).toContainText("18,800円");
  await page.getByRole("button", { name: "新規申請", exact: true }).click();
  await page.getByLabel(/^買うもの/).fill("架空の別購入");
  await page.getByLabel("金額（円）").fill("5000");
  await page.getByLabel(/^カテゴリ/).fill("教養");
  await page
    .getByLabel(/^購入理由/)
    .fill("予算とは独立した架空の確認");
  await page.getByLabel(/^支払手段/).fill("架空カード");
  await expect(page.getByLabel("使う予算", { exact: true })).toHaveValue(
    "normal",
  );
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
  await page.getByRole("button", { name: "申請", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "購入した", exact: true }),
  ).toBeEnabled();
  await page.evaluate(async (date) => {
    const call = async (path: string, body?: unknown) => {
      const r = await fetch(
        path,
        body
          ? {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-sui-client": "web",
              },
              body: JSON.stringify(body),
            }
          : { headers: { "x-sui-client": "web" } },
      );
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    };
    for (let offset = 1; offset <= 3; offset++) {
      const [year, month] = date.split("-").map(Number);
      const m = new Date(Date.UTC(year, month - 1 - offset, 1))
        .toISOString()
        .slice(0, 7);
      const csv =
        "計算対象,日付,内容,金額（円）,保有金融機関,大項目,中項目,メモ,振替,ID\n" +
        `1,${m}-01,synthetic,-1000,synthetic,教養,学習,,0,synthetic-${m}`;
      const bytes = new TextEncoder().encode(csv);
      const { version } = await call("/api/spending");
      const p = await call("/api/spending/imports/preview", {
        version,
        filename: "synthetic.csv",
        base64: btoa(String.fromCharCode(...bytes)),
      });
      await call("/api/spending/commands", {
        version: p.state.version,
        command: {
          action: "import-confirm",
          id: p.preview.id,
          resolutions: {},
          confirmedCoverage: true,
          acceptErrors: false,
        },
      });
    }
  }, date);
  await page.reload();
  await page.getByRole("button", { name: "その他の操作", exact: true }).click();
  await page
    .getByLabel("操作の理由", { exact: true })
    .fill("架空の承認フロー確認");
  await page.getByRole("button", { name: "例外承認", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "購入した", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "購入した", exact: true }),
  ).toHaveClass(/bg-brand/);
  await expect(
    page.getByRole("button", { name: "AI審査", exact: true }),
  ).toHaveClass(/bg-brand/);
  await page.getByRole("button", { name: "購入した", exact: true }).click();
  await page.getByRole("button", { name: "購入を記録", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "架空の別購入の申請", exact: true }),
  ).not.toBeVisible();
  await page.getByText("購入完了 (1)", { exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "架空の別購入の申請", exact: true })
      .getByText(/JPY · 完了/),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("purchase-completed-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "通常予算", exact: true }).click();
  await expect(budgetRow).toContainText("1,200円");
  await expect(budgetRow).toContainText("18,800円");
  await expect(
    page.getByRole("button", { name: "今後の支出予測を調整" }),
  ).toHaveCount(0);
});

for (const currency of ["JPY", "USD"]) {
  test(`supplemental approval without MF uses saved ${currency} funding and preserves normal history`, async ({
    page,
  }, testInfo) => {
    const { createServer } = await import("node:http");
    const server = createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  decision: "approvable",
                  reasons: ["架空の購入目的と資金条件を確認"],
                  options: [],
                  missing: [],
                  question: null,
                  assessment: {
                    evidenceIds: [],
                    concentration: "架空の履歴は未取込",
                    purpose: "架空の目的を確認",
                    amount: "架空の金額を確認",
                    conclusion: "参考情報の限界を踏まえて承認",
                  },
                }),
              },
            },
          ],
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address() as { port: number };
      await navigateTo(page, "/spending");
      await (async ({ currency, port }) => {
          const apiFetch = createApiClient(page.request);
          const call = <T = SpendingResponse>(url: string, body?: unknown) =>
            apiFetch<T>(
              url,
              body === undefined
                ? undefined
                : { method: "POST", body: JSON.stringify(body) },
            );
          await call("/api/accounts", {
            name: "架空資金元",
            sortOrder: 0,
            balance: 100000,
            balanceOffset: 10000,
            currencyCode: currency,
            exchangeRateToJpy: currency === "JPY" ? 1 : 1.5,
            supplementalBudgetEnabled: true,
          });
          await call("/api/accounts", {
            name: "架空振替先",
            sortOrder: 1,
            balance: 0,
            currencyCode: currency,
            exchangeRateToJpy: currency === "JPY" ? 1 : 1.5,
          });
          let s = await call("/api/spending");
          await call("/api/spending/commands", {
            version: s.version,
            command: {
              action: "settings",
              settings: {
                ...s.ledger.settings,
                freshnessDays: null,
                ai: {
                  endpoint: `http://spending-ai.e2e.invalid:${port}/chat/completions`,
                  model: "synthetic",
                  protocol: "chat-completions",
                  // Configured only on the isolated Playwright backend.
                  credentialEnv: "SUI_SPENDING_AI_E2E",
                },
              },
            },
          });
          s = await call("/api/spending");
          const date = new Intl.DateTimeFormat("sv-SE", {
            timeZone: "Asia/Tokyo",
          }).format(new Date());
          await call("/api/spending/commands", {
            version: s.version,
            command: {
              action: "request",
              input: {
                name: "架空の特別購入",
                amount: 30000,
                category: "特別な支出",
                reason: "架空の必要設備",
                payment: "架空カード",
                purchaseDate: date,
                currency,
                rateToJpy: currency === "JPY" ? 1 : 1.5,
                rateAt: date,
                kind: "normal",
                funding: null,
                urgency: "",
                replacement: "",
                alternatives: "",
                relatedIds: [],
              },
            },
          });
        })({ currency, port: address.port });
      await page.reload();
      await page.getByRole("button", { name: "AI審査", exact: true }).click();
      const result = page.getByRole("region", { name: "今回の審査結果" });
      await expect(
        result.getByRole("heading", { name: "保留", exact: true }),
      ).toBeVisible();
      await expect(result).toContainText("通常予算が未登録");
      await page
        .getByRole("button", { name: "申請を変更", exact: true })
        .click();
      await page
        .getByLabel("使う予算", { exact: true })
        .selectOption("supplemental");
      await page
        .getByLabel(/^資金元口座/)
        .selectOption({ label: "架空資金元" });
      await page
        .getByLabel(/^振替先口座/)
        .selectOption({ label: "架空振替先" });
      await page
        .getByRole("button", { name: "変更を保存", exact: true })
        .click();
      // Until re-review, the saved normal snapshot must still render as normal.
      await expect(result).toContainText("購入した場合の残額（試算）");
      await expect(result).not.toContainText("資金余力");
      await page.getByRole("button", { name: "AI審査", exact: true }).click();
      await expect(
        result.getByRole("heading", { name: "承認可", exact: true }),
      ).toBeVisible();
      await expect(result).toContainText("資金余力");
      await expect(result).toContainText("今回振替額");
      await expect(result).toContainText(
        currency === "JPY" ? "90,000" : "$900.00",
      );
      await expect(result).toContainText(
        currency === "JPY" ? "30,000" : "$300.00",
      );
      await expect(result).not.toContainText("通常予算が未登録");
      await expect(result).not.toContainText("MF予算残額");
      const s = await createApiClient(page.request)("/api/spending");
      expect(s.ledger.requests[0].status).toBe("approved");
      expect(s.ledger.requests[0].fundingLinks).toHaveLength(1);
      expect(s.requestStates[s.ledger.requests[0].id].funding[0].state).toBe(
        "scheduled",
      );
      expect(s.ledger.imports).toEqual([]);
      expect(s.ledger.budgetProposals).toEqual([]);
      await page
        .getByRole("button", { name: "根拠を見る", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toContainText(
        "通常予算・MF履歴は参考情報",
      );
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "閉じる", exact: true })
        .click();
      await page
        .getByRole("button", { name: "履歴を見る", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toContainText("通常予算が未登録");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "閉じる", exact: true })
        .click();
      await page.screenshot({
        path: testInfo.outputPath(`supplemental-${currency}.png`),
        fullPage: true,
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
}

for (const purchased of [false, true]) {
  test(`cancelled spending is archived and preserved (purchased=${purchased})`, async ({
    page,
  }) => {
    await navigateTo(page, "/spending");
    const id = await (async () => {
      const apiFetch = createApiClient(page.request);
      const call = <T = SpendingResponse>(url: string, body?: unknown) =>
        apiFetch<T>(
          url,
          body === undefined
            ? undefined
            : { method: "POST", body: JSON.stringify(body) },
        );
      let s = await call("/api/spending");
      const date = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo",
      }).format(new Date());
      await call("/api/spending/commands", {
        version: s.version,
        command: {
          action: "request",
          input: {
            name: "取消テスト",
            amount: 10000,
            category: "教養",
            reason: "架空の購入",
            payment: "架空カード",
            purchaseDate: date,
            currency: "JPY",
            rateToJpy: 1,
            rateAt: date,
            kind: "normal",
            funding: null,
            urgency: "",
            replacement: "",
            alternatives: "",
            relatedIds: [],
          },
        },
      });
      s = await call("/api/spending");
      const id = s.ledger.requests[0].id;
      if (purchased)
        await call("/api/spending/commands", {
          version: s.version,
          command: {
            action: "purchase",
            id,
            date,
            amount: 9000,
            reason: "購入の事実",
          },
        });
      return id;
    })();
    await page.reload();
    if (purchased)
      await page.getByText("購入完了 (1)", { exact: true }).click();
    const card = page.getByRole("region", {
      name: "取消テストの申請",
      exact: true,
    });
    await card.getByRole("button", { name: "その他の操作" }).click();
    await page.getByLabel("操作の理由").fill("購入計画を取り消し");
    await page.route("**/api/spending/commands", (route) =>
      route.fulfill({ status: 409, json: { error: "取消テストの競合" } }),
    );
    await page.getByRole("button", { name: "申請を取消", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("操作の理由")).toHaveValue(
      "購入計画を取り消し",
    );
    await expect(
      page.getByText("申請を取り消しました", { exact: true }),
    ).toHaveCount(0);
    await page.unroute("**/api/spending/commands");
    await page.getByRole("button", { name: "申請を取消", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("申請を取り消しました", { exact: true })).toBeVisible();
    await expect(card).not.toBeVisible();
    await page.getByText("取消済み (1)", { exact: true }).click();
    await expect(card).toContainText("JPY · 取消済み");
    await expect(card).toContainText("取消理由：購入計画を取り消し");
    await expect(card.locator("time")).toHaveAttribute(
      "datetime",
      /\d{4}-\d{2}-\d{2}T/,
    );
    if (purchased) {
      await expect(card).toContainText("9,000 JPY");
      await expect(page.getByText("購入完了 (1)", { exact: true })).toHaveCount(
        0,
      );
    }
    await card.getByRole("button", { name: "履歴を見る" }).click();
    await expect(page.getByRole("dialog")).toContainText("購入計画を取り消し");
    await navigateTo(page, `/spending?request=${id}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("JPY · 取消済み");
    if (purchased) await expect(card).toContainText("9,000 JPY");
  });
}

test("supplemental limit settings, answer retry, evidence and hard cap on mobile", async ({
  page,
}, testInfo) => {
  const { createServer } = await import("node:http");
  let calls = 0;
  const server = createServer((_req, res) => {
    calls++;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                calls === 2
                  ? "invalid JSON"
                  : JSON.stringify({
                      decision: "approvable",
                      reasons: ["架空の内訳と代替案を確認"],
                      options: [],
                      missing: [],
                      question: null,
                      assessment: {
                        evidenceIds: [],
                        concentration: "未取込のため支出なしとは断定しない",
                        purpose: "架空の必要性を確認",
                        amount: "架空の内訳と代替案を確認",
                        conclusion: "追加説明に基づく架空の判定",
                      },
                    }),
            },
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    await navigateTo(page, "/spending");
    await (async () => {
      const apiFetch = createApiClient(page.request);
      const call = <T = SpendingResponse>(url: string, body?: unknown) =>
        apiFetch<T>(
          url,
          body === undefined
            ? undefined
            : { method: "POST", body: JSON.stringify(body) },
        );
      const src = await call<Account>("/api/accounts", {
        name: "架空の補正口座",
        sortOrder: 0,
        balance: 200000,
        balanceOffset: 10000,
        currencyCode: "JPY",
        exchangeRateToJpy: 1,
        supplementalBudgetEnabled: true,
      });
      const dst = await call<Account>("/api/accounts", {
        name: "架空の支払口座",
        sortOrder: 1,
        balance: 0,
        currencyCode: "JPY",
        exchangeRateToJpy: 1,
      });
      let s = await call("/api/spending");
      await call("/api/spending/commands", {
        version: s.version,
        command: {
          action: "settings",
          settings: {
            ...s.ledger.settings,
            ai: {
              endpoint: `http://spending-ai.e2e.invalid:${port}/chat/completions`,
              model: "synthetic",
              protocol: "chat-completions",
              credentialEnv: "SUI_SPENDING_AI_E2E",
            },
          },
        },
      });
      s = await call("/api/spending");
      const date = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Tokyo",
      }).format(new Date());
      await call("/api/spending/commands", {
        version: s.version,
        command: {
          action: "request",
          input: {
            name: "架空の旅行申請",
            amount: 30000,
            category: "特別な支出",
            subcategory: "旅行",
            reason: "架空の旅行",
            payment: "架空カード",
            purchaseDate: date,
            currency: "JPY",
            rateToJpy: 1,
            rateAt: date,
            kind: "supplemental",
            funding: {
              sourceId: src.id,
              destinationId: dst.id,
              amount: 30000,
              date,
            },
            urgency: "",
            replacement: "",
            alternatives: "",
            relatedIds: [],
          },
        },
      });
    })();
    await page.reload();
    await page.getByRole("button", { name: "決裁設定", exact: true }).click();
    await page
      .getByRole("button", { name: "利用枠を追加", exact: true })
      .click();
    await page.getByLabel("利用枠1の金額（円）").fill("20000");
    await page.getByRole("button", { name: "設定を保存", exact: true }).click();
    await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "申請", exact: true }).click();
    await page.getByRole("button", { name: "AI審査", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "回答する", exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.getByRole("button", { name: "回答する", exact: true }).click();
    await page
      .getByRole("textbox", { name: "回答", exact: true })
      .fill(
        "架空の交通費と宿泊費です。減額案を比較し、必要な範囲に絞りました。",
      );
    await page.screenshot({
      path: testInfo.outputPath("review-answer-mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "回答を保存して再審査", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByText("回答を保存しました。", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "今回の審査結果" }),
    ).toContainText("AI接続失敗");
    await page.getByRole("button", { name: "AI審査", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "承認可", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "根拠を見る", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("金額の妥当性");
    await expect(page.getByRole("dialog")).toContainText("20,000円");
    await expect(page.getByRole("dialog")).toContainText(
      "追加説明を審査済みです",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("review-evidence-mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "閉じる", exact: true })
      .click();
    await page.getByRole("button", { name: "履歴を見る", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "架空の交通費と宿泊費です",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "閉じる", exact: true })
      .click();
    await page.getByRole("button", { name: "決裁設定", exact: true }).click();
    await page.getByLabel("利用枠1の超過時").selectOption("block");
    await page.getByRole("button", { name: "設定を保存", exact: true }).click();
    await expect(page.getByText("保存済み", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "申請", exact: true }).click();
    await page.getByRole("button", { name: "AI審査", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "今回の審査結果" }),
    ).toContainText("利用上限");
    await expect(
      page.getByRole("button", { name: "回答する", exact: true }),
    ).toHaveCount(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
