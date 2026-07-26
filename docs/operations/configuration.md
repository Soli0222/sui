---
type: Reference
title: 設定と環境変数
description: バックエンドとフロントエンドが読む環境変数の一覧と既定値。
tags: [configuration, environment, deployment]
timestamp: 2026-07-26T00:00:00+09:00
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
| `SUI_OIDC_REDIRECT_URI` | コールバック URL（`/api/auth/callback`） | 未設定 |
| `SUI_OIDC_ALLOWED_SUBJECTS` | 許可する `sub` のカンマ区切り | 未設定 |
| `SUI_OIDC_ALLOWED_EMAILS` | 許可するメールアドレスのカンマ区切り | 未設定 |
| `SUI_COOKIE_SECURE` | セッション Cookie に `Secure` を強制する | `x-forwarded-proto` で自動判定 |
| `SUI_ALLOWED_ORIGINS` | CORS で許可する Origin のカンマ区切り | 空（許可なし） |
| `SUI_FRONTEND_URL` | 認証後のリダイレクト先。backend が SPA を配信する構成では不要 | 未設定 |

`SUI_OIDC_ALLOWED_SUBJECTS` と `SUI_OIDC_ALLOWED_EMAILS` は、少なくとも一方を設定する。
どちらも空だと OIDC 設定そのものが未構成として扱われ、ログインできない。
IdP で認証できる利用者が素通りする状態を既定にしないための扱いである。
`SUI_OIDC_ISSUER`、`SUI_OIDC_CLIENT_ID`、`SUI_OIDC_REDIRECT_URI` も同様に、欠けていれば未構成になる。

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
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP HTTP の送信先。未設定なら計装を起動しない | 未設定 |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | トレース専用の送信先。設定時はこちらを優先 | 未設定 |
| `OTEL_SERVICE_NAME` | サービス名 | `sui-backend` |

# 関連

- [可観測性](../architecture/observability.md)
- [複数通貨と JPY 換算](../concepts/multi-currency.md)
