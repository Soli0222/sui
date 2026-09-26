---
type: Playbook
title: テスト責任と E2E 時計の監査
description: Issue #675 のテスト整理、業務時計の契約、検証結果。
tags: [development, testing, e2e]
generated: { by: codex/gpt-6, at: 2026-09-26T08:22:43Z }
---

# 通常 E2E の時計契約

通常 E2E の業務上の現在時刻は `2026-06-15T03:00:00.000Z`（日本時間の正午）とする。
年を更新する運用はしない。隔離ランナーが Playwright プロセスへ日時と Node preload を渡し、worker の API と mock IdP、DB seed のプロセスもそれを継承する。
共通 fixture は新しい browser page とログイン用 page に同じ時刻を設定する。
`scenario.ts` はこの定数から対象月、予定日、履歴日を生成し、spec はホストの実時計を読まない。

タイマーと `performance.now()` は実時間のまま動かす。Cookie の `Max-Age` とブラウザの Cookie 期限判定も実時間で進むため、認証フローは従来どおり有効期限付き Cookie を使用する。
API のセッション判定と mock IdP の発行日時は同じ固定業務時計を使う。
PostgreSQL の `CURRENT_TIMESTAMP` は実時間のままであり、業務上の期間判定に作成日時を使う seed では明示する。
DB 管理、Docker、ビルド、隔離ランナー自身には preload を適用しない。

# テスト責任

| 層 | 残す検証 |
| --- | --- |
| 単体 | 月計算、仮定額の包含と隙間、小数から最小通貨単位への変換などの条件と境界値 |
| API 結合 | HTTP 入力、永続化、権限、二重確定と競合、MCP 契約 |
| UI コンポーネント | 入力途中、未保存状態、エラーからの回復 |
| E2E | 実ブラウザでの接続、保存結果の画面反映、画面遷移、フォーカス、スクロール、レイアウト |

# 棚卸しと判断

開始時の commit は `c92330f2f19e14f601eda8c939ea7013df692317`。27 E2E ファイル、25 API/DB 結合ファイル、50 単体・コンポーネントファイル、4 scripts テストファイルを確認した。
次の表は全 E2E ファイルの主な故障点と判断である。同じ機能の単体・結合検証があっても、ブラウザ固有の故障を検出するものは維持した。

| E2E ファイル | 検出する故障と判断 |
| --- | --- |
| `accounts.spec.ts` | 口座フォーム、残高照合の画面分離、調整取引への反映、通貨表示、レイアウトを維持。金額計算と永続化は単体・APIで担当。 |
| `auth-flow.spec.ts`, `auth-lifecycle.spec.ts`, `auth.spec.ts` | IdP 遷移、拒否、ログアウト、401 後の遷移、UIでのトークン管理を維持。期限と権限は API 結合でも担当。 |
| `credit-cards.spec.ts` | カードと請求のフォーム配線、保存表示、未保存状態、キーボード、レイアウトを維持。年越し・うるう年の月送り計算だけ軽い層に集約。 |
| `dashboard.spec.ts` | 集計・予測の画面表示、確定操作、チャート、レスポンシブ表示を維持。計算条件は予測コアと APIで担当。 |
| `data-management.spec.ts` | ブラウザのダウンロード、importプレビューと確認を維持。JSON契約と置換の整合性はAPIで担当。 |
| `editing-scroll.spec.ts`, `editing-ui.spec.ts` | 深い行のスクロール、フォーカス、モーダルの配置、未保存の遷移防止を維持。後者の画像生成ケースは通常skip。 |
| `furusato.spec.ts` | 寄付フォームから年別表示とシミュレーションへの反映を維持。税額計算は単体、保存はAPIで担当。 |
| `isolation.spec.ts` | workerを止めた後の別workerのDBとセッション独立性を維持。 |
| `loans.spec.ts` | 通常・途中開始フォーム、プレビュー、編集と削除を維持。返済計算は単体、保存はAPIで担当。 |
| `navigation.spec.ts`, `pwa.spec.ts` | 実ブラウザの直URL、戻り先、オフライン再読込を維持。 |
| `recurring.spec.ts` | 収支・振替の各フォーム配線、金額履歴、未保存変更、画面反映を維持。日付・シフトの計算は共有/単体で担当。 |
| `responsive.spec.ts` | 各画面の横はみ出し、カードの可読性、モバイルナビゲーションを維持。対象レコードの表示assertがある。 |
| `salaries.spec.ts` | 給与編集と直接URL、年別表示、保存失敗からの復帰を維持。 |
| `scenarios/confirm-flow.spec.ts` | 確定後の残高と取引への反映、外貨入力から保存までを維持。入力途中の値はコンポーネント層で担当。 |
| `scenarios/credit-card-flow.spec.ts` | 請求保存後のダッシュボード反映と旧カード実額の表示を維持。二期間の金額選択の網羅は共有関数とAPIに集約。 |
| `scenarios/forecast-flow.spec.ts`, `scenarios/loan-flow.spec.ts`, `scenarios/transfer-flow.spec.ts` | 作成→予測→確定→残高/取引の画面間配線を維持。予測算術は単体で担当。 |
| `settings.spec.ts` | UIの未保存状態、再読込後の適用、失敗からの復帰を維持。設定の保存契約はAPIで担当。 |
| `spending-removal.spec.ts` | 廃止したUIが再出現せず、残る機能に到達できることを維持。 |
| `splits.spec.ts` | 割り勘の配分入力、部分精算の再表示、モバイルレイアウトを維持。債権と残高の整合性はAPIで担当。 |
| `subscriptions.spec.ts` | フォーム配線、月別表示、編集とアーカイブのブラウザ操作を維持。発生日・金額履歴の計算は単体で担当。 |
| `transactions.spec.ts` | 手入力、編集、取引一覧の絞り込みとページ操作を維持。残高更新と競合はAPIで担当。 |

関連する軽い層も全ファイルを確認した。`packages/shared/src/lib/{amount-history,billings,schedule}.test.ts` は期間・日付・金額選択を担当する。フロントの24ファイルは `components/`（入力、編集面、帳票、一覧）、`hooks/`（下書き、検証、取得）、`lib/`（月送り、書式、チャート）、`routes/`（画面状態）の単体/コンポーネント検証を担当する。バックエンドの23単体ファイルは `lib/`（営業日、日付、HTTP、OAuth）、`services/`（予測、カード仮定額、ローン、割り勘、サブスク、監査）、`mcp/`（契約、パリティ、入力）と計装を担当する。

25結合ファイルは `routes/` の `accounts`, `audit-logs`, `auth`, `billings`, `cors`, `credit-cards`, `dashboard`, `data-transfer`, `donations`, `furusato`, `ledger-concurrency`, `loans`, `mcp`, `people`, `recurring-items`, `salary-records`, `security-headers`, `settings`, `settlements`, `spending-removal`, `subscriptions`, `transactions`、`services/audit-cleanup`、`mcp/__tests__/{parity,business-parity}` である。保存、削除済み除外、権限、export/import、MCP/API契約、台帳の競合更新はDB/HTTPでしか検出できないため維持する。
scripts の `resources`, `runner`, `version-input`, `eslint/no-fixed-e2e-date` も確認した。追加した `e2e-clock` はランナー、preload、シナリオの時計契約を検証する。

## 削除・移動の対応

| 旧ケースまたは検証 | 残す検証 | 理由 |
| --- | --- | --- |
| `e2e/scenarios/credit-card-flow.spec.ts` の `uses two different assumption amounts for one card` | `packages/shared/src/lib/billings.test.ts` の `selects each period's amount by inclusive billing month and leaves gaps at zero`、`packages/backend/src/routes/billings.integration.test.ts` の `uses different amounts for consecutive periods on the same card`、E2E の `reflects saved credit card billing amounts on the dashboard forecast` | 期間ごとの選択とHTTP永続化は既存の軽い層が検証する。ダッシュボードへの接続は別のE2Eが検証する。 |
| `e2e/credit-cards.spec.ts` の前月/次月ケース内の年越し・うるう年操作 | `packages/frontend/src/lib/dates.test.ts` の `addMonthsToYearMonth` 3ケース。同じE2Eの前月/次月ボタン操作を維持 | 計算境界値は単体で検出し、E2Eはボタンから月表示更新の配線を検出する。 |
| `e2e/scenarios/confirm-flow.spec.ts` の外貨ケース内の EUR 下書き、`1`→`1.`→`1.2`→`1.23` 入力、`inputmode` と `data-1p-ignore` 属性確認 | `packages/frontend/src/components/ui/money-input.test.tsx` の入力途中・通貨切替・属性、`packages/frontend/src/routes/dashboard-confirmation.test.ts` の小数→最小通貨単位、同じE2EのUSD保存・残高・取引表示 | 入力状態と属性はコンポーネントで検出する。E2Eは実ブラウザの確定操作から口座残高までの接続を検出する。 |
| `e2e/subscriptions.spec.ts` の3ケースでブラウザだけ別日に固定する処理 | `e2e/helpers/test.ts` の共通時計と `scenario.ts` の対象月を使用。同じE2Eの月送り、週次の5件表示、終了済みから復帰を維持 | API・seed・ブラウザの業務日付のずれを解消する。 |

`credit-cards.spec.ts` の未登録と保存済み0、未保存請求額の確認/取消、旧カードの実額、低い実額に対する仮定値バッジはUI固有の表示差があるため維持した。`editing-ui`、`editing-scroll`、`responsive` と機能別E2Eでは、共通モーダルのフォーカス/位置と個別フォーム送信の故障点が異なる。MCPの契約、認証、削除済みレコード、import/export、台帳の競合更新も下の層の固有の責任として維持した。

## 新しい E2E の最小例

```ts
import { expect, test } from "./helpers/test";
import { seedAccount, seedCreditCard } from "./helpers/db";
import { getYearMonth } from "./helpers/scenario";

test("カードを対象月の一覧に表示する", async ({ page }) => {
  const account = await seedAccount({ name: "引落口座" });
  await seedCreditCard({ name: "表示対象", accountId: account.id });
  await page.goto("/credit-cards");
  const row = page.getByRole("button", { name: "表示対象を編集" });
  await expect(row).toBeVisible();
  await expect(page.locator('input[type="month"]')).toHaveValue(getYearMonth());
});
```

実際に追加する際は、保存と表示の接続が既存ケースで足りるか先に確認する。

# 検証と計測

変更前は [main の CI 実行](https://github.com/Soli0222/sui/actions/runs/36228293735)（`c92330f`, 2026-09-26、Linux runner、Chromium、4 worker）をベースラインとした。通常E2Eは展開後156件で、154成功、1 skip、1 flaky（retryで成功）、テスト本体3.1分。追加3条件は各156件で各1 skip、retryなし、テスト本体は月末2.9分、年末2.8分、年始2.2分だった。CI全体では624件の宣言されたE2Eを実行し、通常ジョブのretryを別に1回行った。通常E2Eジョブの準備を含む経過時間は3分57秒。各ジョブは並列実行されていたため、これらの時間を足してCI全体の所要時間とはしない。

変更後のローカル通常E2Eは展開後155件で、154成功、1 skip、retry 0、テスト本体1.2分（macOS、Chromium、4 worker、業務基準日固定）。CI全体の宣言されたE2Eは155件になる。`make lint`、`make typecheck`、`make test-unit`（単体530件と scripts 48件）、`make test-integration`（310件）、通常の `make test-e2e` が成功した。OKF v0.2 validator も0 error、0 warningだった。

変更前後の実行時間はCI Linuxとローカル macOSで環境が異なるため、速度差と解釈しない。変更後CIジョブが完了したら、同じLinux runnerでの準備込みとテスト本体の時間を比較できる。
