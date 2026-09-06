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
  await page.getByLabel("明細の有効な鮮度（日）").fill("3");
  await page.getByLabel("承認有効期間（日）").fill("7");
  await page.getByLabel("資金確認期間（日）").fill("30");
  await page.getByRole("button", { name: "設定を保存" }).click();
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
  await page.getByLabel("文字コード").selectOption("utf-8");
  await page
    .getByLabel("CSVファイル")
    .setInputFiles({
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
  await page
    .getByRole("checkbox", { name: "対象期間全体の明細を確認した" })
    .check();
  await page.getByRole("button", { name: "確認して取込確定" }).click();
  await expect(page.getByLabel("カテゴリ: 教養/学習（未対応）")).toBeVisible();
  await page.getByLabel("カテゴリ: 教養/学習（未対応）").fill("学習");
  await page.getByRole("button", { name: "対応付けを保存" }).first().click();
  await expect(
    page.getByLabel("カテゴリ: 教養/学習", { exact: true }),
  ).toBeVisible();
});
