---
type: Guide
title: MCP クライアントの接続
description: API トークンと OAuth を使ったクライアント接続の手順。
sources:
  - resource: ../architecture/mcp-endpoint.md
generated: { by: codex/gpt-6, at: 2026-10-23T15:17:59Z }
---

# API トークンで接続する

[MCP (Model Context Protocol)](https://modelcontextprotocol.io/) エンドポイント `/mcp` を backend に内包しています。
UI の「設定」で API トークンを発行し、クライアントに URL と Bearer トークンを設定してください。

```json
{
  "mcpServers": {
    "sui": {
      "type": "streamable-http",
      "url": "https://sui.example.com/mcp",
      "headers": {
        "Authorization": "Bearer sui_tok_..."
      }
    }
  }
}
```

# OAuth で接続する

OAuth 対応の MCP クライアントから接続する場合は、外部 IdP に MCP resource とクライアントの受付設定を用意します。
Keycloak の標準アクセストークンを使う場合の例です。

```dotenv
SUI_AUTH_MODE=enabled
SUI_OIDC_ISSUER=https://keycloak.example.com/realms/sui
SUI_OIDC_ALLOWED_SUBJECTS=KeycloakのユーザーID
SUI_MCP_OAUTH_RESOURCE_URL=https://sui.example.com/mcp
```

`SUI_OIDC_ISSUER` は Web ログインと同じ issuer を指定します。
OAuth では verified email だけの許可は使わず、ユーザーの `sub` を `SUI_OIDC_ALLOWED_SUBJECTS` に含めます。
RFC 9068 形式と Keycloak の標準アクセストークン形式に対応し、IdP 専用の切替設定は不要です。
OAuth access token は sui に保存しません。
IdP 側で同意や refresh token を取り消した後も、発行済み JWT は期限まで有効な場合があります。即時停止する場合は subject を許可リストから除外してください。

接続手順は次のとおりです。

1. IdP で audience を公開 `/mcp` URL にし、`read:sui` と `write:sui` を設定します。必要な scope を要求できるよう、クライアントへの割当と discovery への公開を確認します。
2. CIMD または事前登録など、利用するクライアントの登録方式を IdP に設定します。
3. sui の issuer・許可 subject・resourceを設定します。IdP の変更時には Web と MCP で再ログインが必要です。
4. `GET /.well-known/oauth-protected-resource/mcp` の resource と issuer、無認証 `/mcp` の `WWW-Authenticate` を確認します。
5. クライアントの接続設定に公開 `/mcp` URL を指定し、IdP でログインして scope に同意します。ツール一覧と参照操作、読み取り専用時の更新拒否を確認します。
6. access token 更新後も操作できることを確認します。refresh token が失効した場合は再ログインします。

認可サーバーの discovery・token エンドポイントなど、クラウド側から接続される入口には利用者のクライアント証明書を必須にしません。
管理画面・管理 API は別ホストで mTLS などにより制限できます。

`/mcp` は Bearer トークンだけを受け付け、セッション Cookie は受け付けません。
stdio と独立 MCP サーバーは廃止しました。
詳細は [MCP エンドポイント](../architecture/mcp-endpoint.md) を参照してください。
