---
type: Guide
title: MCP クライアントの接続
description: API トークンと OAuth を使ったクライアント接続の手順。
sources:
  - resource: ../architecture/mcp-endpoint.md
generated: { by: codex/gpt-6, at: 2026-09-26T09:58:58Z }
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

ChatGPT のカスタム MCP アプリから URL だけで接続する場合は、Auth0 に MCP resource とクライアントを登録したうえで、次を設定します。

```dotenv
SUI_AUTH_MODE=enabled
SUI_OIDC_ISSUER=https://auth.example.com
SUI_OIDC_ALLOWED_SUBJECTS=auth0|既存ユーザーのsubject
SUI_MCP_OAUTH_RESOURCE_URL=https://sui.example.com/mcp
```

`SUI_OIDC_ISSUER` は UI と同じ Auth0 カスタムドメインを指定します。
OAuth では verified email だけの許可は使わず、既存 UI ユーザーの `sub` を `SUI_OIDC_ALLOWED_SUBJECTS` に含める必要があります。
有効化すると `/.well-known/oauth-protected-resource/mcp` が Auth0 を案内し、`read:sui` は参照、`write:sui` は更新を許可します。
OAuth access token は sui に保存しません。
Auth0 側で同意や refresh token を取り消した後も、発行済み JWT は期限まで有効な場合があります。即時停止する場合は subject を許可リストから除外してください。

接続手順は次のとおりです。

1. Auth0 で MCP resource の audience を公開 `/mcp` URL にし、`read:sui` と `write:sui`、ChatGPT 用 CIMD client grant を設定します。
2. 既存 UI ユーザーの `sub` を `SUI_OIDC_ALLOWED_SUBJECTS` に追加し、上記の環境変数を設定して sui をデプロイします。
3. `GET /.well-known/oauth-protected-resource/mcp` が同じ resource と Auth0 issuer を返し、無認証の `/mcp` がその metadata URL を `WWW-Authenticate` で案内することを確認します。
4. ChatGPT の開発者モードでカスタム MCP アプリを作り、公開 `/mcp` URL だけを登録します。API トークン、Client ID、Client Secret は入力しません。
5. 表示された Auth0 画面で既存ユーザーのパスキーを使ってログインし、scope に同意した後、ツール一覧と参照操作を確認します。
6. access token 更新後も同じ接続で操作できることを確認します。refresh token が失効した場合は再ログインします。

`/mcp` は Bearer トークンだけを受け付け、セッション Cookie は受け付けません。
stdio と独立 MCP サーバーは廃止しました。
詳細は [MCP エンドポイント](../architecture/mcp-endpoint.md) を参照してください。
