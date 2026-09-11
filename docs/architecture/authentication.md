---
type: Architecture
title: 認証と信頼境界
description: OIDC セッション Cookie、API トークン、MCP OAuth access token の認証境界と Origin ガードの構成。
tags: [auth, security, backend]
generated: { by: codex/gpt-6, at: 2026-09-11T12:35:00Z }
---

# 概要

アプリ内に ID とパスワードは持たない。
持てば、その保管と更新の責任を負うことになる。

利用者の認証は外部 IdP に委ね、SPA は OIDC の Authorization Code + PKCE だけを使う。
バックエンドはコールバックを受けたあとに自前のセッション Cookie を発行し、以降の API 呼び出しはその Cookie で通す。
プログラムからの利用には、UI で発行する API トークンを使う。
ChatGPT のカスタム MCP アプリは、Auth0 が発行した MCP resource 向け access token でも `/mcp` に接続できる。

`client_secret` を持たない public client にも対応する。
その場合は PKCE が必須で、`SUI_OIDC_CLIENT_SECRET` は confidential client のときだけ設定する。

# 三つの資格情報

| | セッション | API トークン | MCP OAuth access token |
|---|---|---|---|
| 運び方 | Cookie `sui_session` | `Authorization: Bearer sui_tok_...` | `Authorization: Bearer <JWT>` |
| 発行 | OIDC コールバック | UI の設定画面 | Auth0 |
| 有効期限 | 作成から 90 日の絶対期限。利用時の延長は作成から 90 日を超えられない | 明示的に失効させるまで | JWT の `exp` まで |
| 読み取り専用 | 不可 | `readOnly` で指定できる | `read:sui` のみなら読み取り専用 |
| `/api/*` | 使える | 使える | 外部からは使えない |
| `/mcp` | 使えない | 使える | 使える |

どちらもトークン本体は保存しない。
SHA-256 のハッシュだけを保存し、照合はハッシュで行う。
OAuth access token と refresh token は保存しない。

MCP OAuth は `SUI_MCP_OAUTH_RESOURCE_URL` を設定した場合だけ有効になる。
UI と同じ `SUI_OIDC_ISSUER` の discovery と JWKS から RS256 署名、issuer、audience、期限、RFC 9068 の access-token claims を検証する。
利用者は verified email ではなく、検証済みの `iss` と `sub` が現在の `SUI_OIDC_ALLOWED_SUBJECTS` に一致するときだけ通る。
`read:sui` が MCP への入場に必須で、`write:sui` がなければ内部 API の状態変更メソッドを拒否する。

セッションの延長は最後の利用から 60 秒以上経ったときだけ書き込む。
リクエストのたびに更新すると、読み取り主体の操作でも書き込みが発生するためである。
API トークンの `lastUsedAt` も同じ間隔で間引いている。

セッションには OIDC issuer・subject・email を保存し、リクエストのたびに現在の `SUI_OIDC_*` 許可設定と再照合する。
許可リストや issuer が変わると、既存セッションは失効する。
email は IdP から `email_verified` が true として返されたときだけ保存・再照合に使う。
また、 `GET /api/auth/sessions` で自分のセッションを確認でき、 `DELETE /api/auth/sessions` で自分のセッションをすべて失効できる。

# ミドルウェアの順序

`/api/*` には次の順でミドルウェアが並ぶ。

1. **リクエスト ID とトレース**：`x-request-id` を採番し、サーバースパンを開始する。
2. **認証**：Bearer を先に見て、なければ Cookie を見る。どちらも通らなければ 401。読み取り専用トークンで `POST` / `PUT` / `PATCH` / `DELETE` を叩くと 403。MCP OAuth は外部の `/api/*` Bearer として受け付けず、MCP が同一 Hono アプリを呼ぶときだけ Request オブジェクトに結び付いた検証済み主体を受け取る。
3. **Origin ガード**：状態を変えるメソッドで、`Origin` が許可リストにもリクエストの `Host` にも一致しなければ 403。
4. **監査ログ**：状態を変えるメソッドが 2xx を返したときだけ記録する。認証主体（auth kind・subject・session/token ID・auth mode）も記録する。
5. **為替レート更新**：GET のときに、間隔を見て更新する。

認証が通る前に Origin を見ないのは、認証の失敗を 401 として素直に返すためである。
Origin ガードは認証の代わりではなく、認証済みの利用者のブラウザが第三者のページから操作させられる経路を塞ぐ、独立した層として置いている。

CORS は既定で許可オリジンなしである。
別オリジンの開発用フロントエンドから叩く場合だけ、`SUI_ALLOWED_ORIGINS` にカンマ区切りで指定する。

`GET /api/auth/status`、`GET /api/auth/login`、`GET /api/auth/callback` の三つだけが認証前に通る。

# 認証を切る

`SUI_AUTH_MODE=disabled` にすると、API も `/mcp` も認証をバイパスする。
この場合は MCP OAuth の設定検証や discovery を行わず、保護リソース metadata は 404 になる。
信頼境界の内側でしか使わない escape hatch であり、公開環境で使う想定はない。

リバースプロキシでの mTLS は、アプリの認証を置き換えるものではなく、追加の層として併用できる。

Auth0 で同意や refresh token を取り消しても、既に発行された自己完結型 JWT は `exp` まで有効な場合がある。
即時に止める場合は `SUI_OIDC_ALLOWED_SUBJECTS` から subject を外す。

# 関連

- [MCP エンドポイント](./mcp-endpoint.md)
- [設定と環境変数](../operations/configuration.md)
- [可観測性](./observability.md)
