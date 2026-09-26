---
type: Playbook
title: 監査ログの標準出力移行
description: 旧 audit_logs の退避、監査イベントの収集確認、停止更新と復旧。
tags: [release, audit, migration]
sources:
  - resource: ../../packages/db/prisma/migrations/20260926000000_drop_audit_logs/migration.sql
  - resource: ../../Dockerfile
generated: { by: codex/gpt-6, at: 2026-09-26T10:23:20Z }
---

# 適用前の確認

対象環境の標準出力が Alloy へ渡ること、一行一 JSON として解析されること、`event="audit"` が除外・サンプリングされないことを確認する。収集先で監査イベントの保存期間と閲覧権限を決める。旧 DB の既定 365 日は自動継承されない。`SUI_LOG_LEVEL=warn` など通常ログを絞る設定でも監査の 2xx/info が到達することを確認する。

新イメージを隔離環境で起動して監査対象の成功と失敗を発生させ、コンテナの stdout と収集先の双方で `event="audit"`、`schemaVersion=1`、`requestId`、`status` を照合する。本番の業務データを検証のために変更しない。ローカルでは `make test-audit-stdout` が隔離 DB 上の本番ビルドへ成功する変更を送り、通常ログが `silent` でも標準出力に監査 JSON が出ることを確認する。ローカルの stdout 検証は外部収集の確認を代替しない。

Loki の検索例。`<app-label-selector>` は実環境の stream label を確認して置き換える。

```logql
{<app-label-selector>} | json | event="audit"
{<app-label-selector>} | json | event="audit" | requestId="<response-x-request-id>"
```

`requestId`、`subject`、`sessionId`、`apiTokenId`、動的な `path` は高カーディナリティなので stream label にしない。

# 停止して退避する

1. 本番入口を止め、処理中のリクエストを完了させ、すべての旧アプリを停止する。
2. 対象 DB と Prisma migration 履歴を含むバックアップを取得する。接続先の例は `DATABASE_URL='<production-database-url>'` とし、実環境の資格情報を安全に渡す。
3. `audit_logs` を CSV として退避し、件数と最古・最新日時を照合する。`GET /api/export` は監査履歴を含まないため、この退避には使えない。

```sh
pg_dump --dbname='<production-database-url>' --format=custom --file='<backup-path>.dump'
psql '<production-database-url>' -v ON_ERROR_STOP=1 -c 'SELECT count(*), min(created_at), max(created_at) FROM audit_logs;'
psql '<production-database-url>' -v ON_ERROR_STOP=1 -c "\\copy (SELECT * FROM audit_logs ORDER BY created_at, id) TO '<audit-history-path>.csv' WITH CSV HEADER"
wc -l '<audit-history-path>.csv' # ヘッダを除いた件数を DB の count と比較
head -n 2 '<audit-history-path>.csv' # 読み取り可能であることを確認。閲覧権限を制限する
```

ローカルのリハーサルは `make test-migration` で隔離テスト DB を使う。旧 schema にダミーの監査・口座・認証データを入れ、CSV 退避、DB バックアップ、DROP、復元、空 DB への全 migration 適用を検証する。本番の接続先・namespace・収集 label は環境固有なので上記のプレースホルダーを置き換え、退避物を保護する。

# マイグレーションと再開

Dockerfile はアプリ起動前に `prisma migrate deploy` を実行する。新コンテナを起動した時点で `audit_logs` が DROP されるので、退避完了前に起動しない。旧アプリと DROP 後の DB を並行稼働させる通常のローリング更新は使わない。

退避を照合したら新イメージを起動し、migration とアプリの起動を確認する。新アプリの stdout と Alloy 経由の収集先で監査イベントを確認してから入口を再開する。旧 `SUI_AUDIT_LOG_RETENTION_DAYS` と Helm `audit.retentionDays` を削除し、`GET /api/audit-logs`、MCP `list_recent_changes`、UI の `/audit-logs` が廃止されたことと、新しい検索先を運用担当へ共有する。

# 復旧

入口を止めたままの検証で失敗したら新アプリを停止し、DB と `_prisma_migrations` が整合するバックアップを復元してから旧イメージを起動する。旧イメージだけを戻しても監査テーブルは復元されない。入口再開後に DB 全体を復元すると、その後の家計の更新も失われる。再開後は失われる更新の範囲を確認して復旧方法を決める。
