# Directory Update Log

## 2026-08-02

* **Creation**: [給与台帳](concepts/salary-ledger.md) を追加。給与明細を独立台帳として残高予測に影響せず記録し、導出値の定義を記載。
* **Creation**: [ふるさと納税寄付台帳](concepts/furusato-tax.md) を追加。寄付を独立台帳として残高予測や口座残高に影響せず記録し、暦年で集計する設計を記載。将来の控除シミュレーション（Issue #408）への接続を予告。
* **Update**: [ふるさと納税寄付台帳](concepts/furusato-tax.md) に給与・寄付実績を使う控除上限シミュレーション、計算式、対象外事項、税制定数の保守方針を追加。
* **Update**: [ドメイン規則の索引](concepts/index.md) と [API エンドポイント一覧](references/api-endpoints.md) に `/api/salary-records`・`/api/donations` と給与台帳・ふるさと納税寄付台帳へのリンクを追加。

* **Update**: [認証と信頼境界](architecture/authentication.md) を更新。OIDC セッションの issuer / subject / email 保存、リクエストごとの許可再照合、90 日の絶対有効期限、セッション一覧・失効エンドポイントを反映。email は `email_verified` があるときだけ保存する旨を追記。絶対有効期限を 90 日に統一。
* **Update**: [MCP エンドポイント](architecture/mcp-endpoint.md) を更新。同時セッション数、トークンごとの上限、リクエストレート、同時接続数の制限を記載。
* **Update**: [設定と環境変数](operations/configuration.md) を更新。isolated test runner の環境変数（`SUI_TEST_SLOT`、`SUI_TEST_LOCK_DIR`、`SUI_TEST_LOCK_PORT_BASE` など）と slot から導出されるポート・project 名を追加。
* **Update**: [開発の進め方](operations/development.md) を更新。slot ベースの並列セーフなテスト実行、固定 slot 操作、クリーンアップ境界、ハードクラッシュ後の復旧手順を反映。
* **Update**: [API エンドポイント一覧](references/api-endpoints.md) を更新。`/api/auth/sessions` と監査ログの主体情報を反映。
* **Update**: `README.md` の Docker Compose 記述を修正（ローカル開発用、127.0.0.1 バインド）。
* **Scope**: 2026-08-02 コードレビューで指摘された認証・監査・MCP・セキュリティヘッダー・ローカル開発構成に関する変更。

## 2026-07-26
* **Creation**: OKF バンドルを新設。ドメイン規則 9 件、アーキテクチャ 5 件、運用 3 件を追加した。
* **Addition**: ガイド 2 件（初期セットアップ、日々の運用）と API エンドポイント一覧を追加し、README から詳細を移した。
* **Scope**: 割り勘とメンバー管理、トレース計装の導入までを反映している。
