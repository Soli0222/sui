# 運用

開発、テスト、外部連携、リリースと文書保守の手順をまとめる。

# Concepts

* [開発の進め方](development.md) - 開発専用 DB、シード、Makefile の実行コマンド。
* [テストの書き方](testing.md) - 責任分担、共通時計、worker fixture。
* [テスト隔離環境の管理と復旧](test-isolation.md) - slot の所有権と異常終了時の復旧。
* [MCP の拡張手順](mcp-development.md) - API 対応表、出力契約と追加時の検証。
* [CI と依存更新](ci.md) - 実行権限、結果の通知、依存更新の制限。
* [設定と環境変数](configuration.md) - バックエンドとフロントエンドが読む環境変数の一覧と既定値。
* [リリース](release.md) - Release workflow の実行手順と Docker での起動。
* [支出決裁廃止のデータ移行](spending-removal-migration.md) - 旧環境の更新時に必要な退避・移行・復元。
* [文書の保守](documentation.md) - 文書の正本、更新方法と自動検証。
