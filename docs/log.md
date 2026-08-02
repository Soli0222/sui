# Directory Update Log

## 2026-08-02

* **Update**: [認証と信頼境界](architecture/authentication.md) を更新。OIDC セッションの issuer / subject / email 保存、リクエストごとの許可再照合、90 日の絶対有効期限、セッション一覧・失効エンドポイントを反映。
* **Update**: [MCP エンドポイント](architecture/mcp-endpoint.md) を更新。同時セッション数、トークンごとの上限、リクエストレート、同時接続数の制限を記載。
* **Update**: [設定と環境変数](operations/configuration.md) を更新。セキュリティヘッダーと MCP 環境変数を追加。
* **Update**: [API エンドポイント一覧](references/api-endpoints.md) を更新。`/api/auth/sessions` と監査ログの主体情報を反映。
* **Update**: `README.md` の Docker Compose 記述を修正（ローカル開発用、127.0.0.1 バインド）。
* **Scope**: 2026-08-02 コードレビューで指摘された認証・監査・MCP・セキュリティヘッダー・ローカル開発構成に関する変更。

## 2026-07-26
* **Creation**: OKF バンドルを新設。ドメイン規則 9 件、アーキテクチャ 5 件、運用 3 件を追加した。
* **Addition**: ガイド 2 件（初期セットアップ、日々の運用）と API エンドポイント一覧を追加し、README から詳細を移した。
* **Scope**: 割り勘とメンバー管理、トレース計装の導入までを反映している。
