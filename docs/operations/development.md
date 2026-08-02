---
type: Playbook
title: 開発の進め方
description: セットアップ、シードデータの段階投入、Makefile 経由でのテスト実行という規約。
tags: [development, testing, setup]
timestamp: 2026-07-26T00:00:00+09:00
---

# セットアップ

Node.js 24 以上、pnpm 10 以上、Docker が要る。

```bash
pnpm install
docker compose -f compose_db.yaml up -d --wait
pnpm --filter @sui/db db:generate
pnpm --filter @sui/db prisma:migrate
pnpm dev
```

フロントエンドは 5173、バックエンドは 3000 で立つ。
開発サーバーは `/api` へのリクエストをバックエンドにプロキシする。

## テスト用 DB

テスト用 DB は `compose_db.yaml` で起動し、`sui-test` という専用 Docker network に接続する。
これにより、ローカル動作確認用 `compose.yaml` の `db` / `app` とネットワークが分離され、`make test-db-up` / `make test-db-down` や `make test-integration` / `make test-e2e` の停止処理がローカル環境に干渉しない。

# シードデータ

`scripts/seed.sh` はフェーズごとに投入する。

- `phase1`（既定）：不足の起きない基本データ。サブスク台帳のサンプルも含む。
- `phase2`：オフセット不足だけが起きる追加データ。
- `phase3`：実残高マイナスが起きる追加データ。
- `all`：`phase1` から順に全部。

`phase2` と `phase3` は追加投入用である。
段階を確認するなら `phase1` の後に順に流す。
警告レベルの `yellow` と `red` の違いは、この二つのフェーズで再現できる（[可処分残高とオフセット](../concepts/disposable-balance.md)）。

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
手で DB を触る必要はない。
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
