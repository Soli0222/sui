---
type: Domain Rule
title: ローン返済の再計算
description: 返済総額と回数から毎月の返済額を求め、確定済みの返済実績に応じて残りを組み直す規則。
tags: [loan, forecast]
generated: { by: human:soli, at: 2026-07-26T00:00:00+09:00 }
---

# 概要

ローンには返済総額 `totalAmount`、返済回数 `paymentCount`、開始日 `startDate` を登録する。
月々の返済額は保存しない。
残額を残回数で割った値を、毎回その場で計算する。

```
amount = ceil(remainingBalance / remainingPayments)
```

端数は切り上げなので、序盤の回が数円多く、最終回で吸収される。
30 万円を 7 回で返すなら、42858 円が 6 回続いて最後が 42852 円になる。

# 実績を織り込む

残額と残回数は、確定済みの取引から逆算する。
`forecastEventId` が `loan:<ローン id>:<YYYY-MM>` の形をした取引を集め、金額の合計を返済済み額、月の集合を返済済みの回数とみなす。

```
remainingBalance = max(totalAmount - 返済済み額, 0)
remainingPayments = max(paymentCount - 返済済みの月数, 0)
```

繰上返済で多めに払った月があれば、次回以降の予測額はその場で下がる。
逆に予定より少なく確定した月があれば、残りに上乗せされる。
返済額を保存せず毎回割り直しているのは、この追従のためである。

残額か残回数のどちらかが 0 になった時点で、以降のイベントは生成しない。

# 生成しない場合

- `paymentMethod` が `credit_card` のローンは、予測イベントを一つも生成しない。返済がカード請求に含まれており、[カード請求](./credit-card-billing.md)として既に数えられているからである。
- 開始月より前の月は飛ばす。
- 既に確定済みの月は飛ばす。

# 返済日

返済日は開始日の日にちを毎月に当てはめて決める。
開始月だけは営業日シフトを適用せず、`startDate` をそのまま使う。
翌月以降はローンの `dateShiftPolicy` に従う。

# スナップショット

`getLoanSnapshot` は同じ計算から、残額、残回数、次回返済額の三つを返す。
ローン一覧の表示はこの値を使う。

# 関連

- [予測イベント](./forecast-event.md)
- [スケジュールと営業日シフト](./schedule-and-business-day.md)
