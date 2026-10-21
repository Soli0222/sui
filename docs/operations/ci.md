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
共有workflow内のActionは共有リポジトリで管理する。
RenovateのGitHub Appトークンはこのリポジトリだけを対象とする。
依存更新は他のアプリリポジトリと同じく、major更新を含めてCI成功後に自動マージする。
Action・共有workflow・コンテナ・バージョン範囲の更新にも同じ方針を適用する。
npmの公開後待機は `security:minimumReleaseAgeNpm` プリセットに従い、プリセットが対象外とする更新種類にも独自の手動承認は追加しない。
Node.js本体は最新の安定版を追跡し、公開後待機とPR数の制限から除外する。
Chart内のイメージ更新はChart Guardの成功を条件に自動マージし、major更新だけ手動確認する。
Chartのイメージはcustom managerで検出し、同じPRでchart versionを更新するため、重複する `helm-values` managerは無効にする。
TypeScriptの互換性による上限など、依存ごとの例外は `renovate.json5` を正本とする。

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
