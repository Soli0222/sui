---
type: Playbook
title: 開発の進め方
description: セットアップ、シードデータの段階投入、Makefile 経由でのテスト実行という規約。
tags: [development, testing, setup]
generated: { by: codex/gpt-6, at: 2026-09-06T10:18:54+00:00 }
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

テストランナーは、`SUI_TEST_SLOT` から `DATABASE_URL`、`PORT`、`VITE_API_BASE`、`SUI_TEST_COMPOSE_PROJECT` などを自動導出する。
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

- 単体：`packages/*/src/**/*.test.ts`。予測の中核はここで検証する。DB を使わない。
- 結合：`packages/backend/src/routes/*.integration.test.ts`。実際の PostgreSQL に対して HTTP レベルで叩く。
- E2E：`e2e/`。Playwright でブラウザから操作する。

予測の規則を変えるときは、まず `forecast-core.test.ts` を見る。
生成、シフト、確定、通貨換算の組み合わせがここに集まっている。

# 関連

- [パッケージ構成](../architecture/package-layout.md)
- [設定と環境変数](./configuration.md)
- [リリース](./release.md)
