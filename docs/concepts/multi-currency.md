---
type: Domain Rule
title: 複数通貨と JPY 換算
description: 外貨口座と外貨サブスクの金額を JPY 換算して集計する規則と、為替レートの更新方法。
tags: [currency, exchange-rate, account]
timestamp: 2026-07-26T00:00:00+09:00
---

# 概要

対応通貨は JPY、USD、EUR の三つである。
口座とサブスクが `currencyCode` と `exchangeRateToJpy` を持ち、金額はその通貨の最小単位で保存する。
JPY は円、USD と EUR はセント単位である。

合計値は必ず JPY に寄せてから足す。
ダッシュボードの合計残高、最小残高、予測の各時点残高、サブスクの月額と年額は、いずれも換算後の値である。
一方で個々のイベントは元の通貨の `amount` と換算後の `amountJpy` を両方返すので、表示側でどちらを見せるかを選べる。

未知の通貨コードや欠けたレートは JPY とレート 1 に丸めて扱う。
集計が例外で落ちるより、換算せずに足すほうが被害が小さいという判断である。

# レートの更新

レートは Frankfurter API から取得する。
取得のきっかけは API への GET リクエストで、前回取得から 5 分以上経っていれば、登録されている外貨ぶんをまとめて取り直す。
更新に失敗しても保存済みのレートで処理を続け、警告ログだけを残す。

`GET /api/export` は更新の対象外である。
エクスポートは現在保存されている値をそのまま出す。

| 環境変数 | 用途 | 既定 |
|----------|------|------|
| `SUI_EXCHANGE_RATE_API_BASE_URL` | 取得先のベース URL | `https://api.frankfurter.dev/v2` |
| `SUI_EXCHANGE_RATE_REFRESH_INTERVAL_MS` | 再取得までの最小間隔 | 300000 |
| `SUI_EXCHANGE_RATE_REQUEST_TIMEOUT_MS` | 1 リクエストのタイムアウト | 5000 |

# 通貨をまたぐ操作の制限

- 口座間の振替は同一通貨に限る。異なる通貨の口座を指定した確定は 400 で拒否する。
- 精算は JPY の振替取引にだけ紐づけられる。[割り勘と精算](./split-and-settlement.md) を参照。

換算レートは時点によって動くため、通貨をまたぐ移動をアプリ内で完結させると、どのレートで記録したのかが後から追えなくなる。
実際に両替した取引を入出金として記録するほうが、履歴として正しい。

# 関連

- [可処分残高とオフセット](./disposable-balance.md)
- [サブスク台帳](./subscription-ledger.md)
