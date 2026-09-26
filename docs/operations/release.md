---
type: Playbook
title: リリース
description: GitHub Actions の Release workflow を手動実行してタグと Docker イメージを出すまでの手順。
tags: [release, ci, deployment]
generated: { by: codex/gpt-6, at: 2026-09-26T00:46:39Z }
---

# 手順

GitHub Actions の `Release` workflow を手動実行し、`version` に SemVer を入力する。
`1.8.0` や `1.8.0-rc.1` の形で、タグは既存のリリースに合わせて `v` を付けずに作る。

workflow は次を順に行う。

1. ルートとワークスペースの package version を更新して同期する。
2. `make lint`、`make typecheck`、`make test-unit`、`make build`、`make test-integration`、`make test-e2e` を実行する。
3. release commit を作り、タグを打ち、GitHub Release を作成する。
4. Docker イメージの publish workflow を同じタグで実行し、完了まで待つ。

検証が一つでも落ちればタグは作られない。

# 手元でのバージョン確認

```bash
make version-set VERSION=1.8.0
make version-check
```

`version-check` はワークスペース間でバージョンが揃っているかを見る。
`VERSION` を指定した場合は SemVer 形式と一致も検証する。
タグから直接起動した公開 workflow もこの検証を通す。
Make は入力値を文字列のまま環境変数に渡し、シェルの構文として展開しない。
リリース前に手元で確認したいときに使う。

# Docker での起動

```bash
docker compose up -d --build
```

3000 番で立ち上がる。
Prisma のマイグレーションはコンテナ内で自動実行される。
Dockerfile はマルチステージで、フロントエンドのビルド成果物を backend が配信する構成になる。

# Docker ビルドの検証とキャッシュ

`make build-docker`で手元のアーキテクチャ向けにDockerfileを検証する。
CIと公開workflowでは、amd64を`ubuntu-24.04`、arm64を`ubuntu-24.04-arm`でネイティブビルドする。
GHAキャッシュのscopeは`sui-linux-amd64`と`sui-linux-arm64`に分け、アーキテクチャ間の上書きを避ける。

Dockerfileは依存インストール、Prisma生成、backendビルド、frontendビルドを分ける。
Prisma生成は一度だけ行い、マイグレーションファイルは配布時に追加する。
ソースは必要なディレクトリだけCOPYし、ドキュメント・E2E・テスト成果物はビルド入力に含めない。
frontendだけの変更でもbackendを再ビルドしない構成である。

# 関連

- [開発の進め方](./development.md)
- [設定と環境変数](./configuration.md)

# 支出決裁廃止のデータ移行（Issue #666）

この変更は決裁台帳・保存済み AI キーと、決裁が生成した未確定の振替予定を物理削除する。まず通常の書き込みを止め、旧 API が動いている間に `GET /api/export` を取得する。その後、全旧 API プロセスを停止して PostgreSQL の DB バックアップを取得し、暗号化鍵も別途安全に退避する。新旧プロセスを混在させるローリング更新は行わない。export には保存済み AI キーを含まない。

バックアップした DB で `psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/spending-removal-preview.sql` を実行し、台帳・キー・関連予定の件数と対象 ID の一覧を確認する。リンク先欠落・重複・想定外の形状は migration が変更前に停止するため、その場合は原データを調査してから再実行する。`20260926000000_remove_spending_approval` を含む migration を適用し、新版を起動して口座、取引、予測、export と replace を検証してから通常の書き込みを再開する。

旧形式バックアップは新版の strict schema により 400 で拒否される。復元が必要なら、対応する旧版と DB を隔離環境で起動して旧バックアップを復元し、上記の移行を適用して新形式を再 export する。JSON の旧フィールドだけを消すと関連する振替予定が復活するため行わない。

リポジトリ外の Helm values、Secret、デプロイ環境変数から `SUI_CREDENTIAL_ENCRYPTION_KEY`、`SUI_SPENDING_*`、旧 AI 専用変数、`credentials.encryptionKey` を撤去する。共用 Secret 自体は削除しない。ロールバックはコードだけを戻さず、旧版と移行前 DB をセットで復元する。新版での書き込み後に DB を戻すと、その間の更新は失われる。
