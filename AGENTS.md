# AGENTS.md

## Project overview

個人資産管理ツール「sui」。予測残高、固定収支、クレジットカード請求、ローン返済、割り勘を管理するフルスタックアプリケーション。

## Documentation

設計の理由と規則の詳細は `docs/`（Open Knowledge Format v0.2 のナレッジバンドル）にある。
既存の挙動を推測で実装し直す前に、該当する概念ドキュメントを読むこと。

| 参照先 | 内容 |
|--------|------|
| `docs/index.md` | バンドルの入口。設計前提の要約 |
| `docs/concepts/` | 可処分残高、残高照合、予測イベント、カード請求、ローン、サブスク、割り勘、営業日シフト、複数通貨 |
| `docs/architecture/` | パッケージ構成、予測パイプライン、認証、MCP、可観測性 |
| `docs/operations/` | 開発、テスト、環境変数、リリース、文書保守 |
| `docs/references/api-endpoints.md` | 全 API エンドポイント |

ドメインの規則を変更したら、対応する `docs/` のドキュメントも更新する。
concept document の意味を変更したら、`generated` を実際の生成者と変更日時に更新する。
`verified` は実際の verification event があった場合だけ追加する。
文書の正本と更新方法は [文書の保守](docs/operations/documentation.md)に従い、変更後は `make docs-check` で確認する。
技術バージョンは文書へ転記せず、package.json、lockfile、コンテナ定義、CI を参照する。

## Design assumptions

[設計前提](docs/index.md)と対象の概念文書を読むこと。特に次の境界を守る。

- 残高予測は固定収支、カード請求、ローン返済を対象とする。サブスク、給与・寄付台帳、割り勘の債権を直接加えない。
- 予測イベントは予定日を過ぎても自動確定しない。人間が金額と口座を確認して確定する。
- 既存口座の残高を指定額へ合わせる操作は残高照合に集約する。差額は adjustment 取引にし、差額0でも照合日時を更新する。
- 金額は通貨の最小単位の整数とし、集計は JPY 換算後に行う。int32 を超える入力は 400 で拒否する。
- 認証は外部 IdP を使い、アプリ内に ID/PW を持たない。API トークンと MCP OAuth の境界は [認証](docs/architecture/authentication.md)を参照する。認証無効化は信頼境界内に限る。

## Testing rules

**テストは必ず Makefile 経由で実行すること。** pnpm コマンドを直接実行してはならない。

| 種別 | コマンド |
|------|----------|
| ユニットテスト | `make test-unit` |
| インテグレーションテスト | `make test-integration` |
| E2Eテスト | `make test-e2e` |
| Lint | `make lint` |
| 型チェック | `make typecheck` |
| ビルド | `make build` |
| 文書検証 | `make docs-check` |

### テストを書くとき

- 新規追加の前に既存ケースの拡張で足りるか確認する。E2E を追加する PR には実ブラウザが必要な理由を書く。同じ境界値を複数の層で網羅しない。
- 単体・結合では基準日を引数で渡すか `vi.setSystemTime` で時計を固定する。
- E2E の `test` は `e2e/helpers/test.ts`、日付は `e2e/helpers/scenario.ts` を使う。新しいプロセスと fixture も共通時計を継承させ、実時計を直接読まない。
- E2E の業務基準日は [テストの書き方](docs/operations/testing.md)に定義する。年の経過で更新せず、日付境界は単体・結合で検証する。通常の `make test-e2e` を1回実行し、カレンダー別の実行条件を増やさない。
- ブラウザだけ時計を固定できるのは判定がブラウザ内で完結する場合だけ。一覧・レイアウトは対象レコードの表示を先に assert する。
- 日付リテラルなどの lint 例外は必要な行だけ理由付きで許可し、ファイル全体を除外しない。
- worker fixture に専用 DB の初期化を任せ、spec で共通 DB をリセットしない。

時計・Cookie・DB日時の違い、E2Eの実行引数は [テストの書き方](docs/operations/testing.md)を参照する。
結合・E2E・performance は隔離ランナーが DB の準備と終了処理を行う。手動で DB を準備しない。
異常終了時も他の slot のプロセス・コンテナ・ロックを操作しない。復旧は [テスト隔離環境](docs/operations/test-isolation.md)に従う。

## Local environment

[開発の進め方](docs/operations/development.md)の開発専用 DB と API を使う。
`compose.yaml` のアプリは3000番を使うため、起動に失敗した開発 API の代わりに稼働中のアプリへ接続しない。
データ投入前に API の起動ログ、`DATABASE_URL`、`GET /api/accounts` から意図した接続先であることを確認する。
seed、import、delete の前には、その接続先の `GET /api/export` で退避する。

## Code conventions

- 共有型は `packages/shared/src/types/` に定義する
- API レスポンス型は `api.ts`、ドメインモデルは `domain.ts`
- 日付とスケジュールの計算は `@sui/shared` に置く（フロントとバックで同じ規則を使うため）
- バックエンドのビジネスロジックは `packages/backend/src/services/` に配置
- ルートハンドラは zod での検証と入出力の整形に留める
- テストヘルパーは `packages/backend/src/test-helpers/` にある
- 論理削除（`deletedAt`）を使うモデルでは、一覧取得で `deletedAt: null` を必ず条件に入れる

## Key files

| ファイル | 役割 |
|----------|------|
| `packages/backend/src/services/forecast-core.ts` | 残高予測の中核。DB アクセスを持たない純粋関数 |
| `packages/backend/src/services/forecast-core.test.ts` | 予測の仕様がここに集まっている。挙動を変える前に読む |
| `packages/backend/src/app.ts` | HTTP ルートとミドルウェアの登録。順序の理由は認証文書を参照 |
| `packages/backend/src/middleware/auth.ts` | 資格情報の検証と読み取り専用の強制 |
| `packages/db/prisma/schema.prisma` | データモデル |
| `scripts/run-isolated-test.mjs` | スロット割り当て、DB 起動、テスト実行、停止を行うランナー |
| `scripts/test-isolation/resources.mjs` | slot に応じたポート・project 名計算とロック取得 |
| `scripts/test-isolation/docker-db.mjs` | 固定 slot 用の DB 起動/停止スクリプト |
| `playwright.config.ts` | E2E の並列数（既定4）と実行別の成果物パス |
| `e2e/helpers/test.ts` | worker ごとの DB・API・mock IdP・認証とテスト前の初期化 |
