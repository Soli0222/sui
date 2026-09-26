---
type: Reference
title: MCP ツールの契約
description: 応答形式、識別子、ページング、金額単位と確認操作。
sources:
  - resource: ../../packages/backend/src/mcp/contracts.ts
generated: { by: codex/gpt-6, at: 2026-09-26T10:10:41Z }
---

# ツールの応答契約

全ツールは `structuredContent` と、同じ DTO を compact JSON にした最後の `content[].text` を返す。出力スキーマは成功・プレビュー時の DTO とエラー時の `{status, error}` を別の分岐として定義する。
先頭の text は人間向けの要約で、JSON は独立した text ブロックなので抽出時に文章を解析する必要はない。
空一覧にも配列と範囲情報を返す。
既存の `accounts`、`items`、予測説明の `events` などの公開キー、ツール名、resource URI を保持する。

共通フィールドは `status: success | preview` と `amountUnit: minor` である。
金額は対象の `currencyCode` の最小単位（JPY は円、USD/EUR はセント）。`amountJpy` と JPY 集計は円である。
割り勘・精算は JPY を使う。
請求は各 `items[].currencyCode` を返し、`total` と `appliedTotal` は JPY。
照合の `diff` と `adjustment.amount` は `account.currencyCode` を使う。
残高履歴は各 `points[].currencyCode` を使う。

一覧のマスタは `complete: true` で全件を返す。
取引は `page/limit/total/nextPage` と `complete` を返す。
`nextPage` が null でなければ、同じフィルタと limit を保持し、nextPage を page に指定して同じツールを呼ぶ。
途中ページの `complete` は false のままで、最後のページだけを全件と誤認させない。
ダッシュボードは期間内の結果であり `scope.months` と `scope.complete: false` を返す。

予定収支・カード・ローンは各行の `account` / `transferToAccount` オブジェクトを省き、関連 ID と `currencyCode` にする。
一覧には PUT に必要な現行フィールド（期間別仮定額、課金周期、表示順、開始・終了日など）を残す。
同名の対象は名前だけで自動選択せず、返された ID と関連情報で特定する。
更新時は一覧の現行値を取得し、変更しない項目を保持する。ローンの日付は入力にも使える YYYY-MM-DD に整える。

作成・更新は実際に API が返した対象の ID を返す。
確定は生成した `transaction.id` と元の `forecastEventId` を返す。
削除は `id/deleted/executed`、削除プレビューは `status: preview`、`executed: false`、`found` と再実行用の `confirm: true` を返す。
プレビューで対象が見つからない場合も削除は実行しない。
金額履歴では親 ID と `changeId` も返す。
`delete_settlement` は従来どおり直接削除する。
シミュレーションの `executed: false` は実データに変更がないことを表す。

API の失敗は `isError: true`、`status: error`、`error: {message, httpStatus, requestId, details?}` を両経路へ返す。
HTTP status と利用可能な `x-request-id` を保持し、検証エラーの `formErrors/fieldErrors` のメッセージだけを許可する。
任意の API エラーオブジェクト、入力値、stack は返さず、認証情報の項目やトークンを除く。
HTTP に到達しない実装内の例外は汎用メッセージと null の status/request ID を返す。
ツール引数自体が MCP inputSchema に違反する場合は SDK の入力エラーであり、HTTP status はない。
API 経由の業務検証、read-only 制約、削除確認、人間による予測確定の規則は維持する。


# 全公開ツールの棚卸し

以下のフィールドパスは structuredContent と最後の text JSON のどちらにも適用する。
「全件」は指定したフィルタ内の全件、「単一」は操作結果または指定対象の詳細を意味する。
ID を使う入力には取得元ツールとフィールドを記述する。UUID 以外のイベント ID、月キー、version も契約に含める。

| ツール | 識別子入力と取得元 | 戻り値の識別子 | 範囲・ページング | 通貨・単位 | 現行値・version の取得 | 確認操作 |
|---|---|---|---|---|---|---|
| `list_accounts` | なし | accounts[].id | 全件 | 各 currencyCode・最小単位 | 各行に更新用の現行値 | なし |
| `create_account` | なし | account.id | 単一 | 各 currencyCode・最小単位 | 不要 | なし |
| `update_account` | id ← list_accounts.accounts[].id; なし | account.id | 単一 | 各 currencyCode・最小単位 | list_accounts の同じ ID の現行値 | なし |
| `reconcile_account` | accountId ← list_accounts.accounts[].id | account.id; adjustment.id（差分なしは null） | 単一 | account.currencyCode・最小単位 | list_accounts の残高 | 実残高を利用者が確認 |
| `delete_account` | id ← list_accounts.accounts[].id | id | 単一 | 各 currencyCode・最小単位 | list_accounts | confirm=true のときだけ削除 |
| `list_transactions` | accountId ← list_accounts.accounts[].id | items[].id | page/limit/total/nextPage | 各 currencyCode・最小単位 | 各行に更新用の現行値 | なし |
| `create_transaction` | accountId/transferToAccountId ← list_accounts.accounts[].id | transaction.id | 単一 | 各 currencyCode・最小単位 | 不要 | なし |
| `update_transaction` | id ← list_transactions.items[].id; accountId/transferToAccountId ← list_accounts.accounts[].id | transaction.id | 単一 | 各 currencyCode・最小単位 | list_transactions の同じ ID の現行値 | なし |
| `delete_transaction` | id ← list_transactions.items[].id | id | 単一 | 各 currencyCode・最小単位 | list_transactions | confirm=true のときだけ削除 |
| `get_balance_history` | accountId ← list_accounts.accounts[].id | points[].date | 指定期間のバケット | points[].currencyCode・最小単位 | 不要 | なし |
| `list_recurring_items` | なし | items[].id | 全件 | 各 currencyCode・最小単位 | 各行に更新用の現行値 | なし |
| `create_recurring_item` | accountId/transferToAccountId ← list_accounts.accounts[].id | item.id | 単一 | 各 currencyCode・最小単位 | 不要 | なし |
| `update_recurring_item` | id ← list_recurring_items.items[].id; accountId/transferToAccountId ← list_accounts.accounts[].id | item.id | 単一 | 各 currencyCode・最小単位 | list_recurring_items の同じ ID の現行値 | なし |
| `delete_recurring_item` | id ← list_recurring_items.items[].id | id | 単一 | 各 currencyCode・最小単位 | list_recurring_items | confirm=true のときだけ削除 |
| `list_recurring_item_amount_changes` | recurringItemId ← list_recurring_items.items[].id | recurringItemId; amountChanges[].id | 全件 | 各 currencyCode・最小単位 | list_recurring_item_amount_changes の effectiveFrom/amount | なし |
| `create_recurring_item_amount_change` | recurringItemId ← list_recurring_items.items[].id | recurringItemId; id | 単一 | 各 currencyCode・最小単位 | list_recurring_item_amount_changes の effectiveFrom/amount | なし |
| `update_recurring_item_amount_change` | recurringItemId ← list_recurring_items.items[].id; changeId ← list_recurring_item_amount_changes.amountChanges[].id | recurringItemId; id | 単一 | 各 currencyCode・最小単位 | list_recurring_item_amount_changes の effectiveFrom/amount | なし |
| `delete_recurring_item_amount_change` | recurringItemId ← list_recurring_items.items[].id; changeId ← list_recurring_item_amount_changes.amountChanges[].id | recurringItemId; id; changeId | 単一 | 各 currencyCode・最小単位 | list_recurring_item_amount_changes の effectiveFrom/amount | confirm=true のときだけ削除 |
| `list_subscriptions` | なし | items[].id | 全件 | 各 currencyCode・最小単位 | 各行に更新用の現行値 | なし |
| `create_subscription` | なし | item.id | 単一 | 各 currencyCode・最小単位 | 不要 | なし |
| `update_subscription` | id ← list_subscriptions.items[].id; なし | item.id | 単一 | 各 currencyCode・最小単位 | list_subscriptions の同じ ID の現行値 | なし |
| `delete_subscription` | id ← list_subscriptions.items[].id | id | 単一 | 各 currencyCode・最小単位 | list_subscriptions | confirm=true のときだけ削除 |
| `list_subscription_amount_changes` | subscriptionId ← list_subscriptions.items[].id | subscriptionId; amountChanges[].id | 全件 | 各 currencyCode・最小単位 | list_subscription_amount_changes の effectiveFrom/amount | なし |
| `create_subscription_amount_change` | subscriptionId ← list_subscriptions.items[].id | subscriptionId; id | 単一 | 各 currencyCode・最小単位 | list_subscription_amount_changes の effectiveFrom/amount | なし |
| `update_subscription_amount_change` | subscriptionId ← list_subscriptions.items[].id; changeId ← list_subscription_amount_changes.amountChanges[].id | subscriptionId; id | 単一 | 各 currencyCode・最小単位 | list_subscription_amount_changes の effectiveFrom/amount | なし |
| `delete_subscription_amount_change` | subscriptionId ← list_subscriptions.items[].id; changeId ← list_subscription_amount_changes.amountChanges[].id | subscriptionId; id; changeId | 単一 | 各 currencyCode・最小単位 | list_subscription_amount_changes の effectiveFrom/amount | confirm=true のときだけ削除 |
| `list_credit_cards` | なし | items[].id | 全件 | 各 currencyCode・最小単位 | 各行に更新用の現行値 | なし |
| `create_credit_card` | accountId ← list_accounts.accounts[].id | item.id | 単一 | 各 currencyCode・最小単位 | 不要 | なし |
| `update_credit_card` | id ← list_credit_cards.items[].id; accountId ← list_accounts.accounts[].id | item.id | 単一 | 各 currencyCode・最小単位 | list_credit_cards の同じ ID の現行値 | なし |
| `delete_credit_card` | id ← list_credit_cards.items[].id | id | 単一 | 各 currencyCode・最小単位 | list_credit_cards | confirm=true のときだけ削除 |
| `get_credit_card_assumption_suggestion` | id ← list_credit_cards.items[].id | creditCardId; sourceYearMonths[] | months 内 | currencyCode・最小単位 | list_credit_cards.assumptions | 提案のみ |
| `get_billing` | month ← 利用者指定 YYYY-MM | yearMonth; items[].creditCardId | 指定月 | 各 items[].currencyCode・最小単位、合計 JPY | settlementDate/items を返す | なし |
| `update_billing` | yearMonth ← get_billing.yearMonth; items[].creditCardId ← list_credit_cards.items[].id | yearMonth; items[].creditCardId | 指定月 | 各 items[].currencyCode・最小単位、合計 JPY | get_billing の settlementDate/items | 利用者の実績確認 |
| `list_loans` | なし | items[].id | 全件 | 各 currencyCode・最小単位 | 各行に更新用の現行値 | なし |
| `create_loan` | accountId ← list_accounts.accounts[].id | item.id | 単一 | 各 currencyCode・最小単位 | 不要 | なし |
| `update_loan` | id ← list_loans.items[].id; accountId ← list_accounts.accounts[].id | item.id | 単一 | 各 currencyCode・最小単位 | list_loans の同じ ID の現行値 | なし |
| `delete_loan` | id ← list_loans.items[].id | id | 単一 | 各 currencyCode・最小単位 | list_loans | confirm=true のときだけ削除 |
| `list_people` | なし | people[].id | 全件 | outstandingAmount の通貨キー・最小単位 | 各行の名前・未回収額 | なし |
| `get_person_summary` | personId ← list_people.people[].id | person.id; shares[].id; settlements[].id | 対象人物の全件 | JPY・円 | 持分・精算の現行値 | なし |
| `set_transaction_split` | splitId ← list_splits.items[].id; shares[].personId ← list_people.people[].id | split.id; shares[].id/personId | 単一 | JPY・円 | list_splits の同じ ID の全フィールド | 精算済み編集は API が拒否 |
| `list_splits` | personId ← list_people.people[].id | items[].id; items[].shares[].id/personId | 全件 | JPY・円 | 各行に method/ownRatio/shares 等 | なし |
| `create_settlement` | personId ← list_people.people[].id; transactionId ← list_transactions.items[].id; allocations[].shareId ← get_person_summary.shares[].id | settlement.id; settlement.allocations[].id/shareId | 単一 | JPY・円 | get_person_summary の remainingAmount | 利用者の精算確認 |
| `delete_settlement` | settlementId ← get_person_summary.settlements[].id | id | 単一 | 金額なし | get_person_summary | 直接実行（既存仕様） |
| `get_dashboard` | なし | forecast[].id; overdueForecast[].id; accountForecasts[].accountId | scope.months（既定24）内 | イベント currencyCode・最小単位、合計 JPY | 予測額・口座 ID を返す | 読み取りのみ |
| `review_overdue_events` | なし | events[].id/accountId/transferToAccountId | 取得範囲内の期日超過 | イベント currencyCode・最小単位 | 実際の金額・口座を人間に確認 | 一覧だけでは確定しない |
| `explain_forecast` | accountId ← list_accounts.accounts[].id | accountId; events[].id | 指定日まで | JPY・円 | 不要 | 読み取りのみ |
| `simulate_forecast` | exclude.*Ids ← 各 list_*.items[].id; cardAssumptionOverrides[].creditCardId ← list_credit_cards.items[].id | 指定条件に対する比較結果 | months 内 | 仮定額はカード通貨最小単位、結果 JPY | list_credit_cards の仮定額 | DB変更なし |
| `confirm_forecast` | forecastEventId ← get_dashboard.forecast[].id/overdueForecast[].id または review_overdue_events.events[].id; accountId ← list_accounts.accounts[].id | transaction.id/forecastEventId/accountId/transferToAccountId | 単一 | transaction.currencyCode・最小単位 | get_dashboard/review_overdue_events | 人間が実績額と口座を確認後のみ |
| `get_recurring_item` | id ← list_recurring_items.items[].id | item.id | 単一 | item.currencyCode・最小単位 | 詳細を取得 | なし |
| `get_subscription` | id ← list_subscriptions.items[].id | item.id | 単一 | item.currencyCode・最小単位 | 詳細を取得 | なし |
| `get_subscription_monthly` | yearMonth ← 利用者指定 YYYY-MM | items[].subscription.id | 指定月 | items[].currencyCode・最小単位、total は totalsCurrencyCode=JPY | 料金履歴を適用 | なし |
| `create_person` | なし | person.id | 単一 | JPY・円 | 不要 | なし |
| `update_person` | id ← list_people.people[].id | person.id | 単一 | JPY・円 | list_people の同じ ID | なし |
| `delete_person` | id ← list_people.people[].id | id | 単一 | JPY・円 | list_people | confirm=true のときだけ削除 |
| `get_split` | id ← list_splits.items[].id | split.id; shares[].id | 単一 | JPY・円 | 詳細を取得 | なし |
| `delete_split` | id ← list_splits.items[].id | id | 単一 | JPY・円 | list_splits | confirm=true のときだけ削除 |
| `list_settlements` | personId ← list_people.people[].id; transactionId ← list_transactions.items[].id | items[].id | 全件 | JPY・円 | 各精算の現行値 | なし |
| `list_salary_records` | year ← 利用者指定 YYYY | items[].id | 全件または指定年 | JPY・円 | 各明細の現行値 | なし |
| `get_salary_record` | id ← list_salary_records.items[].id | item.id | 単一 | JPY・円 | 詳細を取得 | なし |
| `create_salary_record` | なし | item.id | 単一 | JPY・円 | 不要 | なし |
| `update_salary_record` | id ← list_salary_records.items[].id | item.id | 単一 | JPY・円 | get_salary_record の現行値 | なし |
| `delete_salary_record` | id ← list_salary_records.items[].id | id | 単一 | JPY・円 | list_salary_records | confirm=true のときだけ削除 |
| `list_donations` | year ← 利用者指定 YYYY | items[].id | 全件または指定年 | JPY・円 | 各寄付の現行値 | なし |
| `create_donation` | なし | item.id | 単一 | JPY・円 | 不要 | なし |
| `update_donation` | id ← list_donations.items[].id | item.id | 単一 | JPY・円 | list_donations の現行値 | なし |
| `delete_donation` | id ← list_donations.items[].id | id | 単一 | JPY・円 | list_donations | confirm=true のときだけ削除 |
| `get_furusato_simulation` | year ← 利用者指定 YYYY | simulation.year | 指定年 | JPY・円 | 給与・寄付・入力値を集計 | なし |
| `save_furusato_simulation_input` | year ← 利用者指定 YYYY | input.year | 単一 | JPY・円 | get_furusato_simulation の入力値 | なし |
| `get_ui_settings` | なし | なし | 単一 | 金額なし | 現行の期間設定 | なし |
| `update_ui_settings` | なし | なし | 単一 | 金額なし | get_ui_settings の現行値 | なし |
| `export_data` | なし | export.data 内の各 ID | 全データ | 各通貨・最小単位 | 全データを取得 | 読み取りのみ |
| `import_data` | なし | counts | 全データ | 各通貨・最小単位 | export_data のデータ | confirm=true のときだけ置換 |


# 関連

- [MCP の設計](../architecture/mcp-endpoint.md)
- [MCP の拡張手順](../operations/mcp-development.md)
- [API エンドポイント](./api-endpoints.md)
