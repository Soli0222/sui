---
type: Playbook
title: テストの書き方
description: 検証層の責任、共通時計と E2E fixture の契約。
sources:
  - resource: ../../e2e/helpers/test.ts
generated: { by: codex/gpt-6, at: 2026-09-26T09:58:58Z }
---

# テストの責任分担

| 層 | 残す検証 |
| --- | --- |
| 単体 | 月計算、仮定額の包含と隙間、小数から最小通貨単位への変換などの条件と境界値 |
| API 結合 | HTTP 入力、永続化、権限、二重確定と競合、MCP 契約 |
| UI コンポーネント | 入力途中、未保存状態、エラーからの回復 |
| E2E | 実ブラウザでの接続、保存結果の画面反映、画面遷移、フォーカス、スクロール、レイアウト |

新しいテストを書く前に既存ケースの拡張で足りるか確認する。E2E を追加する PR には実ブラウザが必要な理由を書く。同じ境界値を複数の層で網羅しない。

# 共通時計

通常 E2E の業務上の現在時刻は `2026-06-15T03:00:00.000Z`（日本時間の正午）とする。
年を更新する運用はしない。隔離ランナーが Playwright プロセスへ日時と Node preload を渡し、worker の API と mock IdP、DB seed のプロセスもそれを継承する。
共通 fixture は新しい browser page とログイン用 page に同じ時刻を設定する。
`scenario.ts` はこの定数から対象月、予定日、履歴日を生成し、spec はホストの実時計を読まない。

タイマーと `performance.now()` は実時間のまま動かす。Cookie の `Max-Age` とブラウザの Cookie 期限判定も実時間で進むため、認証フローは従来どおり有効期限付き Cookie を使用する。
API のセッション判定と mock IdP の発行日時は同じ固定業務時計を使う。
PostgreSQL の `CURRENT_TIMESTAMP` は実時間のままであり、業務上の期間判定に作成日時を使う seed では明示する。
DB 管理、Docker、ビルド、隔離ランナー自身には preload を適用しない。

## 日付に依存するテストを書く

specとseed helperは `e2e/helpers/scenario.ts` から対象月、予定日、履歴日を作り、実時計を読まない。
新しいfixtureやAPIプロセスも同じ時計を継承させる。
期間で絞る一覧では、データが表示範囲から外れても、空の画面を検証して成功する場合がある。
一覧の検証では対象データの表示もassertする。
データ作成ヘルパーの既定値も共通基準日を使う。

`make lint` の `sui/no-fixed-e2e-date` は、E2Eとヘルパーにある日付・年月のリテラルを検出する。
文字列、テンプレート、正規表現、数値を直接渡す `new Date` / `Date.UTC`、引数なし `new Date()` / `Date()`、`Date.now()` が対象である。
日付を文字列の連結で組み立てるなど、すべての書き方を解析するものではない。
固定値が必要なのは、時計を固定した検証、うるう年などの境界値、表示期間外の履歴を意図的に作る場合である。
その行だけ `eslint-disable-next-line sui/no-fixed-e2e-date -- 理由` で許可し、ファイル全体は除外しない。
単体・結合テストの固定日付は、基準日を引数で渡すか時計を固定したうえで使う。

E2E の `test` は `e2e/helpers/test.ts` から import し、本番コードに時計を変更する設定を追加しない。
個別テストでブラウザだけ時計を固定する場合は、日付の判定がブラウザ内で完結することを確認する。
日付境界値は基準日を指定した単体・結合テストに置き、通常E2Eは `make test-e2e` を1回実行する。
日付依存の不具合は時計とデータの前提を修正する。

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
