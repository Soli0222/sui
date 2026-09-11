---
type: Reference
title: API エンドポイント一覧
description: /api 配下のすべての HTTP エンドポイントと、主なクエリパラメータ。
tags: [api, reference, backend]
generated: { by: codex/gpt-6, at: 2026-09-11T15:09:56Z }
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
| GET | `/api/transactions` | 取引一覧（ページネーション、フィルタ対応。`id` は取引IDによる絞り込み） |
| GET | `/api/transactions/balance-history?accountId=&startDate=&endDate=&applyOffset=` | 取引から逆算した過去の残高推移 |
| POST | `/api/transactions` | 取引作成（入金、出金、振替） |
| PUT | `/api/transactions/:id` | 取引更新（残高の巻き戻しと再適用を含む） |
| DELETE | `/api/transactions/:id` | 取引削除（論理削除） |

# 定期と負債

| メソッド | パス | 説明 |
|----------|------|------|
| GET / POST | `/api/salary-records?year=YYYY` | 給与明細の一覧と作成（year 省略時は全件） |
| PATCH / DELETE | `/api/salary-records/:id` | 給与明細の部分更新と論理削除 |
| GET / POST | `/api/donations?year=YYYY` | ふるさと納税の寄付の一覧と作成（year 省略時は全件） |
| PATCH / DELETE | `/api/donations/:id` | ふるさと納税の寄付の部分更新と論理削除 |
| GET | `/api/furusato/simulation?year=YYYY` | 給与・寄付実績と手入力値から控除上限・内訳の目安を計算 |
| PUT | `/api/furusato/simulation-input` | 年単位の賞与見込み・その他所得・その他控除を保存 |
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
| GET | `/api/settings` | ダッシュボードと取引一覧の既定表示期間を取得 |
| PUT | `/api/settings` | 既定表示期間を1項目以上の部分更新で保存し、更新後の2項目を返す |
| GET | `/api/export` | 全データを JSON で書き出す（論理削除済みを含む） |
| POST | `/api/import` | 全データを置き換える |

`PUT /api/settings` は `dashboardDefaultPeriod` と `transactionsDefaultPeriod` の一方または両方を受け取る。
未知のキー、各画面で許可されていない期間、空オブジェクトは 400 になる。

MCP エンドポイントは `/api` の外側の `/mcp` にある（[MCP エンドポイント](../architecture/mcp-endpoint.md)）。

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/.well-known/oauth-protected-resource/mcp` | MCP OAuth protected resource metadata。OAuth 無効時は JSON の 404 |
| GET | `/.well-known/oauth-protected-resource` | 同じ metadata を返す互換 URL |
| GET / POST / DELETE | `/mcp` | Streamable HTTP MCP。API トークンまたは有効化済みの OAuth access token が必要 |

# 関連

- [予測イベント](../concepts/forecast-event.md)
- [認証と信頼境界](../architecture/authentication.md)


# 支出決裁

| Method | Path | 内容 |
| --- | --- | --- |
| GET | `/api/spending` | 台帳、版、MF実績だけの月別予算計算（任意のmonthクエリ）、補正余力、購入と振替の導出状態 |
| POST | `/api/spending/commands` | `version` と `command` による検証済み更新。`answer`（id・reviewId・answer）で質問への回答を保存し、返却されたversionで別途reviewを呼ぶ |
| POST | `/api/spending/imports/preview` | version・base64・filenameから月次差し替えプレビュー。空ファイルのみmonth補足可。文字コード・対象月は自動判定 |
| POST | `/api/spending/:id/review` | `version` を指定してAI審査・再審査 |
| POST | `/api/spending/:id/override` | `version` と必須の `reason` による例外承認 |

commandsのactionはsettings、budget-proposal、payment-link、request、cancel、delete、purchase、delete-detail、import-confirm、return-funds。
旧budget・copy-budgetは一月分の改定へ変換する。旧mappingは400で新しい操作を案内する。
budget-proposalはproposal（name/from/to/categories/reason）と任意のreplaceIdを受け取り、期間を分割して改定する。
payment-linkはsourceとtarget（kind: account/card、id）を受け取り、nullで紐づけを解除する。
import-confirmは月全体を差し替える。旧confirmedCoverage/acceptErrorsは互換入力として残るが、新しい月次取込では不正行の受容・行の省略・確認範囲の手動設定はできない。

| Method | Path | 内容 |
| --- | --- | --- |
| GET | `/api/spending/ai/status` | configured・storageReady。秘密値は返さない |
| POST | `/api/spending/ai/config` | version・ai・任意のapiKey。キー省略で保持、nullで削除 |
| POST | `/api/spending/ai/models` | aiと任意の未保存apiKeyでモデル一覧取得 |
| POST | `/api/spending/ai/test` | aiと任意の未保存apiKeyで架空内容による審査形式確認 |

aiはprovider、endpoint、protocol、model、credentialMode、credentialEnv（旧方式用）、任意のmodelsEndpointを持つ。
保存済みキーを使う場合はcredentialMode=storedとし、接続先URLが一致するキーだけを利用する。
申請の新規作成と更新はrequestのidの有無で区別する。
request.inputはname・amount・category・reason・purchaseDate・payment・kind・currency・rateToJpy・rateAt・urgency・replacement・alternatives・relatedIds・fundingを受け取る。
amountは一申請の全額、categoryはMF大項目。予算対象月はpurchaseDateから求める。items入力は拒否する。
purchaseはid・amount・date・reasonを受け、購入記録を新規登録または訂正する。前の記録は履歴へ残し、その時点で購入完了とする。
plan・purchase-update・allocate・unlink・classifyは廃止し400を返す。旧台帳のデータはエクスポート・復元で保持する。
GETのcalculationsはMF実績と予算残額のみ。申請額を加えた試算は審査snapshotだけに保存し、購入済み申請は追加額0となる。
GETは照会のみ。更新・審査・取込はread-onlyトークンで403となる。
版不一致は409となり、購入記録の再送で履歴を重ねない。
金額・日付・関連のエラーは400または409。
業務規則とデータモデルは[支出決裁](../concepts/spending-approval.md)を参照。

補正利用枠はsettings.supplementalLimitsで指定する。各要素はid、category（nullなら全体）、subcategory（nullなら大項目全体）、months（3/12）、amount（JPY）、action（explain/block）。
申請には任意のsubcategoryを追加できる。回答・構造化審査根拠・利用枠スナップショットはexport/restoreで保持する。
