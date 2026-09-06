---
type: Operations
title: 支出決裁の検証と外部接続
description: 支出決裁の受け入れ条件、隔離テスト、MF実物形式確認、未検証のAI外部条件。
tags: [spending, testing, ai]
generated: { by: codex/gpt-6, at: 2026-09-06T04:18:52+00:00 }
status: draft
---

# 検証方針

テストはMakefile経由で実行する。
統合・E2Eは既存のスロット隔離ランナーを使い、利用中のDBにデータを投入しない。
テスト明細は架空の店名・金額・IDから作成する。
利用者が提示したMF CSVは構造確認のみで、リポジトリにもfixtureにも複製しない。

# 受け入れ条件との対応

| 条件 | 実装と検証箇所 |
| --- | --- |
| A01 | 未設定の案内、閾値以上の対象表示。spending.integration.test.tsとspending.spec.ts |
| A02 | 対象月の直前3か月を計算。spending-core.test.ts |
| A03 | 月別固定予定、単発分類、確認済み月の変動費基準。spending-core.test.ts |
| A04 | 通常決裁・購入・配賦で既存取引等を変更しない。spending.integration.test.ts |
| A05 | 50,000円予算に対する2,000円超過の計算例。spending-core.test.ts |
| A06 | 予定充当をF→Q→R→Aへ移す計算。spending-core.test.ts |
| A07 | ファイルハッシュと安定ID、重複候補の解決。spending-core.test.tsとspending.integration.test.ts |
| A08 | 不正行・不足列・未確認日・未対応カテゴリの表示と保留。spending-core.test.tsとspending.spec.ts |
| A09 | 部分配賦上限、解除後の反映済み帰属、変更明細版の要確認。spending-core.test.tsとspending.integration.test.ts |
| A10 | 承認と単発予定の同一トランザクション、再審査で同じ関連予定を更新。spending.integration.test.ts。営業日シフトによる単発イベント数は既存forecast-core.test.tsも対象 |
| A11 | 161,433→131,433→131,433の補正予算余力。spending.integration.test.ts |
| A12 | 並行承認を集約ロックとSerializableで制御。spending.integration.test.ts |
| A13 | 既存の手動振替確定、二重確定拒否、実残高更新。spending.integration.test.tsと既存dashboard.integration.test.ts |
| A14 | MF先・振替先の両順序で状態を独立に保持。spending.integration.test.ts |
| A15 | 補正予算配賦を通常支出から除外し、全体実績には保持。spending-core.test.tsとspending.integration.test.ts |
| A16 | 未確定取消で拘束を解放、確定後取消で残高を復元しない。spending.integration.test.ts |
| A17 | 関連予定編集・実額差を確定取引から導出。spending.integration.test.ts。既存APIの確定取引削除禁止を維持 |
| A18 | AI不正出力、数値超過、AI待ち中の更新を保留。spending.integration.test.ts。外部AIの実接続は下記の別条件 |
| A19 | APIとMCPのin-process clientに同じread-only制約。spending.integration.test.ts。ツール公開はmcp/server.test.ts |
| A20 | 新マイグレーション、台帳と振替関連のexport/replace復元、従来API回帰。spending.integration.test.tsと既存テスト群 |

# 外部AI接続

管理画面のAI設定は特定事業者に固定しない。
Chat Completions互換のJSON応答またはAnthropic Messages形式を選べる。
エンドポイントはAPIパスを含む完全なURLを指定する。
認証情報はサーバー環境変数 `SUI_SPENDING_AI_...` に設定し、その変数名だけを画面に入力する。

AI接続先・モデル・認証環境変数が未提供の場合、実際の事業者への接続成功を検証済みとはしない。
テストでは架空のAI応答を使って入出力のスキーマ、障害処理、並行更新防止を検証する。
実接続の確認には、利用者が選んだ接続先に対して架空申請で審査を実行し、モデル名と審査履歴を確認する必要がある。

# 運用上の確認

- 承認期限は日付単位。期限日を過ぎた未購入分をサーバーの期限処理で解放する。
- 補正予算の外部残高変動は照会時に再評価する。実際に行われた振替の記録は既存の確定処理に任せる。
- 集約の版競合は409。画面を再読込し、変わった内容を確認してから再送する。
- 審査処理中にサーバーが停止した場合、残った審査中申請を編集して再審査する。古い審査結果で自動承認しない。
- JSONB集約は個人利用を前提とする。全明細と審査スナップショットを保持するため、長期運用ではデータ量を確認する。

# 関連

- [支出決裁と独立予算台帳](../concepts/spending-approval.md)
- [開発の進め方](development.md)

# 実行結果（2026-09-06）

公式SDKを実際に通し、架空のHTTP応答で両通信形式のURL・認証・モデル、45秒期限、再試行なし、応答上限を検証した。
このテストは外部事業者との実接続確認を代替しない。

- `make test-unit`: Vitest 429件（shared 27、frontend 148、backend 254）と隔離ランナーのNodeテスト40件が成功。
- `make test-integration`: 隔離DBで260件が成功。
- `make test-e2e`: Chromiumで102件が成功。
- `make lint`、`make typecheck`、`make build`: 成功。
- OKF v0.2 validator: 0 errors、0 warnings。

E2Eの初回には、実装中の開発サーバー再起動と重なった2件の失敗があった。
SDK移行時も依存関係更新中に予定収支APIへの接続拒否で2件が失敗し、更新完了後に全件を再実行した。
外部AI事業者との実接続は、接続設定・認証情報が未提供のため未検証である。
