---
type: Architecture
title: MCP エンドポイント
description: backend に内包した /mcp の API トークン・OAuth 認証、セッション管理、内部 HTTP API 呼び出し。
tags: [mcp, backend, integration]
generated: { by: codex/gpt-6, at: 2026-09-23T06:22:29Z }
---

# 概要

MCP サーバーは独立したプロセスではない。
backend の `/mcp` として同じアプリの中で動く。
stdio 版と別プロセスの実装は廃止した。
backend が起動していれば、それだけで MCP としても使える。

```json
{
  "mcpServers": {
    "sui": {
      "type": "streamable-http",
      "url": "https://sui.example.com/mcp",
      "headers": { "Authorization": "Bearer sui_tok_..." }
    }
  }
}
```

# 認証

`/mcp` は Bearer トークンだけを受け付ける。
セッション Cookie では通らない。
ブラウザが自動で送る資格情報で MCP が動いてしまう状態を避けるためである。

トークンの検証、失効、読み取り専用フラグは、API の [認証](./authentication.md) と同じ仕組みを共有する。
`SUI_AUTH_MODE=disabled` のときは `/mcp` も認証をバイパスする。

`SUI_MCP_OAUTH_RESOURCE_URL` に公開 `/mcp` URL を設定すると、Auth0 access token も受け付ける。
`GET /.well-known/oauth-protected-resource/mcp` と互換用の `GET /.well-known/oauth-protected-resource` は、同じ resource、Auth0 issuer、`read:sui` / `write:sui` を公開する。
未認証の `/mcp` は `WWW-Authenticate` でこの metadata URL を案内する。
設定値は audience と challenge の正本でもあり、受信した Host や forwarded header から組み立てない。

OAuth を有効にするには、同じ Auth0 カスタムドメインの `SUI_OIDC_ISSUER` と、空でない `SUI_OIDC_ALLOWED_SUBJECTS` が必要である。
discovery と JWKS は遅延取得してキャッシュするため、Auth0 の一時障害はアプリ起動や API トークン経路を止めない。
OAuth 検証と公開 metadata 取得には、認証済み owner 単位の制限より前にプロセス全体のレート・同時実行上限を適用する。discovery 失敗も 5 秒間キャッシュし、未認証リクエストによる暗号検証、待機リクエスト、IdP への再試行を制限する。
JWT は RS256、issuer、audience、`at+jwt`、期限と RFC 9068 の必須 claim を検証する。
`read:sui` がなければ MCP の入口で 403、`write:sui` がなければ内部 API の更新で 403 になる。
Cookie、ID token、別 audience の access token は通らない。

# 自分自身を呼ぶクライアント

MCP のツール実装は Prisma を直接触らない。
`InProcessSuiApiClient` が Hono アプリの `request()` を呼び、自分自身の HTTP API を通す。

この構造には三つの効果がある。

- 検証、業務ルール、エラー整形が UI 経由と完全に一致する。
- 読み取り専用トークンの制約が、MCP 側で何もしなくても効く。認証ミドルウェアが 403 を返すからである。
- 内部 API の成功した変更と失敗は監査ログに残る。クライアントは `x-sui-client: mcp` を付けるので、UI からの操作と区別できる。

API トークンでは、現在の MCP リクエストが提示したトークンを内部 API へ渡し、毎回 DB で失効と `readOnly` を確認する。
OAuth では、リクエスト単位の `AsyncLocalStorage` から検証済み主体を取得する。
API client が作った同一の `Request` オブジェクトだけを `WeakMap` の内部 bridge に登録し、親 Hono アプリの認証ミドルウェアへ渡す。
HTTP header や `x-sui-client` を内部認証には使わない。
内部 API 呼び出しのたびに JWT 期限と現在の subject 許可リストを再確認する。

この構造により、同一 MCP セッションへ read-only token と read+write token が同時に到着しても、各 API 呼び出しの権限はそのリクエストに閉じる。

`/mcp` 入口の認証・権限・セッション・レート制限等による HTTP 4xx・5xx は入口の監査ログに残る。
成功した MCP セッション通信は入口では記録しない。
ツールが HTTP 200 の JSON-RPC 応答で失敗を返した場合は入口の HTTP 失敗に数えず、内部 API に到達した場合だけその API の失敗を記録する。
`list_recent_changes` は HTTP status を含む監査ログを返し、`all`・`2xx`・`4xx`・`5xx` で絞り込める。

# セッション

`mcp-session-id` ヘッダでセッションを識別し、トランスポートとサーバーのペアを保持する。
30 分間活動のないセッションは、5 分ごとの掃除で閉じる。

OAuth セッションの所有者は issuer、subject、client ID、resource の組で識別する。
access token、`jti`、scope は所有者キーに含めないため、Auth0 が access token を更新しても同じセッションを継続できる。
別 subject、別 client、別 resource、API トークンから同じ session ID を使うと 404 になる。
scope と期限はリクエストごとに新しい JWT から評価し、セッションへ保存しない。

セッション数には次の上限がある。上限に達すると 429 または 503 を返す。

- 全体の同時セッション数
- トークンごとの同時セッション数
- トークンごとの 1 分間リクエスト数
- トークンごとの同時接続数

上限は環境変数で調整できる。既定値は [設定と環境変数](../operations/configuration.md) を参照。

# 提供するもの

- ツール：ダッシュボード、口座、取引、予定収支、サブスク、カード、請求、ローン、割り勘、監査ログ。
- リソース：ダッシュボード、口座などのマスタ、サブスク、予測、取引。
- プロンプト：月次レポート、予算相談。

ID を引数に取るツール（`update_*`、`delete_*`）に対応する一覧ツールは、人間向けのテキストと合わせて ID を含む構造化データ（`structuredContent`）を返す。
リソースと resource template はクライアントによってモデルへ公開されないことがあり、ツールだけを見るエージェントが ID の取得経路を見つけられないためである。
取引の構造化データは口座オブジェクトなどを含めず、更新と削除に必要なフィールドだけにする。

予測イベントの確定はツールから呼べるが、金額と口座を人間が確認したうえで叩く前提は変わらない。
[予測イベント](../concepts/forecast-event.md) の確定の節を参照。

# 関連

- [認証と信頼境界](./authentication.md)
- [可観測性](./observability.md)


# 支出決裁のツール

`get_spending` は台帳、ID、最新version、予算計算、振替状態を返す。任意のmonthで表示対象月を指定できる。
`preview_spending_import` はfilename・base64・versionから月次CSVの差し替えをプレビューする。対象月・文字コードを自動判定し、空のCSVのみmonthを補足できる。
`update_spending` は同じAPIサービスで申請、購入、期間付き予算案、登録済み支払手段の紐づけ、取込確定等を行う。申請は一金額で、購入記録だけで完了する。MF実績や予算残額へ申請額を反映しない。旧予測調整・配賦操作は公開しない。
APIキーの登録と接続確認は管理UIから行い、MCPツール結果に秘密値を公開しない。
`review_spending` はAI審査、`override_spending` は理由付きの利用者例外承認である。
更新にはGETで得たversionを渡す。
AI審査そのものにMCP利用者の権限を渡すことはない。
補正予算の審査が承認されても、振替を確定する権限や操作は独立している。

# 分析プロンプトのデータ境界

月次レポート・予算相談・予測分析・支出内訳は、DB由来の名前や説明文を含む要約をJSONへ直列化し、非信頼データのブロックに入れる。
改行と引用符をJSONとしてエスケープし、ブロックの区切りに使う文字もUnicodeエスケープする。
データ内の命令・役割指定・ツール実行要求に従わないこと、レポート依頼は変更操作の許可ではないことを明記する。
これはモデルへ境界を伝える対策であり、任意のクライアントモデルが従うことを保証するものではない。
実際の変更権限はAPIの認証・read-only制約で制御し、確定操作は引き続き人間が確認する。

金額入力のスキーマは対象通貨の最小単位を明記する。
JPYは円、USD/EURはセントで、USD 250.00を指定する値は25000となる。

# ツールの応答契約

全ツールは `structuredContent` と、同じ DTO を compact JSON にした最後の `content[].text` を返す。
先頭の text は人間向けの要約で、JSON は独立した text ブロックなので抽出時に文章を解析する必要はない。
空一覧にも配列と範囲情報を返す。
既存の `accounts`、`items`、支出決裁の `data`、予測説明の `events` などの公開キー、ツール名、resource URI を保持する。

共通フィールドは `status: success | preview` と `amountUnit: minor` である。
金額は対象の `currencyCode` の最小単位（JPY は円、USD/EUR はセント）。`amountJpy` と JPY 集計は円である。
割り勘・精算は JPY、支出決裁の申請は `data.ledger.requests[].input.currency`、予算・MF 実績は JPY を使う。
請求は各 `items[].currencyCode` を返し、`total` と `appliedTotal` は JPY。
照合の `diff` と `adjustment.amount` は `account.currencyCode` を使う。
残高履歴は各 `points[].currencyCode` を使う。

一覧のマスタは `complete: true` で全件を返す。
取引・監査ログは `page/limit/total/nextPage` と `complete` を返す。
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
取込プレビューはプレビュー自体を保存して version が進むが、明細差し替えは未実行。`data.preview.id` と `data.state.version` を確定に使う。

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
| `list_recent_changes` | なし | items[].id/requestId | page/limit/total/nextPage | 金額なし | HTTP status と診断用 requestId | 読み取りのみ |
| `get_spending` | month ← 利用者指定 YYYY-MM | data.version; data.ledger 内の ID | 全台帳、集計は指定月 | 申請 input.currency・最小単位、予算/MF は JPY | input/settings/reviews/imports 等を返す | 読み取りのみ |
| `preview_spending_import` | version ← get_spending.data.version; month ← 利用者指定 YYYY-MM | data.preview.id; data.state.version | 単一 | JPY・円 | 次操作は data.state.version | 明細差し替え未実行。プレビュー保存あり |
| `update_spending` | version ← get_spending.data.version; command 内の ID は下記 | data.version; data.ledger 内の作成・更新対象 ID | 全台帳 | 申請 input.currency・最小単位、予算/MF は JPY | get_spending の input/settings を保持 | 回答・購入・取消・取込確定は利用者の指示 |
| `review_spending` | id ← get_spending.data.ledger.requests[].id; version ← get_spending.data.version | data.id/requestId; data.version | 単一 | 審査 snapshot 内の通貨 | get_spending または直前結果の version | AI審査。振替は確定しない |
| `override_spending` | id ← get_spending.data.ledger.requests[].id; version ← get_spending.data.version | data.id/requestId; data.version | 単一 | 審査 snapshot 内の通貨 | get_spending または直前結果の version | 利用者の明示承認と理由が必須 |

`update_spending.command` の ID は action ごとに異なる。
request/answer/cancel/delete/purchase/return-funds の `id` と `input.relatedIds` は `get_spending.data.ledger.requests[].id`、`reviewId` は `data.ledger.reviews[].id`、`detailId` は `data.ledger.details[].id`、`linkId` は `data.ledger.requests[].fundingLinks[].id`、`replaceId` は `data.ledger.budgetProposals[].id` を使う。
import-confirm の `id` は `preview_spending_import.data.preview.id`、resolutions は同 preview の rows の candidates/existingId を使う。
payment-link の target.id は kind=account なら `list_accounts.accounts[].id`、kind=card なら `list_credit_cards.items[].id`。
input.funding の sourceId/destinationId は `list_accounts.accounts[].id`。
settings.supplementalLimits の新規 ID は利用者が一意に決め、更新時は `get_spending.data.ledger.settings.supplementalLimits[].id` を使う。
古い version の 409 は再取得して判断し直す。自動的に最新 version に差し替えて再実行しない。

# 新しいツールを追加するとき

1. 共通登録ヘルパーを使い、`contracts.ts` に出力スキーマを追加する。ID とコレクションの公開キーを必須にし、追加のドメインフィールドを許す。
2. `textContent` に必ず DTO を渡す。JSON を別に組み立てない。API エラーを成功文に変えない。
3. ID 引数に取得元のツールとフィールドを記載し、現行値が不足する場合はツールで取得する経路を用意する。resource の公開を前提にしない。
4. この棚卸し表を更新する。登録一覧、出力スキーマ登録簿、表の対応は `contracts.test.ts` で照合する。
5. 空一覧、同名対象、ページング、外貨、HTTP の失敗を検証する。structuredContent と text JSON の一致、および先行結果から次操作へ渡すテストを加える。

関連するカード期間・金額履歴・監査ログも、この契約を適用する。
