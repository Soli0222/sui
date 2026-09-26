---
type: Playbook
title: 文書の保守
description: 情報の正本、文書の更新と OKF・リンク・公開操作一覧の検証。
sources:
  - resource: ../../scripts/docs/check_docs.py
generated: { by: codex/gpt-6, at: 2026-09-26T09:57:02Z }
---

# 更新する場所を決める

仕様変更では、先に既存の文書を探し、該当する節を更新する。
各文書の末尾に変更内容を足す前に、規則・例外・手順のどこへ組み込むかを決める。

| 情報 | 正本 | 他の文書での扱い |
|---|---|---|
| 製品概要と代表機能 | README | 利用・開発の入口へリンクする |
| エージェントが守る作業規則 | AGENTS.md | 手順と背景は各文書へリンクする |
| 残高・予測・台帳の意味と業務規則 | concepts | 操作ガイドや UI 文書では要約と参照先を示す |
| 利用者の操作手順 | guides | 設定や契約の詳細は正本へリンクする |
| 実装の責任分担と設計理由 | architecture | コードの全ファイル一覧は転記しない |
| 開発・テスト・リリース手順 | operations | 過去の計測結果と現行手順を分ける |
| 公開 API と MCP の契約 | references | コードの登録一覧と照合する |
| 過去の監査・計測結果 | archive | 対象 commit を明記し、現行仕様として使わない |

技術バージョンは `package.json`、lockfile、コンテナ定義、CI を正本とし、説明文へ固定値を転記しない。
Helm の README は chart から生成されるため、値の更新は既存の生成手順で行う。
業務上の境界値、固定テスト日、移行識別子、設定の既定値は、それぞれの規則や手順に必要な値として記載する。

# 文書を編集する

1. [入口](../index.md)から該当文書を確認し、同じ規則の詳細が複数箇所にないか探す。
2. 規則・理由・例外を既存節へ組み込み、「関連」は最後に置く。ページを分けるのは、読む目的が異なる場合にする。
3. 内容を移動する場合は入出力のリンクとディレクトリの `index.md` を更新する。外部から使われている旧パスには参照先を残す。
4. 本文を変更した concept document の `generated` を実際の生成者と変更日時に更新する。`verified` は確認した事実がある場合だけ記録し、形式検証の成功を業務規則の確認と同一視しない。
5. 新しい文書には根拠となる文書・コードを `sources` に記録する。監査記録は対象 commit を固定し、過去の数値を最新値へ書き換えない。

移行手順は、旧環境の利用者が更新・復元できる間は参照可能にしておく。
一度きりの作業でも、リリースの入口から必要な手順へたどれるようにする。

# 文書を検証する

文書検証は Python と [requirements.txt](../../scripts/docs/requirements.txt) を使う。
初回だけ検証用の環境を作る。

```bash
python3 -m venv .venv-docs
.venv-docs/bin/pip install -r scripts/docs/requirements.txt
make docs-check test-docs PYTHON=.venv-docs/bin/python
```

PyYAML が入った Python を使う場合は `make docs-check` だけでよい。
CI の `docs` job も同じコマンドを使う。

| 検証 | 対象と限界 |
|---|---|
| OKF | `docs/` の構造、frontmatter、生成者・日時など。警告も失敗として扱う |
| リンク | README、AGENTS、chart README、docs のローカルリンク、画像と見出し。外部 URL の到達性は確認しない |
| 公開操作一覧 | API/MCP の表と `api-parity.ts` の操作名を照合し、未記載・廃止済み・重複を検出する。説明文の意味はレビューで確認する |

OKF validator は [Soli0222/skills の実装](https://github.com/Soli0222/skills/blob/4183ec413573949db9ac55a135e905cb7011141c/skills/okf/scripts/validate_okf.py) を `scripts/docs/validate_okf.py` に同梱している。
更新時は取得元の revision も更新する。
`scripts/docs/check_docs.py` が、これにリポジトリ固有のリンクと一覧の照合を加える。

`make test-unit` の MCP 契約テストは、実際の Hono ルート・MCP ツール登録・出力スキーマ・文書のツール名も照合する。
公開操作を変更した場合の手順は [MCP の拡張](./mcp-development.md) を参照する。
文書だけの変更では `make docs-check` を実行し、検証スクリプトも変更した場合は `make test-docs` を加える。
