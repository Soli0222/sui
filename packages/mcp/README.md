# @soli0222/sui-mcp

sui の MCP（Model Context Protocol）サーバー。Claude などの AI アシスタントから資産管理操作を行うためのインターフェースを提供します。

## セットアップ

```bash
pnpm install
pnpm build
```

### 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `SUI_API_URL` | `http://localhost:3000` | sui バックエンド API の URL |
| `SUI_API_CLIENT_CERT_PATH` | （未設定） | mTLS 用のクライアント証明書 (PEM) のパス。指定する場合は `SUI_API_CLIENT_KEY_PATH` も必須 |
| `SUI_API_CLIENT_KEY_PATH` | （未設定） | mTLS 用のクライアント秘密鍵 (PEM) のパス |
| `SUI_API_CLIENT_KEY_PASSPHRASE` | （未設定） | クライアント秘密鍵のパスフレーズ（鍵が暗号化されている場合のみ） |
| `SUI_API_CA_CERT_PATH` | （未設定） | サーバー証明書を検証するための CA 証明書 (PEM) のパス。プライベート CA で発行された証明書を使う場合に指定 |
| `SUI_API_TLS_REJECT_UNAUTHORIZED` | `true` | `false` を指定すると TLS 証明書の検証を無効化（開発用途のみ推奨） |
| `SUI_MCP_TRANSPORT` | `stdio` | MCP クライアントとの transport。`stdio`, `sse`, `streamable-http` |
| `SUI_MCP_ADDRESS` | `localhost:8000` | `sse` / `streamable-http` の待受アドレス |
| `SUI_MCP_BASE_PATH` | （未設定） | `sse` / `streamable-http` のベースパス |
| `SUI_MCP_ENDPOINT_PATH` | `/mcp` | `streamable-http` の MCP エンドポイント |

mTLS で保護された API に接続する場合、`SUI_API_CLIENT_CERT_PATH` と `SUI_API_CLIENT_KEY_PATH` を必ず両方指定してください。片方のみの指定は起動時にエラーになります。

### Transport

既定は Claude Desktop などがサブプロセスとして起動する `stdio` です。

```bash
sui-mcp
```

コンテナや常駐プロセスとして公開する場合は、 `-t` / `--transport` で HTTP transport を指定できます。

```bash
# Legacy SSE: GET /sse, POST /message
sui-mcp -t sse --address :8000

# Streamable HTTP: /mcp
sui-mcp -t streamable-http --address :8000

# パスを前置きする場合
sui-mcp -t streamable-http --address :8000 --base-path /sui --endpoint-path /mcp
```

HTTP transport ではヘルスチェックとして `/healthz`（`--base-path` 指定時は `<base-path>/healthz`）を提供します。

### Docker

MCP サーバーのみをコンテナとして起動できます。既定では Streamable HTTP を `:8000` で公開し、sui API はホスト側の `http://host.docker.internal:3000` を参照します。

```bash
docker compose -f compose.mcp.yaml up -d --build
```

別の API URL に接続する場合:

```bash
SUI_API_URL=https://sui.example.com docker compose -f compose.mcp.yaml up -d --build
```

公開されるエンドポイント:

| 用途 | URL |
|------|-----|
| Streamable HTTP | `http://localhost:8000/mcp` |
| Health check | `http://localhost:8000/healthz` |

### Claude Desktop での設定例

```json
{
  "mcpServers": {
    "sui": {
      "command": "npx",
      "args": ["@soli0222/sui-mcp"],
      "env": {
        "SUI_API_URL": "https://sui.example.com",
        "SUI_API_CLIENT_CERT_PATH": "/path/to/client.crt",
        "SUI_API_CLIENT_KEY_PATH": "/path/to/client.key",
        "SUI_API_CA_CERT_PATH": "/path/to/ca.crt"
      }
    }
  }
}
```

## 提供するツール

### ダッシュボード

| ツール | 説明 |
|--------|------|
| `get_dashboard` | 残高予測・直近イベント・口座別予測を取得（`months`, `applyOffset` 指定可） |
| `confirm_forecast` | 予測イベントを実取引として確定 |

### 口座

| ツール | 説明 |
|--------|------|
| `list_accounts` | 口座一覧を取得 |
| `create_account` | 口座を作成（`balanceOffset` 指定可） |
| `update_account` | 口座を更新（`balanceOffset` 指定可） |
| `delete_account` | 口座を削除 |

`Account` は実残高 `balance` とオフセット `balanceOffset` を持ちます。ダッシュボード系の残高はデフォルトで `balance - balanceOffset` を基準に計算され、`applyOffset=false` を指定すると実残高ベースに切り替えられます。

### 取引

| ツール | 説明 |
|--------|------|
| `list_transactions` | 取引履歴を取得（ページネーション・口座・期間フィルタ対応） |
| `get_balance_history` | 口座または全体の過去残高推移を取得（`applyOffset` 指定可） |
| `create_transaction` | 手動で取引を記録（振替対応） |
| `update_transaction` | 既存の取引を更新（振替対応） |

### 固定収支

| ツール | 説明 |
|--------|------|
| `list_recurring_items` | 固定収支一覧を取得 |
| `create_recurring_item` | 固定収支を作成 |
| `update_recurring_item` | 固定収支を更新 |
| `delete_recurring_item` | 固定収支を削除 |

### サブスク

| ツール | 説明 |
|--------|------|
| `list_subscriptions` | サブスク一覧を取得 |
| `create_subscription` | サブスクを作成 |
| `update_subscription` | サブスクを更新 |
| `delete_subscription` | サブスクを削除 |

### クレジットカード・請求

| ツール | 説明 |
|--------|------|
| `list_credit_cards` | クレジットカード一覧を取得 |
| `create_credit_card` | クレジットカードを作成 |
| `update_credit_card` | クレジットカードを更新 |
| `delete_credit_card` | クレジットカードを削除 |
| `get_billing` | 月別請求データを取得 |
| `update_billing` | 請求データを更新 |

### ローン

| ツール | 説明 |
|--------|------|
| `list_loans` | ローン一覧を取得 |
| `create_loan` | ローンを作成 |
| `update_loan` | ローンを更新 |
| `delete_loan` | ローンを削除 |

## リソース

| URI | 説明 |
|-----|------|
| `sui://dashboard` | ダッシュボードデータ（JSON） |
| `sui://forecast/summary` | 残高予測サマリー（テキスト） |
| `sui://accounts` | 口座一覧（JSON） |
| `sui://recurring-items` | 固定収支一覧（JSON） |
| `sui://subscriptions` | サブスク一覧（JSON） |
| `sui://credit-cards` | クレジットカード一覧（JSON） |
| `sui://loans` | ローン一覧（JSON） |
| `sui://transactions{?page,startDate,endDate}` | 取引履歴（JSON、ページ・期間指定可） |
| `sui://balance-history{?accountId,startDate,endDate,applyOffset}` | 過去の残高推移（JSON、口座・期間・オフセット適用有無を指定可） |
| `sui://billings/{yearMonth}` | 月別請求データ（JSON） |

## プロンプト

| プロンプト | 説明 | パラメータ |
|-----------|------|-----------|
| `monthly-report` | 月次財務レポートを生成 | `month` (YYYY-MM), `applyOffset` (省略時 `true`) |
| `budget-advice` | 家計改善アドバイス | `applyOffset` (省略時 `true`) |
| `forecast-analysis` | 残高予測分析 | `months` (1-24, デフォルト 6), `applyOffset` (省略時 `true`) |
| `expense-breakdown` | 支出カテゴリ分析 | `month` (YYYY-MM) |

## 開発

```bash
pnpm dev     # ウォッチモードで起動
pnpm test    # テスト実行
pnpm build   # ビルド
```
