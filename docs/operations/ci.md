---
type: Architecture
title: CI と依存更新
description: PR 実行の権限、結果の通知と依存更新の制限。
sources:
  - resource: ../../.github/workflows/ci.yml
generated: { by: codex/gpt-6, at: 2026-09-26T09:51:45Z }
---

# CI の権限と依存更新

PRコードを実行するCIには `contents: read` だけを与える。
パフォーマンス比較表は実行サマリーとartifactに保存する。
コメント投稿はdefault branchの `workflow_run` で実行し、実行結果とPRの現在のhead SHAを照合する。
この処理はPRコードのcheckout、依存のインストール、artifactのダウンロード・実行を行わない。
コメントはGitHubの実行メタデータから作る比較表へのリンクだけとする。

ActionはコミットSHA、Dockerfile・Compose・Renovate実行イメージはdigestで固定する。
RenovateのGitHub Appトークンはこのリポジトリだけを対象とする。
依存更新はnpm以外もリリースから3日待ち、日時が取得できない更新は保留する。
日時を確認できない種類の更新と、Action・コンテナ更新は自動マージせずレビューを求める。
待機期間が適用できない更新種類があるため、固定値更新を無条件に自動マージしてはならない。
詳細は [Renovateのminimum release age](https://docs.renovatebot.com/key-concepts/minimum-release-age/) を参照。
