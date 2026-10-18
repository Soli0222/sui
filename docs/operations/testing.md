---
type: Playbook
title: テストの書き方
description: 検証層の責任、実行日から作るシナリオと E2E fixture の契約。
sources:
  - resource: ../../e2e/helpers/test.ts
  - resource: ../../e2e/helpers/scenario.ts
  - resource: ../../scripts/run-isolated-test.mjs
generated: { by: codex/gpt-6, at: 2026-10-18T10:40:13Z }
---

# テストの責任分担

| 層 | 残す検証 |
| --- | --- |
| 単体 | 月計算、仮定額の包含と隙間、小数から最小通貨単位への変換などの条件と境界値 |
| API 結合 | HTTP 入力、永続化、権限、二重確定と競合、MCP 契約 |
| UI コンポーネント | 入力途中、未保存状態、エラーからの回復 |
| E2E | 実ブラウザでの接続、保存結果の画面反映、画面遷移、フォーカス、スクロール、レイアウト |

新しいテストを書く前に既存ケースの拡張で足りるか確認する。E2E を追加する PR には実ブラウザが必要な理由を書く。同じ境界値を複数の層で網羅しない。

# 実行日のシナリオ

通常の E2E は、実行日のアプリとして操作・保存・表示を検証する。
6月15日に実行すれば6月15日のデータを、7月15日なら7月15日のデータを用意する。
隔離ランナーが実際の開始日時を `SUI_E2E_STARTED_AT` に記録し、specとseedは `e2e/helpers/scenario.ts` からその日本時間の日付、対象月、対象年を取得する。
この値はテストデータを組み立てるためのスナップショットであり、画面の「今日」の期待値やアプリの時計を変更する設定ではない。
開始日時はログに出力する。

API、mock IdP、Playwright、ブラウザ、DBは実時計で動かす。
`Date` の置換、Node preload、ブラウザの時計操作は通常のE2Eには使わない。
認証の発行日時、セッションとCookieの有効期限、DB日時、タイマーを、それぞれのランタイムが通常どおり扱う。

## 日付のあるデータを作る

`getDate()` は実行日の日本時間の日付、`getDate(7)` は7日後、`getDate(-7)` は7日前を返す。
`getYearMonth(1)` は翌月、`getYear()` は対象年を返す。
これらは実行中に日付をまたいでも変えない。データを作成した日と、フォームを開く日が一致するとは限らない。
フォームの初期日付は、開く直前の実時刻を記録し、`expectCurrentDate` で表示確認時までに観測した日本時間の日付と照合する。
これにより、開始日が6月15日でも6月16日に開いたフォームには6月16日を期待し、開く操作自体が日付をまたいだ場合は前後どちらの日付も許容する。

データの表示を検証するときは、一覧の年・月・期間を明示的に選択する。
給与は対象年のURL、寄付は年の選択、カードは対象年月、サブスクは画面に表示された月からの移動、取引は期間プリセットを使う。
初期表示の期間が実行開始日と同じであることを前提にしない。
現在・将来の価格など実時計で判定されるデータは、月をまたぐ実行でもその関係が保たれるよう期間を設ける。
日付・月の加算は `@sui/shared` のカレンダー計算を使う。
「今日の日にち + 1」や「30日前の月」を、翌日・前月の代わりに使わない。
月末や年末にも、シナリオの意図した関係になるデータを用意する。

予測イベントの表示・確定だけを検証したい場合は、`getOneTimeSchedule()` で翌日の単発予定を作る。
開始日と終了日を同じ日にし、営業日シフトを無効にするため、曜日や月の日数で件数と予定日が変わらない。
定期予定やカード請求の登録を検証する場合は、そのシナリオに必要な開始日・請求月・引き落とし日を明示する。
一覧・レイアウトでは、対象レコードの表示を先にassertする。

月末、年末、うるう年、営業日シフト、期間境界の期待値は、日付を引数で渡す単体テストや、時計を固定するAPI結合テストで検証する。
通常の `make test-e2e` を1回実行し、日付を変えたE2Eの再実行やカレンダー別のCIを追加しない。
E2Eのspecとseedで日付文字列を一律禁止する独自lintは設けない。
固定値を使う場合は、実行日の表示・期間判定と関係なく、その値を使う理由があることを確認する。

E2Eの `test` は、workerごとのDB・API・認証・データ初期化を用意する `e2e/helpers/test.ts` からimportする。

# E2E の並列実行

`make test-e2e` はローカル・CIともに既定で4 workerを使う。
各workerが別々のDB・API・mock IdP・認証セッションを持ち、テスト単位で並列実行する。
CPUやメモリが限られる環境ではworker数を下げる。

```bash
make test-e2e
make test-e2e E2E_WORKERS=1
make test-e2e E2E_WORKERS=4 E2E_ARGS="e2e/accounts.spec.ts"
make test-e2e E2E_ARGS='--grep "edits an account"'
```

`E2E_ARGS`はシェルとして実行せず、引用符付きの引数列としてPlaywrightへ渡す。
同じコマンドでCIの失敗を手元で再現できる。

ランナーは実行全体に一つのslotを確保し、次を準備する。

1. slot専用のPostgreSQLコンテナを起動し、Prisma生成とマイグレーションを一度実行する。
2. フロントを一度ビルドし、実行ごとの`test-results/<runId>/frontend`に置く。
3. 各workerがマイグレーション済みの`sui_test`をテンプレートとして専用DBを複製する。テンプレートDBには接続を残さない。
4. 各workerが実際のbackendエントリーポイントを起動し、静的フロントとAPIを同じoriginで配信する。APIとmock IdPのポートはOSが割り当てる。
5. worker fixtureがログイン状態を用意し、各テストの前にそのworkerの業務データだけを初期化する。

`e2e/helpers/test.ts`のfixtureに初期化を任せ、spec側に共通DBのリセット処理を置かない。
seed helperもfixtureが指定したworker専用DBだけに接続する。
認証そのものを検証するテストは空の`storageState`を指定してログインする。
画面の実装ソースをブラウザへ動的importしてテストデータを作らず、seed helperか認証付きHTTPを使う。

workerの終了時にはAPI・mock IdPとDB helperを停止し、専用DBを削除する。
workerが異常終了した場合も、IPC切断でAPIの子プロセスが終了する。
実行全体の終了・中断時は既存のランナーがslot専用コンテナを破棄する。
APIログは`test-results/<runId>/workers`、失敗時のtraceは同じ実行ディレクトリの`tests`に残る。
複数の`make test-e2e`も別slot・別ビルド出力で同時に実行できる。

# 新しい E2E の最小例

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

# 関連

- [実行コマンド](./development.md)
- [隔離環境の管理と復旧](./test-isolation.md)
- [過去のテスト監査](../archive/test-refactoring-2026-09.md)
