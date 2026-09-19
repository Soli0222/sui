---
type: Playbook
title: 開発の進め方
description: セットアップ、シードデータの段階投入、Makefile 経由でのテスト実行という規約。
tags: [development, testing, setup]
generated: { by: codex/gpt-6, at: 2026-09-19T12:23:03+00:00 }
---

# セットアップ

Node.js 24 以上、pnpm 10 以上、Docker が要る。

```bash
pnpm install
export SUI_TEST_SLOT=0
export DATABASE_URL="postgresql://sui_test:sui_test@localhost:$((5555 + SUI_TEST_SLOT))/sui_test"
export PORT=$((3100 + SUI_TEST_SLOT * 10))
export VITE_API_BASE="http://localhost:${PORT}"
node scripts/test-isolation/docker-db.mjs up
pnpm --filter @sui/db db:generate
pnpm --filter @sui/db prisma:migrate
pnpm dev
```

この例では slot 0 を使うので、フロントエンドは 5173、バックエンドは 3100 で立つ。
`DATABASE_URL` は slot から導出するポートと一致させる必要がある。
開発サーバーは `/api` へのリクエストをバックエンドにプロキシする。

## テスト用 DB

テスト用 DB は `compose_db.yaml` で起動し、slot ごとに独立した Docker Compose project network に接続する。
`scripts/run-isolated-test.mjs` が slot を自動的に割り当てるので、ポート・ネットワーク名が重ならず並列実行できる。

これにより、ローカル動作確認用 `compose.yaml` の `db` / `app` とネットワークが分離され、`make test-db-up` / `make test-db-down` や `make test-integration` / `make test-e2e` の停止処理がローカル環境に干渉しない。

固定 slot を使いたい場合は `SUI_TEST_SLOT` を指定する（0 以上 9 以下）。

```bash
SUI_TEST_SLOT=2 make test-integration
```

テストランナーは、`SUI_TEST_SLOT` から `DATABASE_URL`、`SUI_TEST_COMPOSE_PROJECT` などを自動導出する。
テスト外で手動で DB を触る必要はない。

並列実行時は、既存の slot ロックが使われていれば自動的に待ち、ロック所有者のプロセスが死んでいれば TCP ポートが解放されるため安全に再取得する。
各 slot は TCP ポートの bind によって排他的に確保される。`lock.json` は TCP リースを保持している間だけ存在する確認用メタデータであり、正常終了時の `release()` は TCP リース中にこのメタデータを削除した後、自分の `listen` サーバーを `close` する。`docker compose -p sui-test-<slot>` だけを操作する。

### 特定 slot の状態を確認する

```bash
# その slot の Docker Compose project のみ確認
SUI_TEST_SLOT=2 node scripts/test-isolation/docker-db.mjs ps

# slot を保持している間だけ lock.json が存在する（release 後は削除される）
SUI_TEST_LOCK_DIR=${SUI_TEST_LOCK_DIR:-$TMPDIR/sui-test-locks}
ls "${SUI_TEST_LOCK_DIR}/sui-test-slot-2.lock"
cat "${SUI_TEST_LOCK_DIR}/sui-test-slot-2.lock/lock.json"
```

### 特定 slot だけクリーンアップする

```bash
SUI_TEST_SLOT=2 make test-db-down
# または
SUI_TEST_SLOT=2 node scripts/test-isolation/docker-db.mjs down
```

これは `docker compose -p sui-test-2 -f compose_db.yaml down --volumes --remove-orphans` を実行するだけで、他の slot やローカルの `compose.yaml` には触れない。

### 禁止事項

- **グローバルな公開ポート検索**（`docker ps`、`lsof` でのポート探し、ホストポートベースの停止）は使わない。
- **プロジェクト名なしの `docker compose down`**（`-p` なし、またはカレントディレクトリの `compose.yaml` を使った停止）を他の slot やローカル環境に対して行わない。
- 他の slot のロックディレクトリや Docker コンテナを手動で削除・強制終了しない。
- `kill -9` などで他の slot のテストプロセスを止めない。

これらを守らないと、並列実行中の他のテストを壊したり、ロックの整合性を損なったりする。

### ハードクラッシュ後の復旧

テストプロセスが `SIGKILL` などで途中で死んだ場合でも、次回の `make test-*` または `make test-db-down` で同じ slot を取得するときに以下が行われる。

1. `acquireSlot` は TCP ポートを確保した後、クラッシュなどで残っている古い `lock.json`（およびディレクトリ）を削除してから、新しいオーナーメタデータを作成する。
2. `run-isolated-test.mjs` は DB 起動前に `docker compose -p sui-test-<slot> ... down --volumes --remove-orphans` を実行する。
3. テスト終了時に同じ project 名で `down` し、slot ロックを解放する。

手動で介入する必要はない。

# シードデータ

`scripts/seed.sh` はフェーズごとに投入する。

- `phase1`（既定）：不足の起きない基本データ。サブスク台帳と支出決裁の準備データも含む。
- `phase2`：オフセット不足だけが起きる追加データ。
- `phase3`：実残高マイナスが起きる追加データ。
- `spending`：支出決裁の準備データだけを追加する。申請は作らない。
- `all`：`phase1` から順に全部。

`phase2` と `phase3` は追加投入用である。
段階を確認するなら `phase1` の後に順に流す。
警告レベルの `yellow` と `red` の違いは、この二つのフェーズで再現できる（[可処分残高とオフセット](../concepts/disposable-balance.md)）。

## 支出決裁を手で試す

既存のローカルテスト環境へ支出決裁だけ追加する場合は、次を実行する。
実行前に指定したURLがローカルテスト環境を指していることを確認する。

```bash
bash scripts/seed.sh spending http://localhost:3000
```

各フェーズは最初に`GET /api/export`で指定先を退避する。
バックアップと生成CSVの保存先は実行結果に表示する。
保存先は一時ディレクトリなので、継続して使うCSVは別の場所へコピーする。
認証を有効にしたテスト環境では、更新可能なAPIトークンを`SUI_SEED_API_TOKEN`で渡す。

支出決裁用seedは次を用意する。

- 実行日の直近3か月と当月の、MF形式のUTF-8 CSV。明細は完全な架空データで、利用者提供CSVは参照しない。
- 食費45,000円・趣味・娯楽25,000円・通信費8,000円の期間付き月額予算。
- 決裁閾値10,000円・更新目安7日・承認期限14日・資金確認期間30日のテスト設定。既に入力済みの設定値は保持する。
- MF支出実績、振替・集計対象外・収入の明細、口座・カードとの対応付け。
- テスト専用の補正予算口座（残高240,000円、保護額40,000円）、支払口座、カード。

CSVは通常のプレビュー・確定APIから取り込む。同じファイルの再取込も試せる。
申請・購入記録・配賦・振替予定は作らず、通常申請と補正申請をUIで作成する。
当日の「架空ショップ 購入比較用」6,000円の明細は、MF実績と購入申請が独立していることの確認に使える。
手順はCSVと同じディレクトリの`README.txt`にも出力する。
AI接続とAPIキーは既存設定を保持する。未設定の場合は決裁設定画面で入力する。
AIを呼ぶ審査はseed中に実行しない。

既に予算・明細・申請などの支出決裁データがある場合、`spending`は何も変更せずスキップする。
他のフェーズ全体の再投入を冪等にするものではない。

# テストは Makefile 経由で実行する

pnpm のテストコマンドを直接叩かない。

| 種別 | コマンド |
|------|----------|
| Lint | `make lint` |
| 型チェック | `make typecheck` |
| 単体テスト | `make test-unit` |
| 結合テスト | `make test-integration` |
| E2E テスト | `make test-e2e` |
| パフォーマンス計測 | `make test-performance` |
| ビルド | `make build` |

`test-integration`、`test-e2e`、`test-performance` は、テスト用 DB の停止、起動、マイグレーション、テスト、停止までを内部で行う。
テストランナーはスロットベースでリソース（PostgreSQL ポート、バックエンド・フロントエンド・mock IdP ポート、Docker Compose project 名）を自動的に割り当てる。
同種または異種のテストを同時に走らせてもポートや DB が衝突しない。

`make test-db-up` / `make test-db-down` は `SUI_TEST_SLOT` を必須とする。slot を指定しないとエラーになる。

直接 pnpm を叩くと、前のテストが残した DB の状態を引き継いだまま走ることになる。

CI と同じジョブを手元で回したいときは `act-` 接頭辞の付いたターゲットを使う。
`make act-all` は全ジョブを順に実行する。

# テストの層

## E2E の並列実行

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

## 日付依存の再発防止

予定日や終了日を固定値にすると、その日を過ぎてからE2Eが失敗する。
期間で絞る一覧では、データが表示範囲から外れても、空の画面を検証して成功する場合がある。
通常のE2Eでは `e2e/helpers/scenario.ts` の相対日付を使い、一覧の検証では対象データの表示もassertする。
データ作成ヘルパーの既定値も実行日を基準にする。

`make lint` の `sui/no-fixed-e2e-date` は、E2Eとヘルパーにある日付・年月のリテラルを検出する。
文字列、テンプレート、正規表現、数値を直接渡す `new Date` / `Date.UTC` が対象である。
日付を文字列の連結で組み立てるなど、すべての書き方を解析するものではない。
固定値が必要なのは、時計を固定した検証、うるう年などの境界値、表示期間外の履歴を意図的に作る場合である。
その行だけ `eslint-disable-next-line sui/no-fixed-e2e-date -- 理由` で許可し、ファイル全体は除外しない。
単体・結合テストの固定日付は、基準日を引数で渡すか時計を固定したうえで使う。

E2Eの `test` は `e2e/helpers/test.ts` からimportする。
このfixtureが、ランナーで指定した時計をブラウザに反映する。
CIは実時計に加え、次の3条件で全E2Eを実行する。

```bash
SUI_E2E_CALENDAR=month-end make test-e2e
SUI_E2E_CALENDAR=year-end make test-e2e
SUI_E2E_CALENDAR=new-year make test-e2e
```

日付は実行時の日本時間の年から求め、翌年の2月末、12月31日、翌々年の1月1日の正午にする。
テストプロセス、データ作成ヘルパー、API、mock IdPにはテスト専用のNode preloadを適用し、ブラウザにはPlaywrightの時計設定を適用する。
`Date` だけを固定し、タイマーは実時間で動かす。
本番コードに時計を変更する設定は追加しない。

DBの `CURRENT_TIMESTAMP` とブラウザ自身のCookie期限判定は変わらない。
Cookieが実時計で失効しないよう、カレンダー検証には未来日を選ぶ。
DBの作成日時などを検証条件に使う場合は、日時を明示してこの差を排除する。
個別テストでブラウザだけ時計を固定する場合は、日付の判定がブラウザ内で完結することを確認する。

## 単体・結合・E2E

- 単体：`packages/*/src/**/*.test.ts`。予測の中核はここで検証する。DB を使わない。
- 結合：`packages/backend/src/routes/*.integration.test.ts`。実際の PostgreSQL に対して HTTP レベルで叩く。
- E2E：`e2e/`。Playwright でブラウザから操作する。

予測の規則を変えるときは、まず `forecast-core.test.ts` を見る。
生成、シフト、確定、通貨換算の組み合わせがここに集まっている。

# 関連

- [パッケージ構成](../architecture/package-layout.md)
- [設定と環境変数](./configuration.md)
- [リリース](./release.md)

# CIの権限と依存更新

PRコードを実行するCIには `contents: read` だけを与える。
パフォーマンス比較表は実行サマリーとartifactに保存する。
コメント投稿はdefault branchの `workflow_run` で実行し、実行結果とPRの現在のhead SHAを照合する。
この処理はPRコードのcheckout、依存のインストール、artifactのダウンロード・実行を行わない。
コメントはGitHubの実行メタデータから作る比較表へのリンクだけとする。

ActionはコミットSHA、Dockerfile・Compose・Renovate実行イメージはdigestで固定する。
RenovateのGitHub Appトークンはこのリポジトリだけを対象とする。
依存更新はnpm以外もリリースから3日待ち、日時が取得できない更新は保留する。
日時を確認できない種類の更新と、Action・コンテナ更新は自動マージせずレビューを求める。
待機期間が適用できない更新種類があるため、固定値更新を無条件に自動マージしてはならない。
詳細は [Renovateのminimum release age](https://docs.renovatebot.com/key-concepts/minimum-release-age/) を参照。
