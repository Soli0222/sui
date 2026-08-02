---
type: Reference
title: 設定と環境変数
description: バックエンドとフロントエンドが読む環境変数の一覧と既定値。
tags: [configuration, environment, deployment]
timestamp: 2026-08-02T00:00:00+09:00
---

# 基本

| 変数名 | 説明 | 既定 |
|--------|------|------|
| `DATABASE_URL` | PostgreSQL 接続文字列 | 必須 |
| `PORT` | バックエンドのポート | `3000` |
| `STATIC_DIR` | 配信する静的ファイルのパス | `../frontend/dist` |
| `VITE_API_BASE` | フロントエンドから見た API のベース URL | `http://localhost:3000` |
| `SUI_LOG_LEVEL` | pino のログレベル | `info` |

# 認証

| 変数名 | 説明 | 既定 |
|--------|------|------|
| `SUI_AUTH_MODE` | `enabled` / `disabled` | `enabled` |
| `SUI_OIDC_ISSUER` | IdP の issuer URL | 未設定 |
| `SUI_OIDC_CLIENT_ID` | クライアント ID | 未設定 |
| `SUI_OIDC_CLIENT_SECRET` | クライアントシークレット。confidential client のときだけ設定する | 未設定 |
| `SUI_OIDC_REDIRECT_URI` | コールバック URL。`https://sui.example.com/api/auth/callback` のようにスキームとホストを含む絶対 URL で書き、IdP に登録した値と完全に一致させる | 未設定 |
| `SUI_OIDC_ALLOWED_SUBJECTS` | 許可する `sub` のカンマ区切り | 未設定 |
| `SUI_OIDC_ALLOWED_EMAILS` | 許可するメールアドレスのカンマ区切り | 未設定 |
| `SUI_COOKIE_SECURE` | セッション Cookie と HSTS の `Secure` / HTTPS 判定を強制する | `x-forwarded-proto` で自動判定 |
| `SUI_ALLOWED_ORIGINS` | CORS で許可する Origin のカンマ区切り | 空（許可なし） |
| `SUI_FRONTEND_URL` | 認証後のリダイレクト先。backend が SPA を配信する構成では不要 | 未設定 |

## セキュリティヘッダー

すべての応答に `X-Content-Type-Options: nosniff` と `Content-Security-Policy: frame-ancestors 'none'` を付ける。
HTTPS と判定された場合は `Strict-Transport-Security` も付ける。
API トークン発行応答には `Cache-Control: no-store` を付ける。

## MCP

| 変数名 | 説明 | 既定 |
|--------|------|------|
| `SUI_MCP_MAX_SESSIONS` | 全体の同時 MCP セッション数上限 | `1000` |
| `SUI_MCP_MAX_SESSIONS_PER_TOKEN` | 1 トークンあたりの同時セッション数上限 | `10` |
| `SUI_MCP_MAX_REQUESTS_PER_MINUTE` | 1 トークンあたりの 1 分間リクエスト数上限 | `120` |
| `SUI_MCP_MAX_CONCURRENT_REQUESTS` | 1 トークンあたりの同時接続数上限 | `10` |

`SUI_OIDC_ALLOWED_SUBJECTS` と `SUI_OIDC_ALLOWED_EMAILS` は、少なくとも一方を設定する。
どちらも空だと OIDC 設定そのものが未構成として扱われ、ログインできない。
IdP で認証できる利用者が素通りする状態を既定にしないための扱いである。
`SUI_OIDC_ISSUER`、`SUI_OIDC_CLIENT_ID`、`SUI_OIDC_REDIRECT_URI` も同様に、欠けていれば未構成になる。

`SUI_OIDC_REDIRECT_URI` のパス部分は `/api/auth/callback` で固定である。
ここにパスだけを書くと、未構成にはならずログインの開始までは通り、コールバックの検証だけが失敗する。
公開している URL のスキームとホストを必ず前に付ける。

`SUI_AUTH_MODE=disabled` の意味は [認証と信頼境界](../architecture/authentication.md) を参照。

# 為替レート

| 変数名 | 説明 | 既定 |
|--------|------|------|
| `SUI_EXCHANGE_RATE_API_BASE_URL` | 取得先のベース URL | `https://api.frankfurter.dev/v2` |
| `SUI_EXCHANGE_RATE_REFRESH_INTERVAL_MS` | 再取得までの最小間隔 | `300000` |
| `SUI_EXCHANGE_RATE_REQUEST_TIMEOUT_MS` | 1 リクエストのタイムアウト | `5000` |

# トレース

| 変数名 | 説明 | 既定 |
|--------|------|------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP HTTP のベース URL。`http://collector:4318` のようにパスなしで書き、`/v1/traces` は付けない | 未設定 |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | トレース専用の送信先。`http://collector:4318/v1/traces` のようにパスまで含めて書く | 未設定 |
| `OTEL_SERVICE_NAME` | サービス名 | `sui-backend` |

この二つは**どちらか一方だけ**を設定する。
両方が設定されている場合は `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` が使われ、`OTEL_EXPORTER_OTLP_ENDPOINT` は読まれない。
どちらも未設定なら計装そのものを起動しない。

二つの違いは、パスを補完するかどうかである。
`OTEL_EXPORTER_OTLP_ENDPOINT` は SDK が末尾に `/v1/traces` を追記するため、ベース URL を書く。
ここにパスまで書くと送信先が `http://collector:4318/v1/traces/v1/traces` になり、送信は失敗する。
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` は補完せずそのまま使うため、`/v1/traces` を自分で書く。

コレクタが標準のパスで受けるなら `OTEL_EXPORTER_OTLP_ENDPOINT` だけでよい。
トレースを別の送信先や非標準のパスへ送るときに `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` を使う。

# 監査ログ

| 変数名 | 説明 | 既定 |
|--------|------|------|
| `SUI_AUDIT_LOG_RETENTION_DAYS` | 監査ログを保持する日数。`0` で自動削除を無効化（無期限保持） | `365` |

正の整数以外を指定すると、安全な既定値 `365` に戻し、構造化 warning ログを出す。
クリーンアップはアプリ起動直後に一度、その後 24 時間ごとに実行する。

# 関連

- [可観測性](../architecture/observability.md)
- [複数通貨と JPY 換算](../concepts/multi-currency.md)
