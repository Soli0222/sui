---
type: Architecture
title: 編集画面の共通契約
description: モーダル、並置パネル、専用ページの状態、保存境界、離脱保護を定める。
tags: [frontend, editing, forms, navigation]
generated: { by: codex/gpt-6-sol, at: 2026-09-23T16:13:00+09:00 }
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

# 入力と検証

`FormField` は対応する `Input`、`Select`、`MoneyInput` に ID、必須属性、`aria-describedby`、`aria-invalid` を渡す。複数コントロールには `FieldGroup` の fieldset と legend を使う。`SegmentedControl` はラジオグループとしてラベルと説明を受け、矢印、Home、End キーで選べる。独自の入力部品を追加する場合は、実際のコントロールへ ID と ARIA 属性を転送する。

`useFieldValidation(draft, validate, fieldIds?)` は同じドメインの `validate` 結果から、訪問済み項目と submit 後に限って `visibleErrors` を作る。`touch(field)` を blur で呼び、保存時には `showAll()` を呼ぶ。エラーキーが DOM ID と異なる場合は `fieldIds` で対応付ける。`useEditSession` にも同じ `validate` と `fieldIds` を渡すと、保存操作で最初の不正欄へフォーカスする。保存不能理由を無効ボタンだけで隠さない。

`MoneyInput` の従来の数値 `onChange` は継続する。編集セッションでは `onDraftChange({ raw, kind, minorUnits })` を併用し、`empty`、`incomplete`、`invalid`、`valid` を区別する。`1.` は入力途中、`0` は有効なゼロ、空欄は未入力である。`draftValue` を渡せば文字列をセッションで制御でき、`draftKey` は対象・操作の切替時にローカル文字列を分離する。USD/EUR の主要単位表示は有効値だけを最小単位整数に変換する。ゼロ・負数・int32 の可否は業務ごとの検証が決める。

`ScheduleField` はマウント時に日本時間の今日を確保し、単発や年次に切り替えたときの既定日付に使う。フォームで既に今日を確保している場合は `today` に渡す。`AccountSelect` は通貨を表示し、対象外になった現在の口座もその理由とともに表示する。口座の片側だけを許す振替では `required={false}` を明示する。`PeriodFields` の「空欄で無期限」は終了日だけに関連付ける。

# 取引フォームの基準実装

`routes/transactions.tsx` の追加・編集は短い `EditModal` であり、保存単位は一取引である。新規作成時に日本時間の今日を確保し、選択中の利用可能な口座だけを引き継ぐ。全口座のときは未選択のままにする。振替は送金元と振替先の片側だけでもよく、両方を選ぶ場合は別口座かつ同一通貨でなければならない。通常取引では対象口座が必須である。

金額は主要単位の文字列 draft として持ち、空欄、小数点で終わる途中入力、ゼロ、負数を区別する。有効な正数だけを通貨の最小単位整数へ変換して送信する。種別変更で振替先が不要になれば payload から除く。保存欄は変更前後と、取引・口座残高への反映を示す。保存後は現在の口座、期間、ページ、オフセットを維持して取引、口座、残高グラフを再取得する。再取得だけが失敗したら保存済みと表示し、読み取りだけを再試行する。

# 口座の保存境界

`routes/accounts.tsx` は三つの短い操作を分ける。新規登録は初期残高を含む `POST /api/accounts`、基本情報編集は残高を省略した `PUT /api/accounts/:id`、残高訂正は残高を明示した同じ `PUT` である。残高訂正だけが照合日時を変えずに差額の調整取引を作る。照合は `POST /api/accounts/:id/reconcile` で実残高を送り、差額が0でも照合日時を更新する。両操作の差額表示は開いた時点の予定値であり、保存結果はAPI応答と再取得した最新値で示す。

# 給与明細の専用ページ

`/salaries/new` と `/salaries/:id/edit` は長い `EditPage` を使う。編集 URL は論理削除されていない個別レコードを `GET /api/salary-records/:id` で読み、存在しなければ再試行と一覧への戻り道を示す。一覧の `year` はクエリで引き継ぎ、保存またはキャンセル後にも保つ。支給日、種別、名称、額面、すべての控除・拠出項目は文字列 draft から符号付き int32 の最小単位へ変換する。額面だけは非負、控除は年末調整の還付を含めて負数を許す。社会保険料、控除額、手取りのプレビューは draft から計算するが、給与ログは口座残高や予測に直接影響しない。その他の控除・拠出は開閉でき、既存値または入力エラーがあれば開く。保存後は個別取得を明示的に実行し、失敗時は mutation を再送せず取得だけ再試行する。
