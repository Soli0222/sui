---
type: Reference
title: API エンドポイント一覧
description: /api 配下のすべての HTTP エンドポイントと、主なクエリパラメータ。
tags: [api, reference, backend]
generated: { by: codex/gpt-6, at: 2026-09-26T00:25:33Z }
---

# 概要

すべてのエンドポイントは `/api` プレフィックス付きである。
認証は Cookie セッションか Bearer トークンで、`GET /api/auth/status`、`GET /api/auth/login`、`GET /api/auth/callback` だけが認証前に通る。
読み取り専用トークンでは、`GET` 以外のメソッドが 403 になる。
詳細は [認証と信頼境界](../architecture/authentication.md) を参照。

`applyOffset` を受け取るエンドポイントは、既定の `true` で可処分残高ベース、`false` で実残高ベースの値を返す（[可処分残高とオフセット](../concepts/disposable-balance.md)）。

# ダッシュボードと予測

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/dashboard?applyOffset=true\|false` | 合計残高、最小残高、予測イベント、期日超過イベント、口座別予測 |
| GET | `/api/dashboard/events?months=1-24&applyOffset=` | 指定月数ぶんの予測イベントのみ（既定 3 か月） |
| GET | `/api/dashboard/explain?date=YYYY-MM-DD&accountId=&applyOffset=` | 指定日の残高がどのイベントで決まったかの内訳 |
| POST | `/api/dashboard/simulate` | 予定収支、ローン、カードを除外したり想定額を差し替えたりした場合の予測 |
| POST | `/api/dashboard/confirm` | 予測イベントを実取引として確定（[確定の規則](../concepts/forecast-event.md)） |

`POST /api/dashboard/simulate` のボディは `months`、`applyOffset`、`exclude`（`recurringItemIds` / `loanIds` / `creditCardIds`）、`cardAssumptionOverrides` を取る。

# 口座と取引

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/accounts` | 口座一覧（実残高、オフセット、最終照合日時） |
| POST | `/api/accounts` | 初期残高を指定して口座作成 |
| PUT | `/api/accounts/:id` | 名称・オフセット・表示順などの基本情報を更新。`balance` を含めると 400 で全項目を拒否し、照合 API を案内 |
| POST | `/api/accounts/:id/reconcile` | 実残高で照合。差分を `adjustment` 取引にし、差額0でも `lastReconciledAt` を更新 |
| DELETE | `/api/accounts/:id` | 口座削除（論理削除） |
| GET | `/api/transactions` | 取引一覧（ページネーション、フィルタ対応。`id` は取引IDによる絞り込み） |
| GET | `/api/transactions/balance-history?accountId=&startDate=&endDate=&applyOffset=` | 取引から逆算した過去の残高推移 |
| POST | `/api/transactions` | 取引作成（入金、出金、振替） |
| PUT | `/api/transactions/:id` | 取引更新（残高の巻き戻しと再適用を含む） |
| DELETE | `/api/transactions/:id` | 取引削除（論理削除） |

# 定期と負債

| メソッド | パス | 説明 |
|----------|------|------|
| GET / POST | `/api/salary-records?year=YYYY` | 給与明細の一覧と作成（year 省略時は全件） |
| GET | `/api/salary-records/:id` | 論理削除されていない給与明細を個別取得。ID が不正、存在しない、または削除済みの場合は 404 |
| PATCH / DELETE | `/api/salary-records/:id` | 給与明細の部分更新と論理削除 |
| GET / POST | `/api/donations?year=YYYY` | ふるさと納税の寄付の一覧と作成（year 省略時は全件） |
| PATCH / DELETE | `/api/donations/:id` | ふるさと納税の寄付の部分更新と論理削除 |
| GET | `/api/furusato/simulation?year=YYYY` | 給与・寄付実績と手入力値から控除上限・内訳の目安を計算 |
| PUT | `/api/furusato/simulation-input` | 年単位の賞与見込み・その他所得・その他控除を保存 |
| GET / POST | `/api/recurring-items` | 予定収支の一覧と作成。一覧は初期金額 `amount`、履歴 `amountChanges`、日本時間の現在金額 `effectiveAmount` を返す |
| GET | `/api/recurring-items/:id` | 予定収支の詳細。初期金額、履歴、現在金額を返す |
| PUT / DELETE | `/api/recurring-items/:id` | 予定収支の更新と削除。開始日は既存の金額履歴の適用日より前に限る |
| GET / POST | `/api/recurring-items/:id/amount-changes` | 金額履歴の一覧と追加。適用日は予定開始日の翌日以降。単発は追加不可 |
| PUT / DELETE | `/api/recurring-items/:id/amount-changes/:changeId` | 金額履歴の訂正と削除。金額は口座通貨の最小単位で 0 以上の整数 |
| GET / POST | `/api/subscriptions` | サブスク台帳の一覧と作成（予測には反映しない） |
| GET | `/api/subscriptions/:id` | 初期金額 `amount`、履歴 `amountChanges`、日本時間の現在価格 `effectiveAmount` を含む詳細 |
| GET | `/api/subscriptions/monthly/:yearMonth` | 月別の課金発生日、各回の適用金額 `amount`、JPY 換算した月合計 `total` |
| PUT / DELETE | `/api/subscriptions/:id` | サブスクの更新と削除。開始日は既存の価格履歴の適用開始日より前に限る |
| GET / POST | `/api/subscriptions/:id/amount-changes` | サブスク価格履歴の一覧と追加。適用開始日は契約開始日より後の YYYY-MM-DD、金額は通貨の最小単位 |
| PUT / DELETE | `/api/subscriptions/:id/amount-changes/:changeId` | 価格履歴の訂正と削除。適用開始日は契約開始日より後、履歴 ID は一覧の返却値を使用 |
| GET / POST | `/api/credit-cards` | カードの一覧と作成。`assumptions` は金額・開始請求月・終了請求月の配列。旧形式の単一 `assumptionAmount` は制限なしの 1 件として受け付ける |
| PUT / DELETE | `/api/credit-cards/:id` | カードの更新と削除。期間配列の差し替えで金額変更・期間追加・削除を行う。期間の逆転・重複は 400 |
| GET | `/api/credit-cards/:id/assumption-suggestion?months=1-60` | 過去の実績から想定額を提案（既定 6 か月） |
| GET | `/api/billings?month=YYYY-MM` | 指定請求月のカード請求データ。期間外の仮定値・安全弁は適用しない |
| PUT | `/api/billings/:yearMonth` | 請求データの更新（実績額の登録）。応答の適用額も請求月で判定 |
| GET / POST | `/api/loans` | ローンの一覧と作成 |
| PUT / DELETE | `/api/loans/:id` | ローンの更新と削除 |

# 割り勘

| メソッド | パス | 説明 |
|----------|------|------|
| GET / POST | `/api/people` | メンバーの一覧と作成 |
| PUT / DELETE | `/api/people/:id` | メンバーの更新と削除 |
| GET | `/api/people/:id/summary` | メンバーごとの負担と未回収の集計 |
| GET / POST | `/api/splits` | 割り勘の一覧と作成 |
| GET / PUT / DELETE | `/api/splits/:id` | 割り勘の取得、更新、削除。精算が付いていると 409 |
| GET / POST | `/api/settlements` | 精算の一覧と作成 |
| DELETE | `/api/settlements/:id` | 精算の削除 |

規則は [割り勘と精算](../concepts/split-and-settlement.md) にある。

# 認証とシステム

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/auth/status` | 認証モードとログイン状態 |
| GET | `/api/auth/login` | OIDC の認可エンドポイントへリダイレクト |
| GET | `/api/auth/callback` | OIDC コールバック。セッション Cookie を発行 |
| POST | `/api/auth/logout` | セッションを破棄 |
| GET | `/api/auth/sessions` | 自分の OIDC セッション一覧 |
| DELETE | `/api/auth/sessions` | 自分の OIDC セッションをすべて失効 |
| DELETE | `/api/auth/sessions/:id` | 指定した自分の OIDC セッションを失効 |
| GET / POST | `/api/auth/tokens` | API トークンの一覧と発行。発行応答は `Cache-Control: no-store` |
| DELETE | `/api/auth/tokens/:id` | API トークンの失効 |
| GET | `/api/audit-logs?page=&limit=&status=` | 監査ログの一覧（`limit` は既定 50、最大 100、`status` は `all`・`2xx`・`4xx`・`5xx`）。絞り込み後の件数と主体情報を含む |
| GET | `/api/settings` | ダッシュボードと取引一覧の既定表示期間を取得 |
| PUT | `/api/settings` | 既定表示期間を1項目以上の部分更新で保存し、更新後の2項目を返す |
| GET | `/api/export` | 全データを JSON で書き出す（論理削除済みを含む） |
| POST | `/api/import` | 全データを置き換える |

`PUT /api/settings` は `dashboardDefaultPeriod` と `transactionsDefaultPeriod` の一方または両方を受け取る。
未知のキー、各画面で許可されていない期間、空オブジェクトは 400 になる。

MCP エンドポイントは `/api` の外側の `/mcp` にある（[MCP エンドポイント](../architecture/mcp-endpoint.md)）。
`/api/auth` の 10 操作は UI 管理とし、それ以外の API 操作は MCP ツールで扱える。対応関係は `packages/backend/src/mcp/api-parity.ts` と契約テストで管理する。

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/.well-known/oauth-protected-resource/mcp` | MCP OAuth protected resource metadata。OAuth 無効時は JSON の 404 |
| GET | `/.well-known/oauth-protected-resource` | 同じ metadata を返す互換 URL |
| GET / POST / DELETE | `/mcp` | Streamable HTTP MCP。API トークンまたは有効化済みの OAuth access token が必要 |

# 関連

- [予測イベント](../concepts/forecast-event.md)
- [認証と信頼境界](../architecture/authentication.md)
