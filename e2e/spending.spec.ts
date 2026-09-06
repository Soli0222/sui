import { expect, test } from "@playwright/test";
import { resetDatabase } from "./helpers/db";
import { navigateTo } from "./helpers/actions";
test.beforeEach(async () => {
  await resetDatabase();
});
test("spending setup, manual draft, AI hold and synthetic MF import", async ({
  page,
}) => {
  await navigateTo(page, "/spending");
  await expect(
    page.getByRole("heading", { name: "支出決裁", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "決裁設定", exact: true }).click();
  await page.getByLabel("決裁が必要な金額（この額以上・円）").fill("10000");
  await page.getByLabel("当月のMFデータを更新する目安（日）").fill("3");
  await page.getByLabel("承認有効期間（日）").fill("7");
  await page.getByLabel("補正予算で考慮する支払予定の期間（日）").fill("30");
  await page.getByRole("button", { name: "設定を保存", exact: true }).click();
  await expect(page.getByRole("status")).not.toBeVisible();
  await page.getByRole("button", { name: "新規申請", exact: true }).click();
  await page.getByLabel("申請名", { exact: true }).fill("架空の学習用書架");
  await page
    .getByLabel("用途・購入理由", { exact: true })
    .fill("架空の学習資料を収納する");
  await page.getByLabel("支払手段", { exact: true }).fill("架空カード");
  await page.getByLabel("内訳1 品名").fill("架空の書架");
  await page.getByLabel("金額（通貨の最小単位）").fill("10000");
  await page.getByLabel("予算カテゴリ", { exact: true }).fill("学習");
  await expect(
    page.getByText("決裁対象の金額です", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "下書きを保存" }).click();
  await page.getByRole("button", { name: /架空の学習用書架.*下書き/ }).click();
  await page.getByRole("button", { name: "AI審査", exact: true }).click();
  await expect(
    page.getByText("AI接続先とモデルを設定してください"),
  ).toBeVisible();
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
  await expect(page.getByLabel("接続先URL", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByLabel("サービス", { exact: true }).selectOption("openai");
  await page.screenshot({
    path: testInfo.outputPath("settings-mobile.png"),
    fullPage: true,
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
  await page
    .getByLabel("CSVファイル", { exact: true })
    .setInputFiles({
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
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: testInfo.outputPath("import-desktop.png"),
    fullPage: true,
  });
});
