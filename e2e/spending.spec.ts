import { expect, test } from "@playwright/test";
import { resetDatabase } from "./helpers/db";
import { navigateTo } from "./helpers/actions";
test.beforeEach(async () => {
  await resetDatabase();
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
  await expect(page.getByRole("status")).not.toBeVisible();
  await page.getByRole("button", { name: "新規申請", exact: true }).click();
  await expect(page.getByLabel("購入予定日", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("予測から充当する額", { exact: false }),
  ).toHaveCount(0);
  await page.getByLabel("買うもの", { exact: true }).fill("架空の学習用書架");
  await page
    .getByLabel("購入理由", { exact: true })
    .fill("架空の学習資料を収納する");
  await page.getByLabel("支払手段", { exact: true }).fill("架空カード");
  await page.getByLabel("金額（円）").fill("10000");
  await page.getByLabel("カテゴリ", { exact: true }).fill("学習");
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
  await page.getByLabel("買うもの", { exact: true }).fill("架空の追加申請");
  await page.getByLabel("金額（円）").fill("1500");
  await page.getByLabel("カテゴリ", { exact: true }).fill("教養");
  await page.getByLabel("購入理由", { exact: true }).fill("別カードの操作確認");
  await page.getByLabel("支払手段", { exact: true }).fill("架空カード");
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
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
  const purchaseDialog = page.getByRole("dialog", {
    name: "購入を完了する",
    exact: true,
  });
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
  const correctionDialog = page.getByRole("dialog", {
    name: "購入記録を訂正",
    exact: true,
  });
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
  await page.getByLabel("買うもの", { exact: true }).fill("架空の別購入");
  await page.getByLabel("金額（円）").fill("5000");
  await page.getByLabel("カテゴリ", { exact: true }).fill("教養");
  await page
    .getByLabel("購入理由", { exact: true })
    .fill("予算とは独立した架空の確認");
  await page.getByLabel("支払手段", { exact: true }).fill("架空カード");
  await expect(page.getByLabel("使う予算", { exact: true })).toHaveValue(
    "normal",
  );
  await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
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
  await expect(page.getByRole("dialog").getByRole("status")).not.toBeVisible();
  await page
    .getByRole("dialog", { name: "その他の操作", exact: true })
    .getByRole("button", { name: "閉じる", exact: true })
    .click();
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
  test(`supplemental approval without MF uses saved ${currency} funding and preserves normal history`, async ({ page }, testInfo) => {
    const { createServer } = await import("node:http");
    const server = createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        decision: "approvable", reasons: ["架空の購入目的と資金条件を確認"], options: [], missing: [],
      }) } }] }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address() as { port: number };
      await navigateTo(page, "/spending");
      await page.evaluate(async ({ currency, port }) => {
        const { apiFetch } = await import("/src/lib/api.ts");
        const call = (url: string, body?: unknown) => apiFetch(url, body === undefined ? undefined : { method: "POST", body: JSON.stringify(body) });
        await call("/api/accounts", { name: "架空資金元", sortOrder: 0, balance: 100000, balanceOffset: 10000, currencyCode: currency, exchangeRateToJpy: currency === "JPY" ? 1 : 1.5, supplementalBudgetEnabled: true });
        await call("/api/accounts", { name: "架空振替先", sortOrder: 1, balance: 0, currencyCode: currency, exchangeRateToJpy: currency === "JPY" ? 1 : 1.5 });
        let s = await call("/api/spending");
        await call("/api/spending/commands", { version: s.version, command: { action: "settings", settings: { ...s.ledger.settings, freshnessDays: null, ai: {
          endpoint: `http://127.0.0.1:${port}/chat/completions`, model: "synthetic", protocol: "chat-completions",
          // Configured only on the isolated Playwright backend.
          credentialEnv: "SUI_SPENDING_AI_E2E",
        } } } });
        s = await call("/api/spending");
        const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
        await call("/api/spending/commands", { version: s.version, command: { action: "request", input: {
          name: "架空の特別購入", amount: 30000, category: "特別な支出", reason: "架空の必要設備", payment: "架空カード",
          purchaseDate: date, currency, rateToJpy: currency === "JPY" ? 1 : 1.5, rateAt: date,
          kind: "normal", funding: null, urgency: "", replacement: "", alternatives: "", relatedIds: [],
        } } });
      }, { currency, port: address.port });
      await page.reload();
      await page.getByRole("button", { name: "AI審査", exact: true }).click();
      const result = page.getByRole("region", { name: "今回の審査結果" });
      await expect(result.getByRole("heading", { name: "保留", exact: true })).toBeVisible();
      await expect(result).toContainText("通常予算が未登録");
      await page.getByRole("button", { name: "申請を変更", exact: true }).click();
      await page.getByLabel("使う予算", { exact: true }).selectOption("supplemental");
      await page.getByLabel("資金元口座", { exact: true }).selectOption({ label: "架空資金元" });
      await page.getByLabel("振替先口座", { exact: true }).selectOption({ label: "架空振替先" });
      await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
      // Until re-review, the saved normal snapshot must still render as normal.
      await expect(result).toContainText("購入した場合の残額（試算）");
      await expect(result).not.toContainText("資金余力");
      await page.getByRole("button", { name: "AI審査", exact: true }).click();
      await expect(result.getByRole("heading", { name: "承認可", exact: true })).toBeVisible();
      await expect(result).toContainText("資金余力");
      await expect(result).toContainText("今回振替額");
      await expect(result).toContainText(currency === "JPY" ? "90,000" : "$900.00");
      await expect(result).toContainText(currency === "JPY" ? "30,000" : "$300.00");
      await expect(result).not.toContainText("通常予算が未登録");
      await expect(result).not.toContainText("MF予算残額");
      const s = await page.evaluate(async () => {
        const { apiFetch } = await import("/src/lib/api.ts");
        return apiFetch("/api/spending");
      });
      expect(s.ledger.requests[0].status).toBe("approved");
      expect(s.ledger.requests[0].fundingLinks).toHaveLength(1);
      expect(s.requestStates[s.ledger.requests[0].id].funding[0].state).toBe("scheduled");
      expect(s.ledger.imports).toEqual([]);
      expect(s.ledger.budgetProposals).toEqual([]);
      await page.getByRole("button", { name: "根拠を見る", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText("通常予算・MF履歴は参考情報");
      await page.getByRole("dialog").getByRole("button", { name: "閉じる", exact: true }).click();
      await page.getByRole("button", { name: "履歴を見る", exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText("通常予算が未登録");
      await page.getByRole("dialog").getByRole("button", { name: "閉じる", exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath(`supplemental-${currency}.png`), fullPage: true });
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
}
