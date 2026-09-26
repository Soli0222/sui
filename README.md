# sui — 可処分資産予測

個人の資産を管理し、将来の残高を予測するための Web アプリケーションです。

銀行口座の残高、固定収支、クレジットカードの引き落とし、ローンの返済スケジュールを登録すると、今後数か月の可処分残高推移をチャートで確認できます。

![ダッシュボード](docs/images/dashboard.png)

<details>
<summary>その他のスクリーンショット</summary>

| サブスク管理 | 取引履歴 |
|:-:|:-:|
| ![サブスク管理](docs/images/subscriptions.png) | ![取引履歴](docs/images/transactions.png) |

| 割り勘 |
|:-:|
| ![割り勘](docs/images/splits.png) |

</details>

## 主な機能

| 機能 | 概要 |
|------|------|
| **ダッシュボード** | 合計残高、期間内最小残高、次の収支と可処分残高推移を確認。オフセット適用の有無を切り替えられる |
| **予測の手動確定** | 予定日を過ぎた予測イベントを、実際の金額と口座を確認したうえで実取引として確定 |
| **口座管理** | 複数口座の実残高、オフセット、最終照合日時を管理。照合で差分を調整取引として記録 |
| **固定収支** | 給与、家賃など毎月または毎週の定期的な収入と支出を登録 |
| **クレジットカード** | カードごとに想定額と実績額を管理し、引き落とし予測に反映 |
| **ローン** | 返済総額と回数から月々の返済額を計算。繰上返済を織り込んで残りを組み直す |
| **サブスク管理** | 定額課金を一元管理し、月別と年間の合計額を確認（残高予測には直接統合しない） |
| **取引履歴** | 入出金、口座間振替、残高調整を記録し、過去の残高推移を逆算して表示 |
| **割り勘** | 立替をメンバーごとの負担額に分割し、回収を精算として記録（残高予測には含めない） |
| **給与・寄付台帳** | 給与明細とふるさと納税の寄付を記録し、年別集計と控除上限の目安を確認 |
| **複数通貨** | JPY、USD、EUR の口座とサブスクに対応。合計は JPY 換算 |
| **データ管理** | 全データの JSON エクスポートと全置換インポート |
| **MCP** | backend 内蔵の `/mcp` から、AI クライアントで資産データを参照、更新 |

## 使い始める

- [初期セットアップ](docs/guides/getting-started.md)：口座と収支を登録し、予測を確認する
- [日々の運用](docs/guides/daily-workflow.md)：予測の確定、残高照合、割り勘とバックアップ
- [MCP クライアントの接続](docs/guides/mcp-connection.md)：API トークンまたは OAuth で接続する

## 開発・デプロイ

- [開発の進め方](docs/operations/development.md)：開発用 DB と API の起動、シード、実行コマンド
- [テストの書き方](docs/operations/testing.md)：テストの責任分担、共通時計、worker の独立性
- [設定と環境変数](docs/operations/configuration.md)：認証、外部連携、可観測性の設定
- [リリース](docs/operations/release.md)：バージョン更新と Docker での起動
- [Helm chart](charts/sui/README.md)：Kubernetes への配置と values

React の SPA と Hono の API を pnpm workspace で管理し、Prisma を通じて PostgreSQL に保存します。
MCP は backend の `/mcp` に内包しています。
技術構成と配置規約は[パッケージ構成](docs/architecture/package-layout.md)、利用するバージョンは各 `package.json`、lockfile、コンテナ定義を参照してください。

## 設計・API

[ドキュメントの入口](docs/index.md)から、業務規則、設計理由、API と MCP の契約をたどれます。
ドキュメントは Open Knowledge Format の知識バンドルです。
編集時は[文書の保守](docs/operations/documentation.md)を参照してください。

## ライセンス

[MIT](LICENSE)
