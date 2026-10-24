---
type: Playbook
title: リリース
description: release-please の PR、週次マージ、イメージと Helm chart の公開・再実行。
tags: [release, ci, deployment]
sources:
  - resource: ../../.github/workflows/release.yml
  - resource: ../../.github/workflows/docker.yaml
  - resource: ../../.github/workflows/weekly-release.yaml
  - resource: ../../.github/workflows/release-retry.yaml
  - resource: ../../release-please-config.json
generated: { by: codex/gpt-6, at: 2026-10-24T02:26:43Z }
---

# リリース PR を作成してマージする

mainへ変更が入ると、`Release Pipeline` workflowがrelease-pleaseでリリースPRを作成・更新する。
`feat`はminor、`fix`・`perf`はpatch、破壊的変更はmajorの採番に使う。
ルートと配下4パッケージのversion、ChartのappVersion、変更履歴を一つのPRで更新する。
アプリは一つのversionで公開し、パッケージごとにはリリースしない。
Gitタグは既存の履歴に合わせ、`v`なしのSemVerを使う。

`always-update`を有効にし、リリースノートが変わらない場合も最新mainからリリースPRを更新する。
既定の本文比較だけでは、生成中にmainへ入った依存更新などを次の実行で取り込めず、古いpackage.jsonと新しいlockfileの不整合が残ることがある。
リリース処理は直列に実行するが、mainへのマージは処理中にも進むため、後続の実行で再調整できるようにする。
追加のAPI呼び出しやCI実行が生じることは許容する。

`Weekly Release PR Merge`は毎週日曜07:00 JSTに実行する。
対象はmain向けの所定のrelease-pleaseブランチで、GitHub Appが作成し、`autorelease: pending`ラベルを持つdraft以外のPRに限る。
`CI required`の成功と、Chart Guardを含む他のcheckの完了、マージ可能状態を確認してsquash mergeする。
確認したhead SHAを指定し、検証後に更新されたPRはマージしない。
checkがない・検証中・失敗・候補が曖昧な場合にはマージしない。

急ぐ場合は同じworkflowを手動実行するか、checkの成功を確認してrelease PRを手動でマージする。
`Release Pipeline`の手動実行はrelease-pleaseの再調整用であり、バージョン入力や即時公開は行わない。
リリースPRの依存定義がmainと食い違った場合は、mainのpackage.jsonとlockfileの整合性を確認してから手動実行で再生成し、CIの成功を確認する。
自動採番を調整するときはrelease-pleaseの`Release-As`指定を使い、PRのversionと変更履歴を確認する。
mainの自動リリースは安定版を対象とし、RC用の自動リリースブランチは設けない。

# イメージと chart を公開する

release PRのマージ後、同じpipelineで次を順に行う。

1. release-pleaseがタグとGitHub Releaseを作る。
2. リリースSHAをcheckoutし、`make version-check`で5パッケージと公開versionを照合する。
3. 共有のimage workflowがamd64とarm64をネイティブビルドしてGHCRへ公開し、platformとrevisionを検証する。
4. 公開versionがGitHubの最新安定版であれば、`latest`タグも更新する。過去版やRCの再公開では更新しない。
5. 共有のchart workflowがmain上の最新ChartをOCIへ収束させ、結果を実行サマリーに記録する。

image公開が失敗した場合、chart公開へは進まない。
既存のversionタグのplatformとrevisionが一致すればimage公開はno-opとなり、不一致なら上書きせず失敗する。
GitHub Releaseの作成はimage公開に先行するため、Releaseが存在するだけでは公開完了を意味しない。

ChartのappVersionはrelease PRで先に更新するため、Git上では未公開imageを一時的に指すことがある。
共有workflowは実際にrenderされるimageの実在を確認し、未公開なら`deferred`として公開を延期する。
image成功後のpipelineか、毎日04:17 JSTのchart再調整が後から拾う。
appVersionだけを変えたpushでは独立したchart workflowを起動せず、pipelineに任せる。
Chartの構造やversionを変えたpush、日次処理、手動実行では再調整する。

chart versionは共有workflowがOCIとの差分に応じて採番する。
appVersionだけの変更はpatch、構造変更はChart Guardがminorまたはmajorを要求する。
公開対象は最新mainなので、アプリreleaseとchart releaseが必ず1対1になるわけではない。
結果の`published`・`no-op`・`deferred`を確認する。

# 公開の失敗から復旧する

`Retry Release Publish`を手動実行し、公開済みGitHub Releaseのversionを`v`なしで入力する。
タグから元のSHAを解決し、同じversion照合・image公開・chart再調整を行う。
任意のrefは指定できず、draft・存在しないRelease・存在しないタグは拒否する。
既存RCの再公開も受け付ける。
chart再調整は過去版へ戻す操作ではなく、最新mainの状態を対象とする。

chartだけを復旧するときは`Publish Helm Chart`を手動実行する。
タグとReleaseを作り直すために既存の公開物を削除しない。

# 設定と手元での検証

release PR作成と週次マージには、既存の`RENOVATE_CLIENT_ID`・`RENOVATE_PRIVATE_KEY`からこのリポジトリ限定のGitHub App tokenを作る。
Appにはcontents・issues・pull requestsの書き込みと、checks・statusesの読み取り権限が必要になる。
imageとchartの公開にはjob単位の`GITHUB_TOKEN`を使う。
PRの検証とbranch protectionの設定方針は[CIと依存更新](./ci.md)を参照する。

```bash
make version-check
make lint-workflows test-release
```

`version-check`はワークスペース間でversionが揃っているかを見る。
`VERSION`を指定した場合はSemVer形式と一致も検証する。
手元の保守用に`make version-set VERSION=x.y.z`と`make version-sync`も残すが、通常のリリースではPRがversionを更新する。
Makeは入力値を文字列のまま環境変数に渡し、シェルの構文として展開しない。
`lint-workflows`にはactionlint、`test-release`には文書検証と同じPython依存が必要になる。

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
CIのGHAキャッシュはscopeをアーキテクチャ別に分ける。
公開時のキャッシュは共有image workflowが管理し、CIのscopeとは共有しない。

Dockerfileは依存インストール、Prisma生成、backendビルド、frontendビルドを分ける。
Prisma生成は一度だけ行い、マイグレーションファイルは配布時に追加する。
ソースは必要なディレクトリだけCOPYし、ドキュメント・E2E・テスト成果物はビルド入力に含めない。
frontendだけの変更でもbackendを再ビルドしない構成である。


# 既存環境の更新

[監査ログの標準出力移行](./audit-log-migration.md) は監査テーブルを削除するため、停止・退避・収集確認の順序を守る。

支出決裁を含む旧環境は [支出決裁廃止のデータ移行](./spending-removal-migration.md) を先に確認する。通常のローリング更新では扱えない削除と復元条件がある。

# 関連

- [開発の進め方](./development.md)
- [設定と環境変数](./configuration.md)
