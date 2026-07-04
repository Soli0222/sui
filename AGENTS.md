# AGENTS.md

## Project overview

個人資産管理ツール「sui」。予測残高・固定収支・クレジットカード請求・ローン返済を管理するフルスタックアプリケーション。

## Design assumptions

- 認証はリバースプロキシの mTLS で担保する前提。アプリ内認証を実装しないのは意図的。サーバーサイド MCP をリモート公開する場合は inbound 認証を別途設計する。
- 残高予測は固定収支・クレジットカード請求・ローン返済を対象にする。サブスクは多くがクレカ請求に含まれるため、forecast に直接統合しない（二重計上防止）。このアプリの主対象はクレカ以外の口座残高。
- 予定日超過の予測イベントも自動確定しない。予定額と実績額が一致するとは限らないため、UI/MCP いずれでも人間の確認後に手動確定する。
- 口座残高の直接編集は将来的に塞ぐ方向。ただし使途不明金の調整は必要であり、adjustment 取引または照合(reconcile)フローとして設計課題にしている。

## Tech stack

- **Monorepo**: pnpm workspace
- **Backend**: Hono + Prisma (PostgreSQL)
- **Frontend**: React + Vite + Recharts + Tailwind CSS
- **MCP**: Model Context Protocol server (@modelcontextprotocol/sdk)
- **Shared**: 型定義・定数 (`@sui/shared`)
- **DB**: Prisma schema (`@sui/db`)
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

`make test-integration` と `make test-e2e` は内部で自動的に test-db-down → test-db-up → テスト実行 → test-db-down を行う。手動で DB を操作する必要はない。

## Code conventions

- 共有型は `packages/shared/src/types/` に定義する
- API レスポンス型は `api.ts`、ドメインモデルは `domain.ts`
- バックエンドのビジネスロジックは `packages/backend/src/services/` に配置
- テストヘルパーは `packages/backend/src/test-helpers/` にある
