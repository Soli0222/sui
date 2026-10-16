---
type: Architecture
title: CI と依存更新
description: PR 実行の権限、結果の通知と依存更新の制限。
sources:
  - resource: ../../.github/workflows/ci.yml
  - resource: ../../.github/workflows/renovate.yaml
  - resource: ../../renovate.json5
  - resource: ../../Dockerfile
  - resource: ../../compose.yaml
generated: { by: codex/gpt-6, at: 2026-10-16T12:06:42Z }
---

# CI の権限と依存更新

PRコードを実行するCIには `contents: read` だけを与える。
パフォーマンス比較表は実行サマリーとartifactに保存する。
コメント投稿はdefault branchの `workflow_run` で実行し、実行結果とPRの現在のhead SHAを照合する。
この処理はPRコードのcheckout、依存のインストール、artifactのダウンロード・実行を行わない。
コメントはGitHubの実行メタデータから作る比較表へのリンクだけとする。

このリポジトリが直接参照するActionと共有workflow、Dockerfile・Compose・Renovate実行イメージは公開済みのバージョンタグで固定する。
原則としてパッチ番号まで指定し、PostgreSQLのように上流がメジャー・マイナーの2要素で表すものは、その形式に従う。
RenovateによるコミットSHA・イメージdigestへの固定は無効にする。
共有workflow内のActionは共有リポジトリで管理するため、参照するrevisionの実装もレビューする。
RenovateのGitHub Appトークンはこのリポジトリだけを対象とする。
依存更新はnpm以外もリリースから3日待ち、日時が取得できない更新は保留する。
日時を確認できない種類の更新と、Action・コンテナ更新は自動マージせずレビューを求める。
待機期間が適用できない更新種類があるため、固定値更新を無条件に自動マージしてはならない。
詳細は [Renovateのminimum release age](https://docs.renovatebot.com/key-concepts/minimum-release-age/) を参照。

# リリース PR の検証

`CI required` は、CI workflow内のすべての検証jobの成功を集約する。
`performance`と`chart-guard`はPRだけで実行するため、mainへのpushではこの2つのjobのskipを許可する。
失敗・キャンセル・想定外のskipを成功扱いにしない。
`release-checks` はworkflowの構文とリリース自動化の判定を検証する。

Chart GuardもCIに組み込み、集約checkの成功条件に含める。
週次リリースはこの集約checkに加え、PRの全checkが完了していることを確認する。
checkがないPRや検証中のPRはマージせず、次の週次実行か手動実行に委ねる。
手動でrelease PRをマージする場合も、`CI required`とChart Guardの成功を確認する。
このworkflow変更自体はGitHubのbranch protectionやrulesetを変更しない。
設定する場合は`CI required`をrequired checkに指定する。

リリースの起動・公開・再実行は[リリース](./release.md)を参照する。
