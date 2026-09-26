---
okf_version: "0.2"
---

# sui ナレッジバンドル

個人の資産を管理し、将来の可処分残高を予測する Web アプリケーション「sui」の知識バンドルである。
Open Knowledge Format (OKF) v0.2 に従い、概念ごとに 1 ファイルで置いている。

このバンドルには、業務規則と設計理由、操作手順、外部インタフェースの契約を置く。
サブスクを予測に入れない理由、予定日を過ぎた支払いを自動確定しない理由、割り勘を残高から切り離している理由は、いずれも実装からは読み取れない。

# 設計前提

四つの前提が、ほぼすべての規則の背後にある。

| 前提 | 要旨 |
|------|------|
| 口座残高を管理する | カード明細ではなく、カード払いは請求額として扱う |
| 二重計上を避ける | 別の形で残高に反映済みのものを予測へ足さない |
| 確定は人間が行う | 予定日超過でも自動確定しない |
| 記録を書き換えない | 差異は調整取引として残す |

# Subdirectories

* [ガイド](guides/) - アプリを使う人のための手順。初期セットアップと日々の運用。
* [ドメイン規則](concepts/) - 残高の数え方と、将来の収支をどう組み立てるかの規則。
* [アーキテクチャ](architecture/) - コードの配置、予測の組み立て、認証、外部連携、可観測性。
* [運用](operations/) - 開発環境、設定値、リリース手順。
* [リファレンス](references/) - API エンドポイントと MCP ツールの契約。
* [過去の記録](archive/) - 対象 commit を固定した監査・計測結果。

# Concepts

* [更新履歴](log.md) - このバンドルの変更履歴。

# 読む順序

アプリを使う立場なら、[初期セットアップ](guides/getting-started.md) から [日々の運用](guides/daily-workflow.md) へ進む。

数値の意味を知りたい場合は、[可処分残高とオフセット](concepts/disposable-balance.md) から [予測イベント](concepts/forecast-event.md) へ。
実装に手を入れるなら、続けて [残高予測パイプライン](architecture/forecast-pipeline.md) と [開発の進め方](operations/development.md) を見る。

MCP の接続は [接続ガイド](guides/mcp-connection.md)、テスト追加は [テストの書き方](operations/testing.md) を参照する。
文書を変更する場合は [文書の保守](operations/documentation.md) で正本と検証方法を確認する。
製品概要と代表機能は [README](../README.md) にある。
