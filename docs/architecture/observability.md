---
type: Architecture
title: 可観測性
description: OpenTelemetry トレース、構造化ログ、監査ログの三つの記録先と、それぞれの役割。
tags: [observability, otel, logging, audit]
timestamp: 2026-07-26T00:00:00+09:00
---

# 概要

記録先は三つある。
用途が違うので、統合していない。

- **トレース**：一つのリクエストが何にどれだけ時間を使ったか。OTLP で外部へ送る。
- **構造化ログ**：何が起きたか。pino で標準出力へ。
- **監査ログ**：誰がどのデータを変えたか。データベースの `audit_logs` テーブルへ。

# トレース

`OTEL_EXPORTER_OTLP_ENDPOINT` か `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` が設定されているときだけ、SDK を起動する。
未設定なら計装ごと動かない。
`OTEL_SERVICE_NAME` の既定は `sui-backend` である。

自動計装として入れているのは Prisma だけで、HTTP 側は `/api/*` のミドルウェアで自前にスパンを張っている。
ESM で読み込むと HTTP の自動計装が効かなかったためである。

スパンには次を付ける。

- 名前：`GET /api/accounts/:id` の形。ルートパターンが取れる場合はそれを使う。
- 属性：`http.request.method`、`url.path`、`http.route`、`http.response.status_code`。
- 状態：例外を捕まえたときと 5xx のときに `ERROR`。

例外が飛んだ場合も `finally` でスパンを閉じる。
親コンテキストはリクエストヘッダから伝播を取り出すので、リバースプロキシから続くトレースがつながる。

# 構造化ログ

pino の `mixin` で、有効なスパンがあるときだけ `trace_id`、`span_id`、`trace_flags` を各行に混ぜる。
計装が無効なときは、これらのキー自体が出ない。
無効な値が入った行を後段で拾ってしまうのを避けるためである。

リクエスト完了時に、メソッド、パス、ステータス、所要時間、リクエスト ID、認証の種別を 1 行出す。
レベルは `SUI_LOG_LEVEL` で変えられる。
テスト実行時は `silent` に落ちる。

# 監査ログ

状態を変えるメソッドが 2xx を返したときだけ、メソッド、パス、ステータス、クライアント種別、リクエスト ID を記録する。
クライアント種別は `x-sui-client` ヘッダから取り、`mcp` と `web` 以外は `unknown` に丸める。

記録に失敗しても本体のリクエストは失敗させない。
エラーログを残して処理を続ける。
監査の欠落より、操作そのものが通らないほうが困るという判断である。

`x-request-id` はレスポンスヘッダにも返すので、監査ログの行からトレースとアプリログを辿れる。

# 関連

- [認証と信頼境界](./authentication.md)
- [設定と環境変数](../operations/configuration.md)
