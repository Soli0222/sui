---
type: Operations
title: 支出決裁の検証と外部接続
description: 支出決裁の受け入れ条件、隔離テスト、MF実物形式確認、未検証のAI外部条件。
tags: [spending, testing, ai]
generated: { by: codex/gpt-6, at: 2026-09-06T10:29:37+00:00 }
status: draft
---

# 検証方針

テストはMakefile経由で実行する。
統合・E2Eは既存のスロット隔離ランナーを使い、利用中のDBにデータを投入しない。
テスト明細は架空の店名・金額・IDから作成する。
利用者が提示したMF CSVは構造確認のみで、リポジトリにもfixtureにも複製しない。

# 現在の受け入れ条件

初版A01〜A20のうち、通常予算の予約・将来予測・明細配賦・補正支出控除は、利用者合意のMF実績だけの予算管理に置き換えた。
現行ルールは[支出決裁](../concepts/spending-approval.md)を正とする。

| 条件 | 検証内容と箇所 |
| --- | --- |
| MFだけの予算実績 | 承認・購入記録・旧配賦・予定で実績と残額が変わらない。spending-core.test.ts、spending.integration.test.ts |
| 審査時の試算 | 未購入の今回通常申請だけをMF実績へ加算。購入済み再審査の追加額は0。他申請は参考情報。spending-core.test.ts |
| 過去3か月 | 対象月直前のMF実績と不足期間、単発を含む履歴。spending-core.test.ts |
| 一申請一金額 | amount/categoryのAPI入力、旧itemsの拒否、通常予算初期値、購入予定日を基本表示。spending.integration.test.ts、spending.spec.ts |
| 購入完了 | 購入記録時に完了し、MFの変更・削除・再取込から独立。訂正前の購入実額を履歴と復元で保持。spending.integration.test.ts、spending.spec.ts |
| MF月次取込 | 対象月推定、文字コード、引用符、不正行、安定ID、別購入の保持、差し替えと版競合。spending-core.test.ts、spending-budget.test.ts、spending.integration.test.ts |
| MFカテゴリと返金 | MF大項目を使用、振替・対象外・収入を除外、支出カテゴリの返金を減算。spending-core.test.ts |
| 補正予算 | 承認と単発振替の原子性、再送・並行承認、161,433→131,433→131,433の余力。spending.integration.test.ts |
| 購入と振替の独立 | 購入先・振替先の両順序、購入後取消の拘束解放、確定残高を自動復元しない。spending.integration.test.ts |
| 補正購入もMFに含める | 申請の資金区分でMF実績を減らさない。spending-core.test.ts、spending.integration.test.ts |
| 外部予定変更 | 予定編集・削除・実額差を既存取引から導出。spending.integration.test.ts、既存dashboard.integration.test.ts |
| AIと権限 | 不正・長文出力、数値制約、処理中更新で誤承認しない。共通APIのread-only。spending.integration.test.ts、spending-budget.test.ts、mcp/server.test.ts |
| 旧データと回帰 | 内訳・購入配列・配賦・審査履歴・振替をexport/replaceで保持。金額制約と従来機能。spending-core.test.ts、spending.integration.test.ts、既存テスト群 |
| 画面 | 一覧からダイアログ、購入完了、根拠・履歴をボタン表示、明細ビューアー、375pxの横はみ出し。spending.spec.ts |

# 外部AI接続

管理画面でOpenAI・Anthropic・その他を選び、APIキーを入力してモデル一覧から選択する。
その他の接続先では完全URLと通信方式を指定し、モデルIDの手入力も可能。
ローカルComposeは暗号化鍵の初期値を持つ。それ以外ではキー保存前にサーバーへ暗号化鍵を設定する。手順は[設定と環境変数](configuration.md)を参照。
「接続を確認」は架空の内容を送信して審査用JSONまで検証し、承認や資金移動は行わない。
実際のキー・接続先が未提供なら、モックによる成功を実接続成功とは扱わない。

# 運用上の確認

- 承認期限は日付単位。期限日を過ぎた未購入分をサーバーの期限処理で解放する。
- 補正予算の外部残高変動は照会時に再評価する。実際に行われた振替の記録は既存の確定処理に任せる。
- 集約の版競合は409。画面を再読込し、変わった内容を確認してから再送する。
- 審査処理中にサーバーが停止した場合、残った審査中申請を編集して再審査する。古い審査結果で自動承認しない。
- JSONB集約は個人利用を前提とする。全明細と審査スナップショットを保持するため、長期運用ではデータ量を確認する。

# 関連

- [支出決裁と独立予算台帳](../concepts/spending-approval.md)
- [開発の進め方](development.md)

# 実行結果（2026-09-06、MF実績分離の改修）

- `make test-unit`: Vitest 433件（shared 27、frontend 148、backend 258）とNodeの隔離ランナーテスト40件が成功。
- `make test-integration`: 隔離DBで269件が成功。
- `make test-e2e`: Chromiumで103件が成功。PCと375pxの申請・購入完了・明細画面をスクリーンショットで確認。
- `make lint`、`make typecheck`、`make build`: 成功。
- OKF v0.2 validator: 0 errors、0 warnings。

初回E2Eは並行したPrisma生成によるAPI再起動と、詳細設定をボタンで開く変更に未対応のテストで2件が失敗した。
テストの操作を修正し、生成処理を終えてからE2E全件を単独実行して成功した。
SDKを通す架空応答のテストとUIのモデル一覧・接続確認モックは、外部AI事業者との実接続確認を代替しない。
今回の実装作業では実際のAPIキーを使う外部審査は実行していない。

# 手動確認用seed

`seed.integration.test.ts`で`seed.sh spending`と`seed.sh phase1`を専用HTTPサーバー・隔離DBに対して実行する。
投入前export、4か月の架空CSV、期間付き予算、決裁設定、補正予算利用口座を確認する。
申請・旧予測予定・配賦が0件であり、再実行で版・口座数が変わらないことも検証する。
実物CSVや外部AIは使用しない。
