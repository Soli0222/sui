---
type: Domain Rule
title: スケジュールと営業日シフト
description: 月次と週次の発生日をどう展開し、土日祝に当たった日付をどちらへ寄せるかの規則。
tags: [schedule, forecast, business-day]
timestamp: 2026-07-26T00:00:00+09:00
---

# 概要

固定収支とサブスクは同じスケジュール定義を共有する。

```ts
interface Schedule {
  recurrence: "monthly" | "weekly";
  interval: number;
  dayOfMonth: number | null;
  dayOfWeek: number | null;   // 0=日曜
  startDate: string | null;
  endDate: string | null;
}
```

指定した年月に発生する日付を展開する関数が一つあり、月別集計も予測イベントの生成も、そこを通る。

# 月次

`dayOfMonth` の日にちをその月に当てはめる。
その月に存在しない日にちは、月末に丸める。
31 日締めの支払いは、2 月なら 28 日（閏年は 29 日）になる。

`interval` が 2 以上のときは `startDate` が必須で、開始月から数えて間隔の倍数に当たる月だけが発生する。
`startDate` がないまま `interval` を 2 以上にすると、発生日は一つも出ない。

# 週次

その月の該当曜日をすべて挙げる。
`interval` が 2 以上のときは `startDate` 以降で最初に該当曜日が来る日を起点にし、そこから間隔の倍数の週だけを残す。

週次は月に 4 回から 5 回発生するため、予測イベントの ID には月ではなく日付を使う。
詳細は [予測イベント](./forecast-event.md) の ID の表を参照。

# 営業日シフト

引き落としは土日祝には行われない。
`dateShiftPolicy` は、その日に当たったときにどちらへ寄せるかを決める。

- `none`：シフトしない。日付をそのまま使う。
- `previous`：直前の営業日まで遡る。
- `next`：直後の営業日まで進める。

営業日の判定は土日と日本の祝日で、`@holiday-jp/holiday_jp` を使う。
連休を跨ぐ場合は、営業日に当たるまで 1 日ずつ動かす。

シフトの結果が `startDate` より前、または `endDate` より後になった発生は捨てる。
月末の支払いを `next` で寄せると翌月に飛ぶことがあり、月初の支払いを `previous` で寄せると前月に落ちることがある。
予測イベントの生成が表示範囲の前後 1 か月まで候補を広げているのは、この越境を拾うためである。

# 適用されない場所

- クレジットカードの請求データに `settlementDate` が入っている月は、シフトせずその日付を使う。
- ローンの開始月の返済日はシフトしない。翌月以降だけがシフトの対象になる。

# 関連

- [クレジットカード請求の仮定値と実績](./credit-card-billing.md)
- [ローン返済の再計算](./loan-repayment.md)
