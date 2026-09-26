---
type: Playbook
title: MCP の拡張手順
description: API との対応契約、ツール追加時の更新先と検証。
sources:
  - resource: ../../packages/backend/src/mcp/api-parity.ts
generated: { by: codex/gpt-6, at: 2026-09-26T09:58:58Z }
---

# API と MCP の対応契約

[api-parity.ts](../../packages/backend/src/mcp/api-parity.ts) は Hono に登録された `METHOD /api/path` ごとに公開ツールを指定する。
契約テストは実際の `createApp().routes` と照合し、未登録の API 操作、削除されたツール、未記載のツールを検出する。
例外は `/api/auth` のブラウザ専用操作で、各ルートを個別に記す。新しいルートをプレフィックスで自動除外しない。

API 入力は `schemas/`、API/MCP で意味が共通する項目制約は `schemas/fields.ts` に置く。
MCP 経由の実行テストでも入力と権限を確認する。
金額の int32 上限は API で判定し、範囲外でも構造化された HTTP 400 エラーを返す。

# API の入力を変更するとき

全 API ルート、backend の schemas・lib・services、shared のソースの fingerprint で、入力処理の変更を検出する。
これは再審査を求めるための変更検知で、意味的同等性を証明するものではない。

1. 入力項目、既定値、列挙値、クエリ処理の変更に対応するツールを確認する。
2. MCP の入力と内部 API への転送が同じ意味を保っているか確認する。
3. `node scripts/update-mcp-api-input-fingerprints.mjs` を実行する。
4. 表示された変更ファイルと fingerprint 差分をレビューする。

# 新しいツールを追加するとき

1. 共通登録ヘルパーを使い、`contracts.ts` に出力スキーマを追加する。ID とコレクションの公開キーを必須にし、追加のドメインフィールドを許す。
2. `textContent` に必ず DTO を渡す。JSON を別に組み立てない。API エラーを成功文に変えない。
3. ID 引数に取得元のツールとフィールドを記載し、現行値が不足する場合はツールで取得する経路を用意する。resource の公開を前提にしない。
4. [ツール一覧](../references/mcp-tools.md)と[API 一覧](../references/api-endpoints.md)を更新する。登録一覧、出力スキーマ登録簿、表の対応は `contracts.test.ts` で照合する。
5. 空一覧、同名対象、ページング、外貨、HTTP の失敗を検証する。structuredContent と text JSON の一致、および先行結果から次操作へ渡すテストを加える。

関連するカード期間・金額履歴・監査ログも、この契約を適用する。

`make docs-check` で一覧と対応表を照合し、`make test-unit` で実際の登録と応答契約を確認する。API/DB を通る変更は `make test-integration` でも確認する。
