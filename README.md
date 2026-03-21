# sui — 可処分資産予測

個人の資産を管理し、将来の残高を予測するための Web アプリケーションです。

銀行口座の残高、固定収支、クレジットカードの引き落とし、ローンの返済スケジュールなどを登録し、今後数か月の可処分残高推移をチャートで可視化できます。

## 主な機能

| 機能 | 概要 |
|------|------|
| **ダッシュボード** | オフセット反映後の合計残高・最小残高・直近の収支を表示し、可処分残高推移をチャートで描画 |
| **口座管理** | 複数の銀行口座を登録し、実残高とオフセットを管理 |
| **固定収支** | 給与・家賃・サブスクなど毎月の定期的な収入・支出を登録 |
| **クレジットカード** | カードごとに想定額と実績額を管理し、引き落とし予測に反映 |
| **ローン** | 返済総額・回数・開始日から月々の返済予測を自動計算 |
| **取引履歴** | 手動での入出金・口座間振替を記録・編集し、過去の残高推移をチャートで確認 |
| **予測の自動確定** | 取引予定日を過ぎた予測イベントを自動的に実取引として確定（修正は取引履歴から） |

## 技術スタック

| レイヤー | 技術 |
|----------|------|
| フロントエンド | React 18, React Router v6, Recharts, Tailwind CSS |
| バックエンド | Hono |
| データベース | PostgreSQL 18 |
| MCP サーバー | @modelcontextprotocol/sdk |
| DB パッケージ | Prisma ORM（スキーマ・マイグレーション） |
| 共有パッケージ | TypeScript 型定義・定数 |
| ビルド | Vite (フロントエンド), tsup (バックエンド・MCP) |
| テスト | Vitest (単体・結合), Playwright (E2E) |
| インフラ | Docker, Docker Compose |
| CI | GitHub Actions |
| 言語 | TypeScript (全パッケージ) |

## プロジェクト構成

```
sui/
├── packages/
│   ├── frontend/     # React SPA
│   ├── backend/      # Hono API サーバー
│   ├── db/           # Prisma スキーマ・マイグレーション
│   ├── mcp/          # MCP サーバー（LLM 連携）
│   └── shared/       # 共有型定義・定数
├── e2e/              # Playwright E2E テスト
├── scripts/          # シードスクリプト
├── compose.yaml      # 本番用 Docker Compose
├── compose_db.yaml   # テスト用 DB
├── Dockerfile        # マルチステージビルド
├── Makefile          # 開発タスクランナー
└── playwright.config.ts
```

## セットアップ

### 前提条件

- **Node.js** 24 以上
- **pnpm** 10 以上
- **Docker** および **Docker Compose** (データベース用)

### インストール

```bash
pnpm install
```

### データベースの起動

テスト・開発用の PostgreSQL をコンテナで起動します。

```bash
docker compose -f compose_db.yaml up -d --wait
```

### データベースのマイグレーション

```bash
pnpm --filter @sui/db db:generate
pnpm --filter @sui/db prisma:migrate
```

### 開発サーバーの起動

フロントエンドとバックエンドを同時に起動します。

```bash
pnpm dev
```

- フロントエンド: http://localhost:5173
- バックエンド API: http://localhost:3000

フロントエンドの開発サーバーは `/api` へのリクエストをバックエンドにプロキシします。

### シードデータの投入

アプリケーション起動後、サンプルデータを段階的に投入できます。

```bash
bash scripts/seed.sh
```

```bash
bash scripts/seed.sh phase2
bash scripts/seed.sh phase3
bash scripts/seed.sh all
```

- `phase1` (デフォルト): 一切の不足が発生しない基本データ
- `phase2`: オフセット不足のみが発生する追加データ
- `phase3`: 実残高マイナスが発生する追加データ
- `all`: `phase1 -> phase2 -> phase3` を順に投入

`phase2` と `phase3` は追加投入用です。段階確認するなら `phase1` の後に順番に流してください。

## 環境変数

| 変数名 | 説明 | デフォルト |
|--------|------|------------|
| `DATABASE_URL` | PostgreSQL 接続文字列 | (必須) |
| `PORT` | バックエンドのポート番号 | `3000` |
| `STATIC_DIR` | フロントエンドの静的ファイルパス | `../frontend/dist` |
| `VITE_API_BASE` | フロントエンドからの API ベース URL | `http://localhost:3000` |
| `SUI_API_URL` | MCP サーバーからの API ベース URL | `http://localhost:3000` |

## API エンドポイント

すべてのエンドポイントは `/api` プレフィックス付きです。

`Account` には実残高 `balance` に加えて、可処分残高計算用の `balanceOffset` があります。ダッシュボードの `totalBalance` や口座別 `currentBalance` は `balance - balanceOffset` を基準に計算されます。

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/dashboard` | ダッシュボードデータ（可処分残高予測・イベント一覧） |
| POST | `/api/dashboard/confirm` | 予測イベントを実取引として確定 |
| GET | `/api/accounts` | 口座一覧（実残高・オフセットを含む） |
| POST | `/api/accounts` | 口座作成 |
| PUT | `/api/accounts/:id` | 口座更新 |
| DELETE | `/api/accounts/:id` | 口座削除（論理削除） |
| GET | `/api/transactions` | 取引一覧（ページネーション・フィルタ対応） |
| GET | `/api/transactions/balance-history` | 取引履歴から逆算した過去の残高推移を取得 |
| POST | `/api/transactions` | 取引作成（入金・出金・振替） |
| PUT | `/api/transactions/:id` | 取引更新（残高の巻き戻し・再適用を含む） |
| GET | `/api/recurring-items` | 固定収支一覧 |
| POST | `/api/recurring-items` | 固定収支作成 |
| PUT | `/api/recurring-items/:id` | 固定収支更新 |
| DELETE | `/api/recurring-items/:id` | 固定収支削除 |
| GET | `/api/credit-cards` | クレジットカード一覧 |
| POST | `/api/credit-cards` | クレジットカード作成 |
| PUT | `/api/credit-cards/:id` | クレジットカード更新 |
| DELETE | `/api/credit-cards/:id` | クレジットカード削除 |
| GET | `/api/billings?month=YYYY-MM` | 指定月のクレジットカード請求データ |
| PUT | `/api/billings/:yearMonth` | 請求データ更新 |
| GET | `/api/loans` | ローン一覧 |
| POST | `/api/loans` | ローン作成 |
| PUT | `/api/loans/:id` | ローン更新 |
| DELETE | `/api/loans/:id` | ローン削除 |

## テスト

```bash
# 単体テスト
pnpm test

# 型チェック（Prisma クライアントの生成が必要）
pnpm --filter @sui/db db:generate
pnpm typecheck

# 結合テスト（テスト DB の起動が必要）
make test-integration

# E2E テスト（テスト DB の起動が必要）
make test-e2e
```

## MCP サーバー

[MCP (Model Context Protocol)](https://modelcontextprotocol.io/) サーバーにより、LLM（Claude、Copilot 等）から家計データの参照・操作が可能です。npm パッケージ [`@soli0222/sui-mcp`](https://www.npmjs.com/package/@soli0222/sui-mcp) として公開しています。

### クライアント設定例

Claude Desktop (`claude_desktop_config.json`) / VS Code (`.vscode/mcp.json`):

```json
{
  "mcpServers": {
    "sui": {
      "command": "npx",
      "args": ["@soli0222/sui-mcp"],
      "env": {
        "SUI_API_URL": "http://localhost:3000"
      }
    }
  }
}
```


## 本番ビルド

### ローカルビルド

```bash
pnpm build
```

### Docker

```bash
# イメージのビルドと起動
docker compose up -d --build
```

アプリケーションが http://localhost:3000 で起動します。
コンテナ内で Prisma のマイグレーションが自動実行されます。

## Makefile タスク

```bash
make help          # 利用可能なタスク一覧
make typecheck     # 型チェック
make test-unit     # 単体テスト
make test-integration  # 結合テスト
make test-e2e      # E2E テスト
make build         # プロダクションビルド
make test-db-up    # テスト用 DB 起動
make test-db-down  # テスト用 DB 停止
```

## ライセンス

[MIT](LICENSE)
