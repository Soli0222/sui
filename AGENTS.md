# AGENTS.md

## Project overview

個人資産管理ツール「sui」。予測残高、固定収支、クレジットカード請求、ローン返済、割り勘を管理するフルスタックアプリケーション。

## Documentation

設計の理由と規則の詳細は `docs/`（Open Knowledge Format v0.2 のナレッジバンドル）にある。
既存の挙動を推測で実装し直す前に、該当する概念ドキュメントを読むこと。

| 参照先 | 内容 |
|--------|------|
| `docs/index.md` | バンドルの入口。設計前提の要約 |
| `docs/concepts/` | 可処分残高、残高照合、予測イベント、カード請求、ローン、サブスク、割り勘、営業日シフト、複数通貨 |
| `docs/architecture/` | パッケージ構成、予測パイプライン、認証、MCP、可観測性 |
| `docs/operations/` | 開発、環境変数、リリース |
| `docs/references/api-endpoints.md` | 全 API エンドポイント |

ドメインの規則を変更したら、対応する `docs/` のドキュメントも更新する。
concept document の意味を変更したら、`generated` を実際の生成者と変更日時に更新する。
`verified` は実際の verification event があった場合だけ追加する。
concept document の新規作成・更新後は OKF v0.2 validator で確認する。

## Design assumptions

- 認証は SPA で外部 IdP の OIDC、API / MCP は UI 発行の API トークン（`Authorization: Bearer sui_tok_...`）を使う。アプリ内に ID/PW は持たない。リバースプロキシの mTLS は追加の防御層として併用可能。`SUI_AUTH_MODE=disabled` は信頼境界内限定の escape hatch として利用可能。
- 残高予測は固定収支、クレジットカード請求、ローン返済を対象にする。サブスクは多くがクレカ請求に含まれるため、forecast に直接統合しない（二重計上防止）。このアプリの主対象はクレカ以外の口座残高。
- 予定日超過の予測イベントも自動確定しない。予定額と実績額が一致するとは限らないため、UI/MCP いずれでも人間の確認後に手動確定する。
- 口座残高の直接編集は将来的に塞ぐ方向。ただし使途不明金の調整は必要であり、adjustment 取引または照合(reconcile)フローとして設計課題にしている。
- 割り勘、債権（立替分の未回収額）は残高予測に含めない。立替支出は既に実取引として残高に反映されており、回収も income 実取引として反映されるため、債権はその「間」を可視化するメタデータである。
- 金額は通貨の最小単位の整数で保持し、集計は JPY 換算後に行う。int32 を超える値は 400 で拒否する。

## Tech stack

- **Monorepo**: pnpm workspace
- **Backend**: Hono + Prisma (PostgreSQL 18)（MCP エンドポイント `/mcp` も内包）
- **Frontend**: React + Vite + Recharts + Tailwind CSS
- **MCP**: Model Context Protocol server (@modelcontextprotocol/sdk), backend `/mcp` として動作
- **Shared**: 型定義、定数、日付とスケジュール計算 (`@sui/shared`)
- **DB**: Prisma schema (`@sui/db`)
- **Observability**: OpenTelemetry（OTLP 未設定時は計装を起動しない）, pino, `audit_logs` テーブル
- **E2E**: Playwright
- **Test**: Vitest

## Testing rules

**テストは必ず Makefile 経由で実行すること。** pnpm コマンドを直接実行してはならない。

| 種別 | コマンド |
|------|----------|
| ユニットテスト | `make test-unit` |
| インテグレーションテスト | `make test-integration` |
| E2Eテスト | `make test-e2e` |
| Lint | `make lint` |
| 型チェック | `make typecheck` |
| ビルド | `make build` |

`make test-integration`、`make test-e2e`、`make test-performance` は `scripts/run-isolated-test.mjs` 経由で実行される。ランナーは test DB 起動、Prisma 生成・マイグレーション、テスト実行、終了時の DB 停止まで行う。手動で DB を操作する必要はない。

並列実行には自動的に slot が割り当てられる。固定 slot を使いたい場合は `SUI_TEST_SLOT=n`（0〜9）を設定する。テスト中に `SIGINT`/`SIGTERM` を送っても、当該 slot の Docker Compose project のみ停止して解放される。

slot ロックは TCP ポートの `bind(2)` によって排他的に確保される。ポートを確保した所有者のみが `$TMPDIR/sui-test-locks/sui-test-slot-<n>.lock/lock.json` を作成・削除できる。`lock.json` には確認用のオーナートークンと pid が書き込まれ、正常終了時の `release()` は TCP リースを保持したまま先にこのメタデータを削除し、最後に自分が `listen` しているサーバーを `close` する。所有者プロセスが死ねば TCP ポートが自動的に解放されるため、次回の取得で安全に再取得できる。クラッシュ等で `lock.json` が残っていても、次の所有者は TCP リース取得後にその古いメタデータを上書きする。他の所有者の lock パスを手動で削除する必要はない。

テストランナーは DB 起動前に `docker compose -p sui-test-<slot> ... down --volumes --remove-orphans` を実行し、テスト終了時にも同じ project 名で `down` する。グローバルなポート検索や他の slot の停止は行わない。特定 slot を手動でクリーンアップする場合は `SUI_TEST_SLOT=<n> make test-db-down` を使う。

テストランナーは `.env` の設定を変更しない。固有のポートや project 名は環境変数（`SUI_TEST_SLOT`、`SUI_TEST_PG_PORT`、`SUI_TEST_COMPOSE_PROJECT`、`SUI_E2E_*` など）で渡される。

## Local environment

`compose.yaml` のアプリが起動していると 3000 番を占有しており、`pnpm dev` の backend は起動に失敗する（EADDRINUSE）。
この状態で `scripts/seed.sh` や `curl localhost:3000` を実行すると、リクエストは稼働中のアプリと、その本番用 DB に届く。

データを投入する前に、接続先が意図した DB であることを確認する。

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN   # 誰が 3000 を持っているか
curl -s localhost:3000/api/accounts # 空 DB なら []
```

破壊的な操作（seed、import、delete）の前には `GET /api/export` で退避する。

## Code conventions

- 共有型は `packages/shared/src/types/` に定義する
- API レスポンス型は `api.ts`、ドメインモデルは `domain.ts`
- 日付とスケジュールの計算は `@sui/shared` に置く（フロントとバックで同じ規則を使うため）
- バックエンドのビジネスロジックは `packages/backend/src/services/` に配置
- ルートハンドラは zod での検証と入出力の整形に留める
- テストヘルパーは `packages/backend/src/test-helpers/` にある
- 論理削除（`deletedAt`）を使うモデルでは、一覧取得で `deletedAt: null` を必ず条件に入れる

## Key files

| ファイル | 役割 |
|----------|------|
| `packages/backend/src/services/forecast-core.ts` | 残高予測の中核。DB アクセスを持たない純粋関数 |
| `packages/backend/src/services/forecast-core.test.ts` | 予測の仕様がここに集まっている。挙動を変える前に読む |
| `packages/backend/src/app.ts` | ミドルウェアの並び（トレース → 認証 → Origin ガード → 監査ログ → 為替更新） |
| `packages/backend/src/middleware/auth.ts` | セッションと API トークンの検証、読み取り専用の強制 |
| `packages/db/prisma/schema.prisma` | データモデル |
| `scripts/run-isolated-test.mjs` | スロット割り当て、DB 起動、テスト実行、停止を行うランナー |
| `scripts/test-isolation/resources.mjs` | slot に応じたポート・project 名計算とロック取得 |
| `scripts/test-isolation/docker-db.mjs` | 固定 slot 用の DB 起動/停止スクリプト |
| `playwright.config.ts` | E2E サーバー URL、ポート、成果物パスを環境変数で決定 |
