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

### Claude Desktop での設定例

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

## 提供するツール

### ダッシュボード

| ツール | 説明 |
|--------|------|
| `get_dashboard` | 残高予測・直近イベント・口座別予測を取得 |
| `confirm_forecast` | 予測イベントを実取引として確定 |

### 口座

| ツール | 説明 |
|--------|------|
| `list_accounts` | 口座一覧を取得 |
| `create_account` | 口座を作成（`balanceOffset` 指定可） |
| `update_account` | 口座を更新（`balanceOffset` 指定可） |
| `delete_account` | 口座を削除 |

`Account` は実残高 `balance` とオフセット `balanceOffset` を持ちます。ダッシュボード系の残高は `balance - balanceOffset` を基準に計算されます。

### 取引

| ツール | 説明 |
|--------|------|
| `list_transactions` | 取引履歴を取得（ページネーション・口座・期間フィルタ対応） |
| `get_balance_history` | 口座または全体の過去残高推移を取得 |
| `create_transaction` | 手動で取引を記録（振替対応） |

### 固定収支

| ツール | 説明 |
|--------|------|
| `list_recurring_items` | 固定収支一覧を取得 |
| `create_recurring_item` | 固定収支を作成 |
| `update_recurring_item` | 固定収支を更新 |
| `delete_recurring_item` | 固定収支を削除 |

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
| `sui://credit-cards` | クレジットカード一覧（JSON） |
| `sui://loans` | ローン一覧（JSON） |
| `sui://transactions{?page,startDate,endDate}` | 取引履歴（JSON、ページ・期間指定可） |
| `sui://balance-history{?accountId,startDate,endDate}` | 過去の残高推移（JSON、口座・期間指定可） |
| `sui://billings/{yearMonth}` | 月別請求データ（JSON） |

## プロンプト

| プロンプト | 説明 | パラメータ |
|-----------|------|-----------|
| `monthly-report` | 月次財務レポートを生成 | `month` (YYYY-MM) |
| `budget-advice` | 家計改善アドバイス | なし |
| `forecast-analysis` | 残高予測分析 | `months` (1-24, デフォルト 6) |
| `expense-breakdown` | 支出カテゴリ分析 | `month` (YYYY-MM) |

## 開発

```bash
pnpm dev     # ウォッチモードで起動
pnpm test    # テスト実行
pnpm build   # ビルド
```
