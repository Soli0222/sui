---
type: Architecture
title: パッケージ構成
description: pnpm workspace の四パッケージと、型、業務ロジック、永続化の配置規約。
tags: [monorepo, backend, frontend, structure]
generated: { by: human:soli, at: 2026-07-26T00:00:00+09:00 }
---

# 概要

pnpm workspace で四つのパッケージに分かれる。

| パッケージ | 役割 | 主な技術 |
|------------|------|----------|
| `@sui/frontend` | React SPA | React 18, React Router v6, Recharts, Tailwind CSS, Vite |
| `@sui/backend` | API サーバーと MCP エンドポイント | Hono, tsup |
| `@sui/db` | Prisma スキーマとマイグレーション | Prisma, PostgreSQL 18 |
| `@sui/shared` | 型定義、定数、日付とスケジュールの計算 | TypeScript |

言語は全パッケージ TypeScript で、E2E は Playwright、単体と結合は Vitest である。

# 配置の規約

- 共有型は `packages/shared/src/types/` に置く。API のレスポンス型は `api.ts`、ドメインモデルは `domain.ts`。
- 日付とスケジュールの計算は `@sui/shared` に置く。フロントエンドとバックエンドの両方が同じ規則で発生日を求めるためである。
- バックエンドの業務ロジックは `packages/backend/src/services/` に置く。ルートハンドラは検証と入出力の整形に留める。
- テストヘルパーは `packages/backend/src/test-helpers/` にある。

# バックエンドの層

```
routes/      HTTP の入口。zod で検証し、サービスを呼び、エラーを整形する
services/    業務ロジック。予測、割り勘、精算、為替、請求、ローン
lib/         横断的な部品。認証、日付、営業日、通貨、Prisma クライアント、ロガー
middleware/  認証ミドルウェア
mcp/         MCP サーバー。ツール、リソース、プロンプト
```

予測の中核は `services/forecast-core.ts` にあり、データベースアクセスを持たない純粋関数として書かれている。
呼び出し側の `services/forecast.ts` がデータを集めて渡す。
この分離の理由は [残高予測パイプライン](./forecast-pipeline.md) にある。

# データモデルの特徴

- 主キーは UUID。
- 金額は整数（通貨の最小単位）。`int32` に収まらない値は 400 で拒否する。
- 口座、予定収支、カード、サブスク、ローン、取引、メンバーは論理削除（`deletedAt`）を使う。
- `Transaction.forecastEventId` に一意制約があり、同じ予測イベントの二重確定を防ぐ。
- 割り勘の `SplitShare` と精算の `SettlementAllocation` は、親の削除でカスケードする。

# データの持ち出し

`GET /api/export` が全データを JSON で返し、`POST /api/import` が全置換で取り込む。
インポートは差分ではなく全置換で、割り勘や精算の参照が同一ファイル内で解決できることを検証してから適用する。

# 関連

- [残高予測パイプライン](./forecast-pipeline.md)
- [開発の進め方](../operations/development.md)
