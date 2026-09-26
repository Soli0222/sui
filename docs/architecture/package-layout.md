---
type: Architecture
title: パッケージ構成
description: pnpm workspace の四パッケージと、型、業務ロジック、永続化の配置規約。
tags: [monorepo, backend, frontend, structure]
generated: { by: codex/gpt-6, at: 2026-09-26T09:54:14Z }
---

# 概要

pnpm workspace で四つのパッケージに分かれる。

| パッケージ | 役割 | 主な技術 |
|------------|------|----------|
| `@sui/frontend` | React SPA | React, React Router, Recharts, Tailwind CSS, Vite |
| `@sui/backend` | API サーバーと MCP エンドポイント | Hono, tsup |
| `@sui/db` | Prisma スキーマとマイグレーション | Prisma, PostgreSQL |
| `@sui/shared` | 型定義、定数、日付とスケジュールの計算 | TypeScript |

技術バージョンは各パッケージの `package.json` と lockfile、コンテナ定義、CI を正本とし、この文書には転記しない。

言語は全パッケージ TypeScript で、E2E は Playwright、単体と結合は Vitest である。

# 配置の規約

- 共有型は `packages/shared/src/types/` に置く。API のレスポンス型は `api.ts`、ドメインモデルは `domain.ts`。
- 日付、スケジュール、サブスクの月次・年次集計は `@sui/shared` に置く。フロントエンドとバックエンドが同じ規則で計算するためである。
- バックエンドの業務ロジックは `packages/backend/src/services/` に置く。ルートハンドラは検証と入出力の整形に留める。
- API の入力スキーマは `packages/backend/src/schemas/` に置く。API と MCP で同じ意味の項目は `schemas/fields.ts` を共有する。
- テストヘルパーは `packages/backend/src/test-helpers/` にある。

# バックエンドの層

```
routes/      HTTP の入口。zod で検証し、サービスを呼び、エラーを整形する
schemas/     API 入力と API/MCP 共通の項目制約
services/    業務ロジック。予測、割り勘、精算、為替、請求、ローン
lib/         横断的な部品。認証、日付、営業日、通貨、Prisma クライアント、ロガー
middleware/  認証ミドルウェア
mcp/         MCP サーバー。ツール、リソース、プロンプト
```

予測の中核は `services/forecast-core.ts` にあり、データベースアクセスを持たない純粋関数として書かれている。
呼び出し側の `services/forecast.ts` がデータを集めて渡す。
この分離の理由は [残高予測パイプライン](./forecast-pipeline.md) にある。
取引の追加・更新・削除と予測確定は `services/transactions.ts` を通り、残高差分は `services/ledger-effects.ts` が計算する。`services/ledger-transaction.ts` の Serializable トランザクションで残高と取引を一緒に更新し、競合時に再試行する。予測イベント ID の一意制約は二重確定を防ぐ。

# データモデルの特徴

- 主キーは UUID。
- 金額は整数（通貨の最小単位）。`int32` に収まらない値は 400 で拒否する。
- 口座、予定収支、カード、サブスク、ローン、取引、メンバーは論理削除（`deletedAt`）を使う。
- `Transaction.forecastEventId` に一意制約があり、同じ予測イベントの二重確定を防ぐ。
- 割り勘の `SplitShare` と精算の `SettlementAllocation` は、親の削除でカスケードする。

# データの持ち出し

`GET /api/export` が全データを JSON で返し、`POST /api/import` が全置換で取り込む。
インポートは差分ではなく全置換で、割り勘や精算の参照が同一ファイル内で解決できることを検証してから適用する。
形式と入力検証は `schemas/data-transfer.ts`、書き出し・取り込み処理は `services/data-transfer.ts`、HTTP 応答は `routes/data-transfer.ts` が担当する。MCP からの取り込みも同じ入力スキーマを使う。

# 関連

- [残高予測パイプライン](./forecast-pipeline.md)
- [開発の進め方](../operations/development.md)
