---
type: Architecture
title: 編集画面の共通契約
description: モーダル、並置パネル、専用ページの状態、保存境界、離脱保護を定める。
tags: [frontend, editing, forms, navigation]
generated: { by: codex/gpt-6-sol, at: 2026-09-23T16:05:04+09:00 }
---

# 画面の型

短いフォームは `EditModal`、一覧やグラフと対象詳細を同時に見る画面は `EditPanelLayout`、長い入力は `EditPage` を使う。いずれも `EditShell` の対象名、変更状態、本文、変更要約、影響、エラー、保存欄を共有する。業務上の検証、差分、影響文、保存 API は呼び出し側が定める。詳細閲覧は `mode="detail"` として保存ボタンを出さず、編集操作と分ける。

モーダルは Radix Dialog のフォーカス制御を使い、ヘッダーと保存欄を残して本文だけスクロールする。並置パネルは背景を遮らない通常の領域である。実際の本文幅が 1096px 以上なら最小 640px の本文と 440〜500px のパネルを横に置く。それより狭いとパネルを全画面にし、背景を一時的に操作対象から外す。幅の変更は CSS と ResizeObserver で処理し、パネルの React ノードを再マウントしない。入力 draft は画面幅で分岐させない。

# 編集セッション

`useEditSession({ identity, initial, validate })` を対象 ID と操作単位ごとに作る。`initial` は開始時の保存済み snapshot であり、同じ identity の再取得では編集中の draft を上書きしない。`setDraft` は文字列の途中入力も保持できる。snapshot と draft が一致すれば dirty は解除される。対象を切り替える操作は `requestTransition`、閉じる操作は `requestClose` を通す。直接 identity を変える場合も別セッションに初期化されるが、呼び出し側は必ず事前に遷移を確認する。

`save(mutate, reload)` は mutation を一度だけ実行し、成功時に draft を保存済み snapshot とする。`reload` は失敗を reject する読み取り関数を渡す。mutation が失敗した場合は draft を保持し、再保存できる。mutation 成功後の reload 失敗は `refresh-error` として表示し、同じ mutation を再送しない。`retryRefresh()` は読み取りだけを再試行する。画面の保存ボタンは `saving`、`refreshing`、`refresh-error` で無効にし、後者では「表示を再取得」を出す。API が成功を返した後も取得失敗を mutation 失敗と表示してはならない。

# 離脱とフォーカス

認証済みアプリ全体に一つの `EditingNavigationProvider` を置く。各セッションを登録し、dirty なセッションがあればアプリ内ルート変更、戻る、対象変更、キャンセルに破棄確認を出す。複数の編集領域が同時にあるときもルーター blocker は一つだけである。保存中は切替を抑止する。再読込とタブ終了には dirty または保存中に限りブラウザ標準の `beforeunload` を使う。draft を localStorage に保存しない。

確認を取り消せば draft を保ち、破棄すれば snapshot に戻す。モーダルは Radix のフォーカス trap を使い、並置時のパネルは trap しない。狭幅の全画面表示だけは背後の本文を inert にし、Tab をパネル内に保つ。閉じた後は起点へ、起点が消えた場合は呼び出し元が渡す一覧見出しなどへフォーカスを戻す。

# 呼び出し例

```tsx
const edit = useEditSession({ identity: `account:${account.id}:edit`, initial: { name: account.name } });
<EditModal
  open={open}
  onRequestClose={() => edit.requestClose(() => setOpen(false))}
  subjectType="口座"
  subjectName={account.name}
  mode="edit"
  status={edit.status}
  error={edit.error}
  onSave={() => void edit.save((draft) => apiUpdate(draft), () => apiRead(account.id))}
  onRetryRefresh={() => void edit.retryRefresh()}
>
  <AccountFields value={edit.draft} onChange={edit.setDraft} errors={edit.errors} />
</EditModal>
```

`reload` は呼び出し側の既存取得経路を使い、保存後に一覧、グラフ、残高を更新する。編集中の draft で実際の残高やグラフを変えない。
