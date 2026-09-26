---
type: Playbook
title: テスト隔離環境の管理と復旧
description: slot の所有権、DB の分離、異常終了時の復旧。
sources:
  - resource: ../../scripts/test-isolation/resources.mjs
generated: { by: codex/gpt-6, at: 2026-09-26T09:58:58Z }
---

# テスト用 DB と slot

テスト用 DB は `compose_db.yaml` で起動し、slot ごとに独立した Docker Compose project network に接続する。
`scripts/run-isolated-test.mjs` が slot を自動的に割り当てるので、ポート・ネットワーク名が重ならず並列実行できる。

これにより、ローカル動作確認用 `compose.yaml` の `db` / `app` とネットワークが分離され、`make test-db-up` / `make test-db-down` や `make test-integration` / `make test-e2e` の停止処理がローカル環境に干渉しない。

固定 slot を使いたい場合は `SUI_TEST_SLOT` を指定する（0 以上 9 以下）。

```bash
SUI_TEST_SLOT=2 make test-integration
```

テストランナーは、`SUI_TEST_SLOT` から `DATABASE_URL`、`SUI_TEST_COMPOSE_PROJECT` などを自動導出する。
通常のテスト実行では、手動で DB を起動・停止する必要はない。

並列実行時は、既存の slot ロックが使われていれば自動的に待ち、ロック所有者のプロセスが死んでいれば TCP ポートが解放されるため安全に再取得する。
各 slot は TCP ポートの bind によって排他的に確保される。`lock.json` は TCP リースを保持している間だけ存在する確認用メタデータであり、正常終了時の `release()` は TCP リース中にこのメタデータを削除した後、自分の `listen` サーバーを `close` する。`docker compose -p sui-test-<slot>` だけを操作する。

## 特定 slot の状態を確認する

```bash
# その slot の Docker Compose project のみ確認
SUI_TEST_SLOT=2 node scripts/test-isolation/docker-db.mjs ps

# slot を保持している間だけ lock.json が存在する（release 後は削除される）
SUI_TEST_LOCK_DIR=${SUI_TEST_LOCK_DIR:-$TMPDIR/sui-test-locks}
ls "${SUI_TEST_LOCK_DIR}/sui-test-slot-2.lock"
cat "${SUI_TEST_LOCK_DIR}/sui-test-slot-2.lock/lock.json"
```

## 特定 slot だけクリーンアップする

`make test-db-up` / `make test-db-down` は固定 slot の手動管理用で、TCP リースを取得しない。実行中のテストがその slot を使っていないことを確認してから実行する。開発サーバーの DB は [開発手順](./development.md)の別 project を使う。

```bash
SUI_TEST_SLOT=2 make test-db-down
# または
SUI_TEST_SLOT=2 node scripts/test-isolation/docker-db.mjs down
```

これは `docker compose -p sui-test-2 -f compose_db.yaml down --volumes --remove-orphans` を実行するだけで、他の slot やローカルの `compose.yaml` には触れない。

## 他の実行を壊さないための制限

- **グローバルな公開ポート検索**（`docker ps`、`lsof` でのポート探し、ホストポートベースの停止）は使わない。
- **プロジェクト名なしの `docker compose down`**（`-p` なし、またはカレントディレクトリの `compose.yaml` を使った停止）を他の slot やローカル環境に対して行わない。
- 他の slot のロックディレクトリや Docker コンテナを手動で削除・強制終了しない。
- `kill -9` などで他の slot のテストプロセスを止めない。

これらを守らないと、並列実行中の他のテストを壊したり、ロックの整合性を損なったりする。

## ハードクラッシュ後の復旧

テストプロセスが `SIGKILL` などで途中で死んだ場合でも、次回の隔離ランナーが同じ slot を取得するときに以下が行われる。

1. `acquireSlot` は TCP ポートを確保した後、クラッシュなどで残っている古い `lock.json`（およびディレクトリ）を削除してから、新しいオーナーメタデータを作成する。
2. `run-isolated-test.mjs` は DB 起動前に `docker compose -p sui-test-<slot> ... down --volumes --remove-orphans` を実行する。
3. テスト終了時に同じ project 名で `down` し、slot ロックを解放する。

手動で介入する必要はない。

テストランナーは `.env` を変更しない。固有のポートや project 名は環境変数で渡す。変数一覧は [設定と環境変数](./configuration.md) を参照。
