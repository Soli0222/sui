---
type: Playbook
title: 開発の進め方
description: 開発専用の接続先、シード、Makefile の実行コマンド。
sources:
  - resource: ../../Makefile
generated: { by: codex/gpt-6, at: 2026-09-26T09:58:58Z }
---

# 開発環境を起動する

Node.js、pnpm、Docker Compose を使う。Node.js は [CI](../../.github/workflows/ci.yml)、pnpm は [package.json](../../package.json) の `packageManager` に合わせる。
DB イメージは [compose_db.yaml](../../compose_db.yaml) に定義している。

開発用 DB は `sui-dev` project に置き、自動テストの `sui-test-*` project と分ける。
以下は信頼できるローカル環境で認証を無効にして動作確認する例である。
公開環境では [認証設定](./configuration.md)を行い、`SUI_AUTH_MODE=enabled` を使う。

```bash
pnpm install
SUI_TEST_PG_PORT=5554 docker compose -p sui-dev -f compose_db.yaml up -d --wait
export DATABASE_URL="postgresql://sui_test:sui_test@localhost:5554/sui_test"
export PORT=3020
export VITE_API_BASE="http://localhost:${PORT}"
export SUI_AUTH_MODE=disabled
pnpm --filter @sui/db db:generate
pnpm --filter @sui/db prisma:migrate
pnpm dev
```

フロントエンドは `http://localhost:5173`、API は `http://localhost:3020` で動く。
Vite は `/api` を `VITE_API_BASE` にプロキシする。
`compose.yaml` のアプリは3000番を使うため、開発用 API と区別する。
接続に失敗した場合は、そのまま別のポートに seed を送らず、API の起動ログと `DATABASE_URL` を確認する。

終了時は開発サーバーを止め、開発用 DB だけを停止する。
この DB は tmpfs を使うため、停止・再作成でデータを失ってよい開発データだけを入れる。
残したいデータは停止前に `GET /api/export` で退避する。

```bash
SUI_TEST_PG_PORT=5554 docker compose -p sui-dev -f compose_db.yaml down
```

# シードデータを投入する

投入前に、API の起動ログ、上記の接続設定、`GET /api/accounts` の応答から接続先を確認する。
空 DB を期待する場合の応答は `[]` である。
seed、import、delete の前には `GET /api/export` で退避する。
`scripts/seed.sh` は各フェーズの開始前に退避し、失敗した場合は投入を中止する。
認証を有効にした開発環境では更新可能な API トークンを `SUI_SEED_API_TOKEN` で渡す。

```bash
curl -fsS http://localhost:3020/api/accounts
bash scripts/seed.sh phase1 http://localhost:3020
bash scripts/seed.sh phase2 http://localhost:3020
bash scripts/seed.sh phase3 http://localhost:3020
```

`phase1` は基本データ、`phase2` はオフセット不足、`phase3` は実残高マイナスを再現する追加データである。
`all` は3フェーズを順に投入する。警告の意味は [可処分残高](../concepts/disposable-balance.md) を参照。

# 実行コマンド

pnpm のテストコマンドを直接叩かない。

| 種別 | コマンド |
|------|----------|
| 文書検証 | `make docs-check` |
| Lint | `make lint` |
| 型チェック | `make typecheck` |
| 単体テスト | `make test-unit` |
| 結合テスト | `make test-integration` |
| E2E テスト | `make test-e2e` |
| パフォーマンス計測 | `make test-performance` |
| ビルド | `make build` |

`test-integration`、`test-e2e`、`test-performance` は、テスト用 DB の停止、起動、マイグレーション、テスト、停止までを内部で行う。
テストランナーは slot ごとに PostgreSQL ポートと Docker Compose project を分け、各 worker の API・mock IdP は空きポートで起動する。
同種または異種のテストを同時に走らせてもポートや DB が衝突しない。

固定 slot の操作と復旧は [テスト隔離環境](./test-isolation.md) を参照。

直接 pnpm を叩くと、前のテストが残した DB の状態を引き継いだまま走ることになる。

CI と同じジョブを手元で回したいときは `act-` 接頭辞の付いたターゲットを使う。
`make act-all` は全ジョブを順に実行する。

# 次に読む

- [テストの書き方](./testing.md)
- [文書の保守と検証環境](./documentation.md)
- [CI と依存更新](./ci.md)
- [リリース](./release.md)
