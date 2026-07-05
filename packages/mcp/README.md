# @soli0222/sui-mcp

sui の MCP（Model Context Protocol）サーバー。Claude などの AI アシスタントから資産管理操作を行うためのインターフェースを提供します。

sui 本体はリバースプロキシの mTLS で利用者認証を担保する信頼境界を前提にしており、アプリ内認証は持ちません。MCP サーバーを HTTP / SSE transport でリモート公開する場合は、MCP クライアントからの inbound 認証（Bearer token や OAuth など）を別途用意してください。

データの一括出力は Web UI のデータ管理から行います（全データを LLM コンテキストへ流すことを避けるため MCP には非搭載）。

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

### 認証モデル

- `stdio` transport は、Claude Desktop などがローカルのサブプロセスとして起動する前提です。
- sui API への outbound 接続は、必要に応じて `SUI_API_CLIENT_CERT_PATH` / `SUI_API_CLIENT_KEY_PATH` で mTLS クライアント証明書を提示できます。
- HTTP / SSE transport は MCP クライアントからの inbound 認証をアプリ側では行いません。リモート公開する場合は、リバースプロキシや MCP サーバー側で認証を追加してください。API への mTLS 接続は MCP エンドポイント自体の利用者認証にはなりません。

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
| `get_dashboard` | 残高予測・直近イベント・口座別予測を取得（`months`, `applyOffset` 指定可）。予測は固定収支・クレジットカード請求・ローン返済から生成し、サブスク台帳は二重計上防止のため含めない |
| `review_overdue_events` | 予定日を過ぎた未確定の予測イベントを確認用に一覧する（読み取り専用）。確定には人間の確認を経て `confirm_forecast` を使う |
| `explain_forecast` | 指定日までの残高予測について、起点残高・寄与イベント・source 別小計・指定日残高を説明（読み取り専用） |
| `simulate_forecast` | what-if の残高予測を実行。POST を使うが読み取り専用で、DB は変更しない |
| `confirm_forecast` | 実際の金額と口座を人間が確認した予測イベントを、手動で実取引として確定。自動確定目的では使わない |

予定額と実績額は一致しないことがあるため、予定日超過イベントも自動確定しません。MCP クライアントは `review_overdue_events` で対象イベントを確認し、ユーザー確認後に `confirm_forecast` を呼び出してください。

### 口座

| ツール | 説明 |
|--------|------|
| `list_accounts` | 口座一覧を取得 |
| `create_account` | 口座を作成（`balanceOffset` 指定可） |
| `update_account` | 口座を更新（`balanceOffset` 指定可）。`balance` の変更差分は `adjustment` 取引として記録 |
| `reconcile_account` | 実残高で口座を照合し、差分を `adjustment` 取引として記録 |
| `delete_account` | 口座を削除。`confirm: true` がない場合は対象要約と再実行案内だけを返す |

`Account` は実残高 `balance`、オフセット `balanceOffset`、最終照合日時 `lastReconciledAt` を持ちます。ダッシュボード系の残高はデフォルトで `balance - balanceOffset` を基準に計算され、`applyOffset=false` を指定すると実残高ベースに切り替えられます。

`update_account` で `balance` を変更した差分と `reconcile_account` の照合差分は、どちらも `adjustment` 取引として記録されます。これにより、過去の残高履歴を遡及的に書き換えずに実残高のズレを吸収できます。

### 取引

| ツール | 説明 |
|--------|------|
| `list_transactions` | 取引履歴を取得（ページネーション・口座・期間フィルタ対応） |
| `get_balance_history` | 口座または全体の過去残高推移を取得（`applyOffset` 指定可） |
| `create_transaction` | 手動で取引を記録（振替対応） |
| `update_transaction` | 既存の取引を更新（振替対応） |
| `delete_transaction` | 手動登録取引を削除。`confirm: true` がない場合は対象要約と再実行案内だけを返す |

### 固定収支

| ツール | 説明 |
|--------|------|
| `list_recurring_items` | 固定収支一覧を取得 |
| `create_recurring_item` | 固定収支を作成 |
| `update_recurring_item` | 固定収支を更新 |
| `delete_recurring_item` | 固定収支を削除。`confirm: true` がない場合は対象要約と再実行案内だけを返す |

### サブスク

| ツール | 説明 |
|--------|------|
| `list_subscriptions` | サブスク台帳の一覧を取得（残高予測には直接反映しない） |
| `create_subscription` | サブスク台帳を作成 |
| `update_subscription` | サブスク台帳を更新 |
| `delete_subscription` | サブスク台帳から削除。`confirm: true` がない場合は対象要約と再実行案内だけを返す |

サブスクの大半はクレジットカード払いで、カード請求額の仮定値または実績額に既に含まれる前提です。サブスクを残高予測へ直接入れると二重計上になるため、ここでは支払い元と金額を把握する台帳として扱います。カード払いではない定額支払いを予測に入れる場合は、現時点では固定収支として登録してください。

### クレジットカード・請求

| ツール | 説明 |
|--------|------|
| `list_credit_cards` | クレジットカード一覧を取得 |
| `create_credit_card` | クレジットカードを作成 |
| `update_credit_card` | クレジットカードを更新 |
| `delete_credit_card` | クレジットカードを削除。`confirm: true` がない場合は対象要約と再実行案内だけを返す |
| `get_billing` | 月別請求データを取得 |
| `update_billing` | 請求データを更新 |

### ローン

| ツール | 説明 |
|--------|------|
| `list_loans` | ローン一覧を取得 |
| `create_loan` | ローンを作成 |
| `update_loan` | ローンを更新 |
| `delete_loan` | ローンを削除。`confirm: true` がない場合は対象要約と再実行案内だけを返す |

### 監査ログ

| ツール | 説明 |
|--------|------|
| `list_recent_changes` | 最近の変更監査ログを一覧する（読み取り専用） |

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
