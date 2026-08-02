---
type: Reference
title: API エンドポイント一覧
description: /api 配下のすべての HTTP エンドポイントと、主なクエリパラメータ。
tags: [api, reference, backend]
timestamp: 2026-07-26T00:00:00+09:00
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
| POST | `/api/accounts` | 口座作成 |
| PUT | `/api/accounts/:id` | 口座更新。`balance` の変更差分は `adjustment` 取引として記録 |
| POST | `/api/accounts/:id/reconcile` | 実残高で照合。差分を `adjustment` 取引にして `lastReconciledAt` を更新 |
| DELETE | `/api/accounts/:id` | 口座削除（論理削除） |
| GET | `/api/transactions` | 取引一覧（ページネーション、フィルタ対応） |
| GET | `/api/transactions/balance-history?accountId=&startDate=&endDate=&applyOffset=` | 取引から逆算した過去の残高推移 |
| POST | `/api/transactions` | 取引作成（入金、出金、振替） |
| PUT | `/api/transactions/:id` | 取引更新（残高の巻き戻しと再適用を含む） |
| DELETE | `/api/transactions/:id` | 取引削除（論理削除） |

# 定期と負債

| メソッド | パス | 説明 |
|----------|------|------|
| GET / POST | `/api/recurring-items` | 予定収支の一覧と作成 |
| PUT / DELETE | `/api/recurring-items/:id` | 予定収支の更新と削除 |
| GET / POST | `/api/subscriptions` | サブスク台帳の一覧と作成（予測には反映しない） |
| PUT / DELETE | `/api/subscriptions/:id` | サブスクの更新と削除 |
| GET / POST | `/api/credit-cards` | カードの一覧と作成 |
| PUT / DELETE | `/api/credit-cards/:id` | カードの更新と削除 |
| GET | `/api/credit-cards/:id/assumption-suggestion?months=1-60` | 過去の実績から想定額を提案（既定 6 か月） |
| GET | `/api/billings?month=YYYY-MM` | 指定月のカード請求データ |
| PUT | `/api/billings/:yearMonth` | 請求データの更新（実績額の登録） |
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
| GET | `/api/audit-logs?page=&limit=` | 監査ログの一覧（`limit` は既定 50、最大 100）。主体情報を含む |
| GET | `/api/export` | 全データを JSON で書き出す（論理削除済みを含む） |
| POST | `/api/import` | 全データを置き換える |

MCP エンドポイントは `/api` の外側の `/mcp` にある（[MCP エンドポイント](../architecture/mcp-endpoint.md)）。

# 関連

- [予測イベント](../concepts/forecast-event.md)
- [認証と信頼境界](../architecture/authentication.md)
