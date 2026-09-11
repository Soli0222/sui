---
type: Architecture
title: MCP エンドポイント
description: backend に内包した /mcp の API トークン・OAuth 認証、セッション管理、内部 HTTP API 呼び出し。
tags: [mcp, backend, integration]
generated: { by: codex/gpt-6, at: 2026-09-11T12:35:00Z }
---

# 概要

MCP サーバーは独立したプロセスではない。
backend の `/mcp` として同じアプリの中で動く。
stdio 版と別プロセスの実装は廃止した。
backend が起動していれば、それだけで MCP としても使える。

```json
{
  "mcpServers": {
    "sui": {
      "type": "streamable-http",
      "url": "https://sui.example.com/mcp",
      "headers": { "Authorization": "Bearer sui_tok_..." }
    }
  }
}
```

# 認証

`/mcp` は Bearer トークンだけを受け付ける。
セッション Cookie では通らない。
ブラウザが自動で送る資格情報で MCP が動いてしまう状態を避けるためである。

トークンの検証、失効、読み取り専用フラグは、API の [認証](./authentication.md) と同じ仕組みを共有する。
`SUI_AUTH_MODE=disabled` のときは `/mcp` も認証をバイパスする。

`SUI_MCP_OAUTH_RESOURCE_URL` に公開 `/mcp` URL を設定すると、Auth0 access token も受け付ける。
`GET /.well-known/oauth-protected-resource/mcp` と互換用の `GET /.well-known/oauth-protected-resource` は、同じ resource、Auth0 issuer、`read:sui` / `write:sui` を公開する。
未認証の `/mcp` は `WWW-Authenticate` でこの metadata URL を案内する。
設定値は audience と challenge の正本でもあり、受信した Host や forwarded header から組み立てない。

OAuth を有効にするには、同じ Auth0 カスタムドメインの `SUI_OIDC_ISSUER` と、空でない `SUI_OIDC_ALLOWED_SUBJECTS` が必要である。
discovery と JWKS は遅延取得してキャッシュするため、Auth0 の一時障害はアプリ起動や API トークン経路を止めない。
JWT は RS256、issuer、audience、`at+jwt`、期限と RFC 9068 の必須 claim を検証する。
`read:sui` がなければ MCP の入口で 403、`write:sui` がなければ内部 API の更新で 403 になる。
Cookie、ID token、別 audience の access token は通らない。

# 自分自身を呼ぶクライアント

MCP のツール実装は Prisma を直接触らない。
`InProcessSuiApiClient` が Hono アプリの `request()` を呼び、自分自身の HTTP API を通す。

この構造には三つの効果がある。

- 検証、業務ルール、エラー整形が UI 経由と完全に一致する。
- 読み取り専用トークンの制約が、MCP 側で何もしなくても効く。認証ミドルウェアが 403 を返すからである。
- 監査ログに残る。クライアントは `x-sui-client: mcp` を付けるので、UI からの操作と区別できる。

API トークンでは、現在の MCP リクエストが提示したトークンを内部 API へ渡し、毎回 DB で失効と `readOnly` を確認する。
OAuth では、リクエスト単位の `AsyncLocalStorage` から検証済み主体を取得する。
API client が作った同一の `Request` オブジェクトだけを `WeakMap` の内部 bridge に登録し、親 Hono アプリの認証ミドルウェアへ渡す。
HTTP header や `x-sui-client` を内部認証には使わない。
内部 API 呼び出しのたびに JWT 期限と現在の subject 許可リストを再確認する。

この構造により、同一 MCP セッションへ read-only token と read+write token が同時に到着しても、各 API 呼び出しの権限はそのリクエストに閉じる。

# セッション

`mcp-session-id` ヘッダでセッションを識別し、トランスポートとサーバーのペアを保持する。
30 分間活動のないセッションは、5 分ごとの掃除で閉じる。

OAuth セッションの所有者は issuer、subject、client ID、resource の組で識別する。
access token、`jti`、scope は所有者キーに含めないため、Auth0 が access token を更新しても同じセッションを継続できる。
別 subject、別 client、別 resource、API トークンから同じ session ID を使うと 404 になる。
scope と期限はリクエストごとに新しい JWT から評価し、セッションへ保存しない。

セッション数には次の上限がある。上限に達すると 429 または 503 を返す。

- 全体の同時セッション数
- トークンごとの同時セッション数
- トークンごとの 1 分間リクエスト数
- トークンごとの同時接続数

上限は環境変数で調整できる。既定値は [設定と環境変数](../operations/configuration.md) を参照。

# 提供するもの

- ツール：ダッシュボード、口座、取引、予定収支、サブスク、カード、請求、ローン、割り勘、監査ログ。
- リソース：ダッシュボード、口座などのマスタ、サブスク、予測、取引。
- プロンプト：月次レポート、予算相談。

ID を引数に取るツール（`update_*`、`delete_*`）に対応する一覧ツールは、人間向けのテキストと合わせて ID を含む構造化データ（`structuredContent`）を返す。
リソースと resource template はクライアントによってモデルへ公開されないことがあり、ツールだけを見るエージェントが ID の取得経路を見つけられないためである。
取引の構造化データは口座オブジェクトなどを含めず、更新と削除に必要なフィールドだけにする。

予測イベントの確定はツールから呼べるが、金額と口座を人間が確認したうえで叩く前提は変わらない。
[予測イベント](../concepts/forecast-event.md) の確定の節を参照。

# 関連

- [認証と信頼境界](./authentication.md)
- [可観測性](./observability.md)


# 支出決裁のツール

`get_spending` は台帳、ID、最新version、予算計算、振替状態を返す。任意のmonthで表示対象月を指定できる。
`preview_spending_import` はfilename・base64・versionから月次CSVの差し替えをプレビューする。対象月・文字コードを自動判定し、空のCSVのみmonthを補足できる。
`update_spending` は同じAPIサービスで申請、購入、期間付き予算案、登録済み支払手段の紐づけ、取込確定等を行う。申請は一金額で、購入記録だけで完了する。MF実績や予算残額へ申請額を反映しない。旧予測調整・配賦操作は公開しない。
APIキーの登録と接続確認は管理UIから行い、MCPツール結果に秘密値を公開しない。
`review_spending` はAI審査、`override_spending` は理由付きの利用者例外承認である。
更新にはGETで得たversionを渡す。
AI審査そのものにMCP利用者の権限を渡すことはない。
補正予算の審査が承認されても、振替を確定する権限や操作は独立している。
