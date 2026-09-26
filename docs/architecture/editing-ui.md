---
type: Architecture
title: 編集画面の共通契約
description: 中央モーダルと専用ページの状態、保存境界、離脱保護を定める。
tags: [frontend, editing, forms, navigation]
generated: { by: codex/gpt-6, at: 2026-09-26T09:58:58Z }
---

# 画面の型

短いフォームと一覧から開く詳細・編集は `EditModal`、長い入力は `EditPage` を使う。一覧から開く場合は `EditModalLayout` が一覧と同じ編集モーダルを組み合わせる。いずれも `EditShell` の対象名、変更状態、本文、変更要約、影響、エラー、保存欄を共有する。業務上の検証、差分、影響文、保存 API は呼び出し側が定める。閲覧と操作選択を行う編集メニューは `mode="detail"` として保存ボタンを出さず、各操作のフォームと分ける。

予定収支・サブスク・クレジットカードの一覧では、名称は通常のテキストとし、編集ボタンから対象の編集メニューを開く。メニューには基本情報の要約、「基本情報を編集」、全期間の金額一覧と追加・訂正・削除を置く。予定収支・サブスクの独立した履歴画面とカードの独立した仮定額画面は設けない。初期金額は訂正のみ、単発予定は期間追加なしとする。子フォームからメニューへ戻る場合は未保存の破棄確認を通し、閉じる場合はモーダル全体を閉じる。保存と再取得に成功したら同じ対象の編集メニューを再表示する。

モーダルは Radix Dialog のフォーカス制御を使い、中央に最大 36rem の読みやすい幅で表示する。狭い画面では左右 0.5rem の余白を残して広げる。ヘッダーと保存欄を残し、本文だけスクロールする。背後の一覧は幅とスクロール位置を保つ。画面幅が変わっても入力ノードと draft を再マウントしない。

# 一覧の表示

一件を読んで操作する一覧は、原則として一列のカードで表示する。予定収支、カード登録、サブスク、割り勘、寄附、ローン、確定キューがこれに当たる。カードの外枠・空状態は `CardList` にまとめ、金額・期間・操作の意味は各画面が決める。閲覧用のカードは `RecordCardLayout` で名称と補足を近接させ、値と操作を隣へ置く。金額履歴は `AmountPeriodList` の左寄せの金額列と期間列に個別の見出しを付け、短い履歴ではカードの高さを揃え、行数が増えた分は下方向へ伸ばす。余白は各画面の内容と列の比較に必要な範囲にとどめる。名称、口座名、メモは折り返して全文を示し、通貨付き金額や日付は途中で分断しない。

表示順の番号は一覧カードと表の情報欄、編集メニューの要約に繰り返さず、基本情報の編集項目に置く。カード登録の一覧では引落日と引落口座を別行にする。予定収支は金額の適用期間が予定の開始日・終了日を含むため、一覧に有効期間を重ねて表示しない。終了済みと無効の予定収支は同じ折りたたみ領域へ移し、対象口座だけをカードの補足に残す。

口座一覧は複数口座の残高を比較するため、広幅で表を使う。元通貨・JPY換算の有無にかかわらず、残高、可処分残高、換算レート、最終照合を同じ列に置き、換算額は元通貨の金額の下へ添える。狭幅では同じ情報をカードに積む。同じ画面のセクションカードは主領域の幅に揃え、個別の最大幅で右端をずらさない。列の間隔は表やカードの内容で決め、画面全体に空白を伸ばすための固定列幅は置かない。

同じ項目を縦に比較・入力する取引、予測イベント、寄与イベント、月別請求、給与、精算履歴、監査ログは広幅で表を使う。狭幅では同じデータを一件ずつ明細リストにする。`ResponsiveTable` は主領域の実際の幅で表と `CardList` を切り替え、列の多い一覧には個別の切替幅を設定する。主領域が狭いときに表見出しを折り返して押しつぶさない。

表の見出しとデータセルは行内で上下中央に揃える。入力欄や操作ボタンで行が高くなっても、文字列だけが上端に残らないようにする。

幅を変えたときも選択状態、入力中の文字列、検証エラー、保存範囲を保つ。表と明細に入力欄がある画面は同時に2つの入力 DOM を表示せず、切替時には draft と必要なフォーカスを引き継ぐ。表の合計を明細へ切り替えたときは明細の後に表示する。

# 画面と保存単位の対応

保存ボタンは表の一行に示す一操作だけを実行する。詳細から操作を切り替える場合も、編集中の draft があれば破棄確認を先に出す。実績の確定は予定や台帳の編集とは別操作である。

| 画面・操作 | 編集面と一回の保存範囲 | UI 固有の扱い・規則の参照先 |
|---|---|---|
| 取引 | 短いモーダル。一取引 | 日本時間の今日と選択中の口座を初期値にする。保存後も口座・期間・ページ・オフセットを維持する |
| 予定収支 | 中央モーダル。基本情報、将来額、履歴訂正のいずれか | 操作ごとに保存 API を分ける。[金額履歴と確定の規則](../concepts/forecast-event.md) |
| サブスク | 中央モーダル。基本情報、将来額、履歴訂正のいずれか | 台帳と集計を再取得する。[サブスク台帳](../concepts/subscription-ledger.md) |
| カード | 中央モーダル。基本情報または仮定額履歴 | 対象請求月の予測を再取得する。[請求月と安全弁](../concepts/credit-card-billing.md) |
| 月次請求 | 広幅の表／狭幅の明細リスト。表示中の対象月 | 行ごとに入力を検証し、選択月と保存範囲を示す |
| 口座 | 短いモーダル。新規登録、基本情報、残高照合を別操作にする | 差額表示は開始時の予定値。保存結果は最新値を再取得する。[残高照合](../concepts/balance-reconciliation.md) |
| 給与明細 | 専用ページ。一明細 | 一覧の年を URL で引き継ぐ。[給与台帳](../concepts/salary-ledger.md) |
| 予測イベント一括確定 | カード一覧での一括入力。選択した未確定イベント | 件数と実績額を利用者が確認する。[手動確定](../concepts/forecast-event.md) |
| ローン | 短いモーダル。一ローン | 月額試算は未保存 draft の参考値。[返済の規則](../concepts/loan-repayment.md) |
| 割り勘メンバー・立替・精算 | 短いモーダル。メンバー一件、立替と持分、または一回の精算 | 複数持分への充当は一回で保存する。[編集制限と精算](../concepts/split-and-settlement.md) |
| 寄附 | 短いモーダル。台帳一件 | 年別集計を再取得する。[寄付台帳](../concepts/furusato-tax.md) |
| ふるさと納税の見込み条件 | インラインフォーム。年内の3条件を一括保存 | 未保存値は表示中の試算へ反映しない。年変更前に破棄を確認し、結果の閲覧には保存を求めない |
| 表示期間の既定値 | 設定カード内の EditShell。2項目をまとめて保存 | 常設欄のため×・キャンセルを置かず、通常の操作は保存のみ。離脱は未保存確認を通す |
| API トークン | 発行モーダル、失効は固有の確認 | 秘密値は発行後一度だけ表示し、変更要約に載せない。失効の不可逆性を確認する |
| データの置き換え | 大量データのプレビューと専用の破壊的操作確認 | 内容と件数を確認する。プレビュー破棄・ファイル変更は未保存保護を通し、通常の編集保存ボタンへ置き換えない |

ダッシュボードは予測の閲覧と手動確定に専念し、予測イベントから予定収支を編集するボタンやカード・ローン管理画面への行ボタンは置かない。予定収支の編集は予定収支画面で行う。


# 編集セッション

`useEditSession({ identity, initial, validate })` を対象 ID と操作単位ごとに作る。`initial` は開始時の保存済み snapshot であり、同じ identity の再取得では編集中の draft を上書きしない。`setDraft` は文字列の途中入力も保持できる。snapshot と draft が一致すれば dirty は解除される。対象を切り替える操作は `requestTransition`、閉じる操作は `requestClose` を通す。直接 identity を変える場合も別セッションに初期化されるが、呼び出し側は必ず事前に遷移を確認する。

`save(mutate, reload)` は mutation を一度だけ実行し、成功時に draft を保存済み snapshot とする。`reload` は失敗を reject する読み取り関数を渡す。mutation が失敗した場合は draft を保持し、再保存できる。mutation 成功後の reload 失敗は `refresh-error` として表示し、同じ mutation を再送しない。`retryRefresh()` は読み取りだけを再試行する。画面の保存ボタンは `saving`、`refreshing`、`refresh-error` で無効にし、後者では「表示を再取得」を出す。API が成功を返した後も取得失敗を mutation 失敗と表示してはならない。

# 離脱とフォーカス

認証済みアプリ全体に一つの `EditingNavigationProvider` を置く。各セッションを登録し、dirty なセッションがあればアプリ内ルート変更、戻る、対象変更、キャンセルに破棄確認を出す。複数の編集領域が同時にあるときもルーター blocker は一つだけである。保存中は切替を抑止する。再読込とタブ終了には dirty または保存中に限りブラウザ標準の `beforeunload` を使う。draft を localStorage に保存しない。

確認を取り消せば draft を保ち、破棄すれば snapshot に戻す。モーダルは Radix のフォーカス trap を使い、背後の一覧操作を閉じるまで遮る。閉じた後は起点へ、起点が消えた場合は呼び出し元が渡す一覧見出しなどへフォーカスを戻す。

長い一覧の深い行から開いた場合、編集の開始、モーダル内の操作切替、閉じる操作で一覧のスクロール位置を動かさない。別対象を開くときはモーダルを閉じてから選ぶ。見出しや入力欄、閉じた後の起点にフォーカスするときは `preventScroll` を指定する。

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

# フォームを追加・修正するとき

取引フォームの基準実装は [transactions.tsx](../../packages/frontend/src/routes/transactions.tsx) を参照する。
通常取引と振替の payload は選択した種別に合わせ、不要な振替先を送らない。
振替は片側口座だけでもよく、両側を選ぶ場合は別口座かつ同一通貨にする。通常取引では対象口座を必須とする。
保存欄には変更前後と残高への影響を示し、保存後に取引・口座・残高グラフを再取得する。
全口座表示から開いた場合は口座を未選択にし、個別口座表示から開いた場合は利用可能な選択中口座を引き継ぐ。

給与明細は `/salaries/new` と `/salaries/:id/edit` の `EditPage` を使う。
直 URL は個別 API で読み、存在しない場合は再試行と一覧への戻り道を示す。
一覧の `year` は保存・キャンセル後も保つ。
すべての金額を文字列 draft で保持し、許容する符号と導出値は [給与台帳](../concepts/salary-ledger.md)に従う。
その他の控除・拠出欄は、既存値または入力エラーがあれば開く。
保存後は個別取得を明示的に行い、取得失敗は読み取りだけ再試行する。

画面ルートは表示とタブの組み立てを担当し、入力変換・検証と編集状態は機能別のフォームへ置く。
UI 上の円表示だけで検証を省かず、API へ渡す前に最小単位と int32 の制約を確認する。

# 検証とデモ画像

| 確認事項 | 自動検証の主な場所 |
|---|---|
| 320／375／414／768／1280／1440／1920px、画面高600px、同一 draft と保存欄、中央配置と一覧幅の維持 | `e2e/editing-ui.spec.ts` |
| 長い一覧の深い行から編集を開く・対象や操作を切り替える・閉じるときのスクロールとフォーカス | `e2e/editing-scroll.spec.ts` |
| Tab／Shift+Tab／Esc、破棄確認、別対象、ルート、戻る、再読込の離脱保護 | `e2e/editing-ui.spec.ts`、`e2e/recurring.spec.ts`、`packages/frontend/src/components/editing/*.test.tsx` |
| 取引の必須項目、外貨、mutation失敗、保存後の再取得失敗、二重送信 | `e2e/transactions.spec.ts` |
| 404 と 409 の区別、draft 保持、再送回数 | `e2e/editing-ui.spec.ts` |
| 予定収支の基本情報、将来額、履歴訂正、確定との分離 | `e2e/recurring.spec.ts`、`e2e/dashboard.spec.ts` |
| 口座の基本情報、照合、外貨 | `e2e/accounts.spec.ts` |
| 給与の直URL、全項目、負数、保存後の再取得、専用ページから一回で破棄 | `e2e/salaries.spec.ts`、`e2e/editing-ui.spec.ts` |
| カードの仮定額、月次請求、請求月の適用期間 | `e2e/credit-cards.spec.ts`、`e2e/scenarios/credit-card-flow.spec.ts` |
| サブスク、ローン、立替、寄附、設定の固有操作 | 同名の `e2e/*.spec.ts` |
| API トークン発行後の一度だけの表示と失効 | `e2e/auth.spec.ts` |

幅 640×450px の emulation は、1280×900px 表示をブラウザで約200%に拡大したときの**レイアウト幅の近似**として扱う。実際のブラウザ zoom と device pixel ratio の検証は手動の画面確認が必要であり、この emulation の成功を実 zoom の成功とは記録しない。

# デモ画像の更新

画像は `e2e/editing-ui.spec.ts` が専用DBに投入したデモ口座と予定収支だけで撮影する。`SUI_CAPTURE_EDITING_DEMO=1 make test-e2e E2E_ARGS='e2e/editing-ui.spec.ts'` で更新できる。画像は表示の確認に使い、保存時の API 呼び出しや金額の正しさは E2E assertion で確認する。

| 状態 | 画像 |
|---|---|
| 予定収支の基本編集 | [広幅](../assets/editing-ui/wide.png)・[狭幅の未保存 draft](../assets/editing-ui/narrow-dirty.png) |
| 未保存の変更 | [dirty](../assets/editing-ui/dirty.png) |
| 入力エラー | [項目エラー](../assets/editing-ui/input-error.png) |
| 保存エラー | [API 500 の表示](../assets/editing-ui/save-error.png) |

# 関連

- [業務規則](../concepts/index.md)
- [テストの書き方](../operations/testing.md)
