---
type: Domain Rule
title: 給与台帳
description: 給与明細を額面・控除内訳つきで記録し、残高予測や口座残高から独立させる理由と導出値の定義。
tags: [salary, ledger, forecast, design-decision]
timestamp: 2026-08-02T00:00:00+09:00
---

# 概要

給与明細は「手取りだけ」ではなく、額面（総支給額）と社会保険料・税・その他控除の内訳として記録する。

この台帳は残高予測や口座残高には一切影響しない。サブスク台帳と同様の独立台帳であり、予測パイプラインに混ぜると二重計上や目的を超えた複雑化を招くため切り離している。

# 独立台帳である理由

- 額面は「収入」であり、実際に口座に入る金額（手取り）とは一致しない。
- 控除はすでに取引や予定収支として別の形で管理している可能性がある。給与台帳を予測に組み込むと、同じ資金移動を複数回数えるリスクがある。
- ふるさと納税シミュレーションなどでは、額面と社会保険料合計を入力データとして参照するが、それは「台帳の閲覧」であり、予測イベントへの組み込みではない。

# 記録項目

| 項目 | 意味 |
|------|------|
| `paidOn` | 支給日。年フィルタと集計はこの暦年で行う |
| `kind` | `salary`（月給）または `bonus`（賞与） |
| `name` | 任意の名称（例：「夏季賞与」） |
| `grossAmount` | 総支給額（額面）。課税支給額に含まれるもの（持株会奨励金など）を加えた額を入れる。0 も許可する |
| `healthInsurance` | 健康保険料 |
| `pensionInsurance` | 厚生年金保険料 |
| `employmentInsurance` | 雇用保険料 |
| `childcareSupportLevy` | 子ども・子育て支援金 |
| `incomeTax` | 源泉所得税 |
| `residentTax` | 住民税 |
| `employeeStockContribution` | 持株会拠出金 |
| `employeeStockIncentive` | 持株会奨励金の控除分。奨励金は給与所得として `grossAmount` に含まれ、同額が持株会への拠出として控除される |
| `dcMatchingContribution` | DC マッチング拠出金 |
| `otherDeductions` | 財形貯蓄・組合費などその他控除 |

金額項目は通貨の最小単位の整数（JPY は円単位）で保持し、int32 の範囲を超える値は拒否する。

# 導出値

データベースには保存せず、サーバー側で一貫して導出してレスポンスに含める。

- `socialInsuranceTotal = healthInsurance + pensionInsurance + employmentInsurance + childcareSupportLevy`
- `deductionTotal = socialInsuranceTotal + incomeTax + residentTax + employeeStockContribution + employeeStockIncentive + dcMatchingContribution + otherDeductions`
- `netAmount = grossAmount − deductionTotal`

子ども・子育て支援金の被保険者負担分は、健康保険法上、健康保険料の一部として徴収される。社会保険料控除の対象になるため `socialInsuranceTotal` に含め、ふるさと納税シミュレーションの社会保険料見込みにも反映する。事業主のみが負担する従来の「子ども・子育て拠出金」とは別制度であり、混同しない。

DC マッチング拠出金は小規模企業共済等掛金控除であり社会保険料控除ではないため、`socialInsuranceTotal` には含めない。ふるさと納税シミュレーションで所得控除に算入する場合は「その他の所得控除」の入力欄を使う。

持株会奨励金は給与所得として課税支給額に含まれ、奨励金を含む持株会拠出額が控除される。したがって `grossAmount` には奨励金を含めた総支給額を入力する。給与明細で奨励金が独立した支給欄として表示されるかは会社や給与システムによるが、表示されない場合でも課税支給額には含まれている。

`netAmount` が負になっても許可する。控除合計が額面を超える記録はありうるため、切り上げや丸めは行わない。

# 集計

年フィルタは `paidOn` の暦年で行う。1 月から 12 月までの `grossAmount`・`deductionTotal`・`netAmount` をそれぞれ合計して表示する。

明細一覧では `socialInsuranceTotal` も列として残す。ふるさと納税の控除上限計算では社会保険料が主要な入力になるため、控除額合計だけに畳まない。

同一月に複数レコードがあっても合計に加える。賞与などを含めるため、月次への按分は行わない。

# 関連

- [サブスク台帳](./subscription-ledger.md) — 同様の独立台帳
- [残高予測パイプライン](../architecture/forecast-pipeline.md)
