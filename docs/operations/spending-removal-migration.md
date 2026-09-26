---
type: Playbook
title: 支出決裁廃止のデータ移行
description: 旧環境からの更新、バックアップ、移行確認と復元の手順。
sources:
  - resource: ../../packages/db/prisma/migrations/20260926000000_remove_spending_approval/migration.sql
generated: { by: codex/gpt-6, at: 2026-09-26T09:51:45Z }
---

# 対象

`20260926000000_remove_spending_approval` が未適用の環境を更新する際に使う。適用済みの環境では再実行しない。

# 移行手順

この変更は決裁台帳・保存済み AI キーと、決裁が生成した未確定の振替予定を物理削除する。まず通常の書き込みを止め、旧 API が動いている間に `GET /api/export` を取得する。その後、全旧 API プロセスを停止して PostgreSQL の DB バックアップを取得し、暗号化鍵も別途安全に退避する。新旧プロセスを混在させるローリング更新は行わない。export には保存済み AI キーを含まない。

バックアップした DB で `psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/spending-removal-preview.sql` を実行し、台帳・キー・関連予定の件数と対象 ID の一覧を確認する。リンク先欠落・重複・想定外の形状は migration が変更前に停止するため、その場合は原データを調査してから再実行する。`20260926000000_remove_spending_approval` を含む migration を適用し、新版を起動して口座、取引、予測、export と replace を検証してから通常の書き込みを再開する。

旧形式バックアップは新版の strict schema により 400 で拒否される。復元が必要なら、対応する旧版と DB を隔離環境で起動して旧バックアップを復元し、上記の移行を適用して新形式を再 export する。JSON の旧フィールドだけを消すと関連する振替予定が復活するため行わない。

リポジトリ外の Helm values、Secret、デプロイ環境変数から `SUI_CREDENTIAL_ENCRYPTION_KEY`、`SUI_SPENDING_*`、旧 AI 専用変数、`credentials.encryptionKey` を撤去する。共用 Secret 自体は削除しない。ロールバックはコードだけを戻さず、旧版と移行前 DB をセットで復元する。新版での書き込み後に DB を戻すと、その間の更新は失われる。
