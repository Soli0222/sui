# E2E テスト 10分化の分析と修正方針

## 症状

E2E テストが ~1分 → ~10分 に劣化。

## 原因

**DB 操作が毎回子プロセス (`tsx`) を起動する方式に変更された**ため。
1回あたり 2-5秒のオーバーヘッド × 数十回 = 数分のロス。

## なぜ子プロセス方式になったか（PoC で判明）

直接 `@sui/db` を import する方式を試した結果、以下のエラーが発生:

```
ReferenceError: exports is not defined in ES module scope
  at ../packages/db/src/generated/prisma/client.mts:3
```

**Playwright のテストランナーは内部で CJS トランスパイルを行う**ため、Prisma v7 の生成コード（`.mts`, ESM only, `import.meta.url` 使用）と互換性がない。これが子プロセス方式にせざるを得なかった理由。

## 修正方針の選択肢

### 方針A: 長寿命の子プロセスを1つ起動し、全 DB 操作をそこに送る

現状の「毎回プロセス起動」のオーバーヘッドを排除しつつ、ESM 互換性問題を回避する。

- `db-runner.ts` を常駐プロセスとして起動し、stdin/stdout や IPC で DB コマンドを受け取る
- テスト開始時に1回だけ起動し、全テスト完了後に終了
- プロセス起動 + Prisma 接続は1回だけ

### 方針B: Playwright の ESM 対応を使う

Playwright は実験的に ESM をサポートしている。`playwright.config.ts` に以下を追加:

```
// playwright.config.ts の対応 or Node.js の --experimental-vm-modules フラグ
```

ただし Prisma の `.mts` 生成コードとの組み合わせが安定するかは不明。

### 方針C: Prisma の生成コードを `.ts`（CJS 互換）で出力する

`schema.prisma` の generator 設定で `generatedFileExtension` と `moduleFormat` を変更する。
ただし Prisma v7 は ESM only を推奨しており、CJS 出力がサポートされるか要確認。

### 方針D: HTTP API 経由で DB 操作する

バックエンドに管理用エンドポイント（`POST /test/reset`, `POST /test/seed`）を追加し、E2E テストからは fetch で呼ぶ。子プロセスもモジュール互換性も不要。ただしテスト専用コードがバックエンドに入る。

## 推奨

**方針A**（長寿命子プロセス）が最も確実で効果が大きい。
現在の db-runner.ts を活かしつつ、起動を1回に抑えるだけで大幅改善できる。
