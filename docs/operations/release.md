---
type: Playbook
title: リリース
description: GitHub Actions の Release workflow を手動実行してタグと Docker イメージを出すまでの手順。
tags: [release, ci, deployment]
generated: { by: codex/gpt-6, at: 2026-09-26T09:51:45Z }
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

[設定と環境変数](./configuration.md)で DB と OIDC を設定してから起動する。認証は既定で有効であり、DB の接続設定だけではログインできない。

```bash
docker compose up -d --build
```

3000 番で立ち上がる。
Prisma のマイグレーションはコンテナ内で自動実行される。
Dockerfile はマルチステージで、フロントエンドのビルド成果物を backend が配信する構成になる。

# Docker ビルドの検証とキャッシュ

`make build-docker`で手元のアーキテクチャ向けにDockerfileを検証する。
CIと公開workflowでは、amd64とarm64をそれぞれ対応するrunnerでネイティブビルドする。runnerの指定はworkflowを参照する。
GHAキャッシュのscopeは`sui-linux-amd64`と`sui-linux-arm64`に分け、アーキテクチャ間の上書きを避ける。

Dockerfileは依存インストール、Prisma生成、backendビルド、frontendビルドを分ける。
Prisma生成は一度だけ行い、マイグレーションファイルは配布時に追加する。
ソースは必要なディレクトリだけCOPYし、ドキュメント・E2E・テスト成果物はビルド入力に含めない。
frontendだけの変更でもbackendを再ビルドしない構成である。


# 既存環境の更新

支出決裁を含む旧環境は [支出決裁廃止のデータ移行](./spending-removal-migration.md) を先に確認する。通常のローリング更新では扱えない削除と復元条件がある。

# 関連

- [開発の進め方](./development.md)
- [設定と環境変数](./configuration.md)
