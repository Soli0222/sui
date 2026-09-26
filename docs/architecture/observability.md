---
type: Architecture
title: 可観測性
description: OpenTelemetry トレース、通常ログ、監査イベントの役割と出力契約。
tags: [observability, otel, logging, audit]
generated: { by: codex/gpt-6, at: 2026-09-26T10:10:41Z }
---

# 概要

トレースは一つのリクエストの処理時間と経路を表し、OTLP で外部へ送る。通常ログは処理結果と所要時間を pino の JSON として標準出力へ書く。監査イベントは対象 HTTP リクエストの結果を独立した `event: "audit"` の JSON 行として標準出力へ書く。監査イベントの保存期間、検索、閲覧、アクセス権は Alloy の収集先で管理する。家計の業務履歴はそれぞれの業務データで管理する。

# トレース

`OTEL_EXPORTER_OTLP_ENDPOINT` か `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` が設定されているときだけ、SDK を起動する。未設定なら計装ごと動かない。`OTEL_SERVICE_NAME` の既定は `sui-backend` である。

アプリ側はこの二つを起動の可否にしか使わず、送信先の解決は `OTLPTraceExporter` に委ねる。SDK は `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` を優先し、こちらはそのまま、`OTEL_EXPORTER_OTLP_ENDPOINT` には `/v1/traces` を追記して使う。

自動計装は Prisma だけである。HTTP 側は `/api/*` のミドルウェアでスパンを張る。名前は `GET /api/accounts/:id` のようなルートパターン、属性はメソッド、パス、ルート、HTTP status を使う。例外と 5xx は `ERROR` とする。親コンテキストはリクエストヘッダから取り出す。

# 通常ログと監査イベント

pino は一行一 JSON を標準出力へ書く。有効なスパンがある行だけ `trace_id`、`span_id`、`trace_flags` を付ける。通常の `Request completed` 行にはメソッド、パス、ステータス、所要時間、`request-id`、認証種別を含める。通常ログのレベルは `SUI_LOG_LEVEL` で設定できる。

監査イベントは通常ログと独立した logger を使い、info を下限とする。したがって `SUI_LOG_LEVEL=warn`、`error`、`silent` でも監査対象の 2xx は出力する。2xx は info、4xx は warn、5xx は error で、`msg` は `Audit event`、`event` は `audit`、`schemaVersion` は整数 `1` とする。pino 標準の `time` は出力時刻の Unix epoch ミリ秒である。

対象は次の通り。

| HTTP リクエスト | 記録 |
|---|---|
| `/api/*` の POST/PUT/PATCH/DELETE の 2xx | 1 件 |
| `/api/*` の任意メソッドの 4xx/5xx | 1 件 |
| `/api/*` の成功 GET 等、3xx | なし |
| `/mcp` 入口の 4xx/5xx | 1 件 |
| `/mcp` の成功した通信、HTTP 200 内の JSON-RPC 失敗 | 入口ではなし |

MCP 内部 API に到達した変更や失敗は、内部 `/api/*` の規則に従い `clientSource=mcp` で記録する。認証、読み取り専用権限、Origin、MCP scope、セッション、レート制限による拒否も実際の HTTP status で判定する。

各行には `method`（最大 10 文字）、クエリを除いた `path`（制御文字を置換し最大 300 文字）、整数 `status`、`clientSource`、`requestId`、`authKind`、`authMode`、`subject`、`issuer`、`oauthClientId`、`sessionId`、`apiTokenId` を含める。該当しない認証フィールドは省略せず null とする。`clientSource` は `/mcp` では `mcp`、API では `x-sui-client` の `web` または `mcp`、それ以外は `unknown` とする。このヘッダは認証主体の証拠ではない。OAuth の情報は検証済み principal から取得する。

`x-request-id` は前後の空白を除いた最大 40 文字の制御文字を含まない値だけを受け入れ、それ以外は UUID を発行する。監査の `requestId` はレスポンスヘッダと一致する。API の監査イベントには有効なスパンがある場合だけ、完了前に取得した同じ trace/span ID を付ける。MCP 入口にスパンがなければ付けない。内部 API と入口の ID を同一にする必要はない。

Authorization、Cookie、トークン本体、OAuth code、JWT の `jti`、リクエスト・レスポンス本文、クエリ、生エラー本文は監査イベントへ渡さない。セッション ID と API トークン ID はサーバー側の識別子であり秘密値ではない。ログ出力が同期的に失敗しても元の HTTP 応答を変えない。

標準出力への書き込みは永続化や配送を保証しない。Alloy 停止やプロセスクラッシュで未収集になった行を sui から再取得する機能はない。収集側では監査イベントを除外・サンプリングせず、保存期間と閲覧権限を設定する。旧 DB 履歴の退避と適用手順は [監査ログ移行](../operations/audit-log-migration.md) を参照する。

# 関連

- [認証と信頼境界](./authentication.md)
- [設定と環境変数](../operations/configuration.md)
