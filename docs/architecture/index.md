# アーキテクチャ

コードの配置、予測の組み立て、認証、外部連携、可観測性をまとめる。

# Concepts

* [パッケージ構成](package-layout.md) - pnpm workspace の四パッケージ、バックエンドの層、データモデルの規約。
* [残高予測パイプライン](forecast-pipeline.md) - ダッシュボード応答を組み立てる処理順と、合計残高と口座別残高の二系統。
* [認証と信頼境界](authentication.md) - OIDC セッションと API トークン、ミドルウェアの順序、Origin ガード。
* [MCP エンドポイント](mcp-endpoint.md) - backend に内包した /mcp の認証、セッション、自分自身の API を呼ぶ構造。
* [可観測性](observability.md) - トレース、通常ログ、監査イベントの役割。
* [編集画面の共通契約](editing-ui.md) - 編集面、保存状態、離脱保護、フォーカスの扱い。
