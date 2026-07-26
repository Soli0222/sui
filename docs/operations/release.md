---
type: Playbook
title: リリース
description: GitHub Actions の Release workflow を手動実行してタグと Docker イメージを出すまでの手順。
tags: [release, ci, deployment]
timestamp: 2026-07-26T00:00:00+09:00
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

`version-check` はワークスペース間でバージョンが揃っているかだけを見る。
リリース前に手元で確認したいときに使う。

# Docker での起動

```bash
docker compose up -d --build
```

3000 番で立ち上がる。
Prisma のマイグレーションはコンテナ内で自動実行される。
Dockerfile はマルチステージで、フロントエンドのビルド成果物を backend が配信する構成になる。

# 関連

- [開発の進め方](./development.md)
- [設定と環境変数](./configuration.md)
