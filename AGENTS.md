# AGENTS.md

## Project overview

個人資産管理ツール「sui」。予測残高・固定収支・クレジットカード請求・ローン返済を管理するフルスタックアプリケーション。

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
