import { INT4_MAX, hasOverlappingAssumptions, isValidYearMonth, type Account, type BillingAssumption, type CreditCard, type DateShiftPolicy } from "@sui/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccountSelect, DateShiftField, DayOfMonthField } from "../components/form-fields";
import { EditModal, EditModalLayout, type EditChange } from "../components/editing/edit-surface";
import { Button } from "../components/ui/button";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Disclosure } from "../components/ui/disclosure";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { MoneyInput, readMoneyDraft } from "../components/ui/money-input";
import { useAssumptionSuggestion } from "../hooks/use-assumption-suggestion";
import { useEditSession, type EditErrors } from "../hooks/use-edit-session";
import { useFieldValidation } from "../hooks/use-field-validation";
import { apiFetch } from "../lib/api";
import { formatCurrency, formatCurrencyInputValue } from "../lib/format";
import { getCurrentYearMonth } from "../lib/utils";

export type CardBasic = { name: string; settlementDay: number | null; dateShiftPolicy: DateShiftPolicy; accountId: string; sortOrder: number };
type PeriodDraft = { amountRaw: string; startMonth: string; endMonth: string };
type Draft = { basic: CardBasic; periods: PeriodDraft[]; period: PeriodDraft };
export type CardSelection = { card: CreditCard; mode: "detail" | "basic"; key: number; origin?: HTMLElement | null };
type Mode = "detail" | "basic" | "add" | "correct" | "delete";

export const cardImpact = "該当する請求月の未確定予測に反映します。登録済み実額との優先規則は維持し、確定済み取引と口座残高は変更しません。";
const emptyPeriod = (): PeriodDraft => ({ amountRaw: "", startMonth: "", endMonth: "" });
const toPeriod = (period: BillingAssumption): PeriodDraft => ({ amountRaw: formatCurrencyInputValue(period.amount, "JPY"), startMonth: period.startMonth ?? "", endMonth: period.endMonth ?? "" });
const fromCard = (card: CreditCard): CardBasic => ({ name: card.name, settlementDay: card.settlementDay, dateShiftPolicy: card.dateShiftPolicy, accountId: card.accountId ?? "", sortOrder: card.sortOrder });
const blankBasic = (): CardBasic => ({ name: "", settlementDay: 27, dateShiftPolicy: "none", accountId: "", sortOrder: 0 });
const initialCreate = (): Draft => ({ basic: blankBasic(), periods: [emptyPeriod()], period: emptyPeriod() });
const initialEdit = (card: CreditCard, periodIndex = 0): Draft => ({ basic: fromCard(card), periods: card.assumptions.map(toPeriod), period: card.assumptions[periodIndex] ? toPeriod(card.assumptions[periodIndex]) : emptyPeriod() });
const parsedPeriod = (period: PeriodDraft): BillingAssumption => ({ amount: readMoneyDraft(period.amountRaw, "JPY").minorUnits!, startMonth: period.startMonth || null, endMonth: period.endMonth || null });
const periodText = (period: BillingAssumption) => `${period.startMonth ?? "制限なし"} 〜 ${period.endMonth ?? "制限なし"}`;
const accountName = (accounts: Account[], id: string) => accounts.find((account) => account.id === id)?.name ?? "未設定";

export function cardBasicPayload(basic: CardBasic) {
  return { name: basic.name.trim(), settlementDay: basic.settlementDay, dateShiftPolicy: basic.dateShiftPolicy, accountId: basic.accountId, sortOrder: basic.sortOrder };
}
export function cardAssumptionPayload(card: CreditCard, periods: BillingAssumption[]) {
  return { ...cardBasicPayload(fromCard(card)), assumptions: periods };
}
function validateBasic(basic: CardBasic, accounts: Account[]): EditErrors {
  const errors: EditErrors = {};
  if (!basic.name.trim()) errors.name = "カード名を入力してください。";
  else if (basic.name.trim().length > 100) errors.name = "100文字以内で入力してください。";
  if (!basic.accountId || !accounts.some((account) => account.id === basic.accountId)) errors.accountId = "引き落とし口座を選択してください。";
  if (basic.settlementDay !== null && (!Number.isInteger(basic.settlementDay) || basic.settlementDay < 1 || basic.settlementDay > 31)) errors.settlementDay = "1〜31で入力してください。";
  if (!Number.isInteger(basic.sortOrder) || basic.sortOrder < -INT4_MAX - 1 || basic.sortOrder > INT4_MAX) errors.sortOrder = "表示順を整数で入力してください。";
  return errors;
}
export function validatePeriod(period: PeriodDraft): EditErrors {
  const errors: EditErrors = {};
  const amount = readMoneyDraft(period.amountRaw, "JPY");
  if (amount.kind !== "valid" || amount.minorUnits === null || amount.minorUnits < 0 || amount.minorUnits > INT4_MAX) errors.amount = "0円以上の有効な金額を入力してください。";
  if (period.startMonth && !isValidYearMonth(period.startMonth)) errors.startMonth = "実在する請求月を入力してください。";
  if (period.endMonth && !isValidYearMonth(period.endMonth)) errors.endMonth = "実在する請求月を入力してください。";
  if (period.startMonth && period.endMonth && period.startMonth > period.endMonth) errors.endMonth = "終了月は開始月以降にしてください。";
  return errors;
}
export function validatePeriods(periods: PeriodDraft[]): EditErrors {
  const errors: EditErrors = {};
  periods.forEach((period, index) => Object.entries(validatePeriod(period)).forEach(([key, value]) => { errors[`period-${index}-${key}`] = value; }));
  if (Object.keys(errors).length === 0 && hasOverlappingAssumptions(periods.map(parsedPeriod))) errors.periods = "同じカードの適用請求月は重複できません。";
  return errors;
}
function basicChanges(before: CardBasic, after: CardBasic, accounts: Account[]): EditChange[] {
  const entries: Array<[keyof CardBasic, string, (value: CardBasic[keyof CardBasic]) => string]> = [
    ["name", "カード名", String],
    ["settlementDay", "引落日", (v) => v === null ? "既定値" : `${v}日`],
    ["dateShiftPolicy", "営業日シフト", (v) => v === "none" ? "なし" : v === "previous" ? "前営業日" : "翌営業日"],
    ["accountId", "引き落とし口座", (v) => accountName(accounts, String(v))],
    ["sortOrder", "表示順", String],
  ];
  return entries.filter(([key]) => before[key] !== after[key]).map(([key, label, display]) => ({ label, before: display(before[key]), after: display(after[key]) }));
}
function BasicFields({ value, onChange, accounts, errors = {}, prefix, onTouched }: { value: CardBasic; onChange: (next: CardBasic) => void; accounts: Account[]; errors?: EditErrors; prefix: string; onTouched?: (field: string) => void }) {
  const set = (patch: Partial<CardBasic>) => onChange({ ...value, ...patch });
  const [detailsOpen, setDetailsOpen] = useState(false);
  return <div className="grid gap-4" onBlurCapture={(event) => {
    const fields: Record<string, string> = { [`${prefix}-name`]: "name", [`${prefix}-day`]: "settlementDay", [`${prefix}-account`]: "accountId", [`${prefix}-sort`]: "sortOrder" };
    const field = fields[(event.target as HTMLElement).id]; if (field) onTouched?.(field);
  }}>
    <FormField label="カード名" htmlFor={`${prefix}-name`} required error={errors.name}>
      <Input id={`${prefix}-name`} value={value.name} onChange={(event) => set({ name: event.target.value })} />
    </FormField>
    <DayOfMonthField id={`${prefix}-day`} required={false} error={errors.settlementDay} value={value.settlementDay} onChange={(settlementDay) => set({ settlementDay })} />
    <AccountSelect id={`${prefix}-account`} label="引き落とし口座" accounts={accounts} value={value.accountId} error={errors.accountId} onChange={(accountId) => set({ accountId })} />
    <DateShiftField id={`${prefix}-shift`} value={value.dateShiftPolicy} onChange={(dateShiftPolicy) => set({ dateShiftPolicy })} />
    <Disclosure summary="詳細設定" open={detailsOpen || Boolean(errors.sortOrder)} onOpenChange={setDetailsOpen}><FormField label="表示順" htmlFor={`${prefix}-sort`} error={errors.sortOrder}>
      <Input id={`${prefix}-sort`} type="number" value={value.sortOrder} onChange={(event) => set({ sortOrder: event.target.value === "" ? Number.NaN : Number(event.target.value) })} />
    </FormField></Disclosure>
  </div>;
}
function PeriodFields({ value, onChange, errors = {}, prefix, number, onTouched }: { value: PeriodDraft; onChange: (next: PeriodDraft) => void; errors?: EditErrors; prefix: string; number?: number; onTouched?: (field: string) => void }) {
  const suffix = number ? ` ${number}` : "";
  return <div className="grid gap-3" onBlurCapture={(event) => {
    const fields: Record<string, string> = { [`${prefix}-amount`]: "amount", [`${prefix}-start`]: "startMonth", [`${prefix}-end`]: "endMonth" };
    const field = fields[(event.target as HTMLElement).id]; if (field) onTouched?.(field);
  }}>
    <FormField label={`金額${suffix}`} htmlFor={`${prefix}-amount`} required error={errors.amount}>
      <MoneyInput id={`${prefix}-amount`} currencyCode="JPY" value={readMoneyDraft(value.amountRaw, "JPY").minorUnits} draftValue={value.amountRaw} draftKey={prefix}
        onChange={() => {}} onDraftChange={(draft) => onChange({ ...value, amountRaw: draft.raw })} />
    </FormField>
    <div className="grid gap-3 sm:grid-cols-2">
      <FormField label={`開始月${suffix}`} htmlFor={`${prefix}-start`} error={errors.startMonth}>
        <Input id={`${prefix}-start`} type="month" value={value.startMonth} onChange={(event) => onChange({ ...value, startMonth: event.target.value })} />
      </FormField>
      <FormField label={`終了月${suffix}`} htmlFor={`${prefix}-end`} error={errors.endMonth}>
        <Input id={`${prefix}-end`} type="month" value={value.endMonth} onChange={(event) => onChange({ ...value, endMonth: event.target.value })} />
      </FormField>
    </div>
  </div>;
}

export function CreditCardCreateModal({ open, accounts, onClose, onSaved }: { open: boolean; accounts: Account[]; onClose: () => void; onSaved: () => Promise<CreditCard[]> }) {
  const [key, setKey] = useState(0);
  const session = useEditSession<Draft>({ identity: `card:create:${key}`, initial: initialCreate(), validate: (draft) => ({ ...validateBasic(draft.basic, accounts), ...validatePeriods(draft.periods) }),
    fieldIds: { name: "card-create-name", settlementDay: "card-create-day", accountId: "card-create-account", sortOrder: "card-create-sort", periods: "card-create-period-0-start", "period-0-amount": "card-create-period-0-amount", "period-0-startMonth": "card-create-period-0-start", "period-0-endMonth": "card-create-period-0-end" } });
  const validation = useFieldValidation(session.draft, (draft) => ({ ...validateBasic(draft.basic, accounts), ...validatePeriods(draft.periods) }));
  const requestClose = () => session.requestClose(onClose);
  const save = async () => {
    validation.showAll();
    const succeeded = await session.save(async (draft) => {
      await apiFetch("/api/credit-cards", { method: "POST", body: JSON.stringify({ ...cardBasicPayload(draft.basic), assumptions: draft.periods.map(parsedPeriod) }) });
    }, async () => { await onSaved(); return session.draft; });
    if (succeeded) { onClose(); setKey((value) => value + 1); validation.reset(); }
  };
  const retryRefresh = async () => { if (await session.retryRefresh()) { onClose(); setKey((value) => value + 1); } };
  return <EditModal open={open} onRequestClose={requestClose} subjectType="カード" subjectName="カード" mode="create" status={session.status}
    error={session.error} impact={cardImpact} changes={session.dirty ? [
      ...basicChanges(blankBasic(), session.draft.basic, accounts),
      { label: "仮定額の期間", before: "未登録", after: session.draft.periods.length ? session.draft.periods.map((period) => `${period.amountRaw || "未入力"}円・${period.startMonth || "制限なし"} 〜 ${period.endMonth || "制限なし"}`).join("、") : "設定なし" },
    ] : []}
    saveLabel="カードを追加" onSave={save} onRetryRefresh={retryRefresh}>
    <form className="grid gap-5" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <BasicFields prefix="card-create" value={session.draft.basic} accounts={accounts} errors={validation.visibleErrors}
        onChange={(basic) => session.setDraft((draft) => ({ ...draft, basic }))} onTouched={validation.touch} />
      <section className="grid gap-3" aria-label="初期の仮定額期間">
        <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-medium">仮定額の期間</h3>
          <Button type="button" variant="secondary" className="shrink-0 whitespace-nowrap" onClick={() => session.setDraft((draft) => ({ ...draft, periods: [...draft.periods, emptyPeriod()] }))}>期間を追加</Button></div>
        <p className="text-xs text-ink-2">請求月で判定し、開始月と終了月を含みます。空欄の側は無期限です。期間の空白は許容します。</p>
        {session.draft.periods.map((period, index) => <div key={index} className="grid gap-3 rounded-xl border border-line p-3">
          <div className="flex items-center justify-between"><span className="text-sm font-medium">仮定額 {index + 1}</span>
            <Button type="button" variant="ghost" onClick={() => session.setDraft((draft) => ({ ...draft, periods: draft.periods.filter((_, i) => i !== index) }))}>削除</Button></div>
          <PeriodFields prefix={`card-create-period-${index}`} number={index + 1} value={period}
            errors={{ amount: validation.visibleErrors[`period-${index}-amount`], startMonth: validation.visibleErrors[`period-${index}-startMonth`], endMonth: validation.visibleErrors[`period-${index}-endMonth`] }}
            onChange={(next) => session.setDraft((draft) => ({ ...draft, periods: draft.periods.map((item, i) => i === index ? next : item) }))} onTouched={(field) => validation.touch(`period-${index}-${field}`)} />
        </div>)}
        {validation.visibleErrors.periods && <p role="alert" className="text-xs text-critical">{validation.visibleErrors.periods}</p>}
      </section>
      <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">カードを追加</button>
    </form>
  </EditModal>;
}

export function CreditCardEditorLayout({ children, selection, accounts, onClose, onSaved, transitionRef }: { children: ReactNode; selection: CardSelection | null; accounts: Account[]; onClose: () => void; onSaved: () => Promise<CreditCard[]>; transitionRef: { current: ((action: () => void) => void) | null } }) {
  const [savedCard, setSavedCard] = useState<CreditCard | null>(selection?.card ?? null);
  const [selectionKey, setSelectionKey] = useState(selection?.key ?? 0);
  const [mode, setMode] = useState<Mode>(selection?.mode ?? "detail");
  const [periodIndex, setPeriodIndex] = useState(0);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const originRef = useRef<HTMLElement | null>(null);
  const fallbackFocusRef = useRef<HTMLDivElement>(null);
  const suggestion = useAssumptionSuggestion();
  const [pendingSuggestion, setPendingSuggestion] = useState<{ index: number; amount: number } | null>(null);
  if (selection && selection.key !== selectionKey) {
    setSelectionKey(selection.key); setSavedCard(selection.card); setMode(selection.mode); setPeriodIndex(0); setDeleteIndex(null);
  }
  const card = selection?.key === selectionKey ? savedCard ?? selection.card : selection?.card ?? null;
  const initial = card ? initialEdit(card, periodIndex) : initialCreate();
  if (mode === "add") initial.period = emptyPeriod();
  const validate = (draft: Draft): EditErrors => {
    if (mode === "basic") return validateBasic(draft.basic, accounts);
    if (mode === "add" || mode === "correct") {
      const errors = validatePeriod(draft.period);
      if (Object.keys(errors).length === 0 && card) {
        const periods = mode === "add" ? [...card.assumptions, parsedPeriod(draft.period)] : card.assumptions.map((period, i) => i === periodIndex ? parsedPeriod(draft.period) : period);
        if (hasOverlappingAssumptions(periods)) errors.startMonth = "同じカードの適用請求月は重複できません。";
      }
      return errors;
    }
    return {};
  };
  const session = useEditSession<Draft>({ identity: `card:${selection?.key ?? 0}:${card?.id ?? ""}:${mode}:${periodIndex}`, initial, validate,
    fieldIds: { name: "card-basic-name", settlementDay: "card-basic-day", accountId: "card-basic-account", sortOrder: "card-basic-sort", amount: "card-period-amount", startMonth: "card-period-start", endMonth: "card-period-end" } });
  if (pendingSuggestion?.index === periodIndex && (mode === "add" || mode === "correct") && session.status === "idle") {
    session.setDraft((draft) => ({ ...draft, period: { ...draft.period, amountRaw: formatCurrencyInputValue(pendingSuggestion.amount, "JPY") } }));
    setPendingSuggestion(null);
  }
  const validation = useFieldValidation(session.draft, validate);
  useEffect(() => { transitionRef.current = session.requestTransition; return () => { transitionRef.current = null; }; }, [session.requestTransition, transitionRef]);
  useEffect(() => { if (selection) originRef.current = selection.origin ?? null; }, [selection]);
  const requestClose = () => session.requestClose(onClose);
  const openMode = (next: Mode, index = 0) => session.requestTransition(() => { validation.reset(); suggestion.reset(); setPendingSuggestion(null); setPeriodIndex(index); setMode(next); });
  const refresh = async (): Promise<Draft> => {
    const cards = await onSaved();
    const latest = cards.find((item) => item.id === card?.id);
    if (!latest) throw new Error("カードが見つかりません。");
    setSavedCard(latest);
    return initialEdit(latest, periodIndex);
  };
  const save = async () => {
    if (!card) return;
    validation.showAll();
    const succeeded = await session.save(async (draft) => {
      let payload: ReturnType<typeof cardBasicPayload> | ReturnType<typeof cardAssumptionPayload>;
      if (mode === "basic") payload = cardBasicPayload(draft.basic);
      else {
        const periods = mode === "add" ? [...card.assumptions, parsedPeriod(draft.period)] : mode === "delete" ? card.assumptions.filter((_, i) => i !== periodIndex) : card.assumptions.map((period, i) => i === periodIndex ? parsedPeriod(draft.period) : period);
        payload = cardAssumptionPayload(card, periods);
      }
      const updated = await apiFetch<CreditCard>(`/api/credit-cards/${card.id}`, { method: "PUT", body: JSON.stringify(payload) });
      setSavedCard(updated);
    }, refresh);
    if (succeeded) { validation.reset(); setMode("detail"); }
  };
  const retryRefresh = async () => { if (await session.retryRefresh()) setMode("detail"); };
  const deletePeriod = async () => { setDeleteIndex(null); await save(); };
  const changes: EditChange[] = mode === "basic" && card ? basicChanges(fromCard(card), session.draft.basic, accounts)
    : (mode === "add" || mode === "correct") && card ? [
      { label: "仮定額", before: mode === "add" ? "未設定" : formatCurrency(card.assumptions[periodIndex]?.amount ?? 0), after: session.draft.period.amountRaw || "未入力" },
      { label: "適用請求月", before: mode === "add" ? "未設定" : periodText(card.assumptions[periodIndex]), after: `${session.draft.period.startMonth || "制限なし"} 〜 ${session.draft.period.endMonth || "制限なし"}` },
    ] : [];
  const currentMonth = getCurrentYearMonth();
  const body = card ? mode === "detail" ? <div className="grid gap-4 text-sm">
    <dl className="grid gap-3 rounded-xl border border-line p-4">
      <div><dt className="text-ink-3">引き落とし口座</dt><dd>{card.account?.name ?? "未設定"}</dd></div>
      <div><dt className="text-ink-3">引落日</dt><dd>毎月 {card.settlementDay ?? 27} 日</dd></div>
      <div><dt className="text-ink-3">営業日シフト</dt><dd>{card.dateShiftPolicy === "none" ? "なし" : card.dateShiftPolicy === "previous" ? "前営業日" : "翌営業日"}</dd></div>
    </dl>
    <Button variant="secondary" onClick={() => openMode("basic")}>基本情報を編集</Button>
    <section className="grid gap-3" aria-label="仮定額と適用請求月">
      <h3 className="font-semibold">仮定額と適用請求月</h3>
      <p className="text-xs text-ink-2">請求月の両端を含みます。空欄の側は無期限です。期間の空白は許容し、重複はできません。</p>
      <Button variant="secondary" onClick={() => openMode("add")}>期間を追加</Button>
      {card.assumptions.length === 0 && <p>仮定額の期間はありません。</p>}
      {card.assumptions.map((period, index) => ({ period, index })).sort((a, b) => (a.period.startMonth ?? "").localeCompare(b.period.startMonth ?? ""))
        .map(({ period, index }) => {
          const label = `${periodText(period)}の仮定額`;
          const state = period.endMonth && period.endMonth < currentMonth ? "過去" : period.startMonth && period.startMonth > currentMonth ? "将来" : "適用中";
          return <div key={index} className="rounded-xl border border-line p-3">
            <div className="font-data">{formatCurrency(period.amount)}・JPY</div>
            <div className="text-xs text-ink-3">{periodText(period)}・{state}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="ghost" aria-label={`${label}を訂正`} onClick={() => openMode("correct", index)}>訂正</Button>
              <Button variant="ghost" aria-label={`${label}を削除`} onClick={() => openMode("delete", index)}>削除</Button>
            </div>
          </div>;
        })}
      <div className="rounded-xl border border-line bg-surface-2 p-3 text-xs"><div className="flex items-center justify-between"><span>過去実績の提案</span><Button variant="ghost" onClick={() => void suggestion.load(card.id)}>過去実績から提案</Button></div>
        {suggestion.error && <p role="alert">{suggestion.error}</p>}{suggestion.suggestion && <div><span>提案額 {formatCurrency(suggestion.suggestion.suggestedAmount ?? 0)}</span>・{suggestion.suggestion.sampleCount} 件
          {suggestion.suggestion.suggestedAmount !== null && <Button variant="ghost" onClick={() => {
            const index = Math.max(0, card.assumptions.length - 1);
            setPeriodIndex(index); setMode(card.assumptions.length ? "correct" : "add");
            setPendingSuggestion({ index, amount: suggestion.suggestion!.suggestedAmount! });
          }}>最後の期間に反映</Button>}</div>}</div>
    </section>
  </div> : mode === "basic" ? <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <BasicFields prefix="card-basic" value={session.draft.basic} accounts={accounts} errors={validation.visibleErrors} onChange={(basic) => session.setDraft((draft) => ({ ...draft, basic }))} onTouched={validation.touch} />
    <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">変更を保存</button>
  </form> : mode === "delete" ? <div className="grid gap-3 text-sm"><p>{card.assumptions[periodIndex] ? periodText(card.assumptions[periodIndex]) : "対象期間"} の仮定額を削除します。</p><p>{cardImpact}</p></div> : <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <PeriodFields prefix="card-period" value={session.draft.period} errors={validation.visibleErrors} onChange={(period) => session.setDraft((draft) => ({ ...draft, period }))} onTouched={validation.touch} />
    <p className="text-xs text-ink-2">適用請求月の未確定予測に反映します。登録済み実額と確定済み取引は維持します。</p>
    <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">{mode === "add" ? "期間を追加" : "訂正を保存"}</button>
  </form> : null;
  return <>
    <EditModalLayout open={Boolean(selection)} onRequestClose={requestClose} originRef={originRef} fallbackFocusRef={fallbackFocusRef}
      editor={{ subjectType: "カード", subjectName: card?.name ?? "カード", title: mode === "add" ? `${card?.name}の仮定額期間を追加` : mode === "correct" ? `${card?.name}の仮定額期間を訂正` : undefined,
        mode: mode === "detail" ? "detail" : mode === "basic" ? "edit" : mode === "add" ? "schedule" : "correct",
        status: session.status, error: session.error, changes, impact: mode === "detail" ? undefined : cardImpact,
        saveLabel: mode === "add" ? "期間を追加" : mode === "delete" ? "削除を確認" : undefined, onSave: mode === "delete" ? () => setDeleteIndex(periodIndex) : save, onRetryRefresh: retryRefresh, children: mode === "detail" ? body : <div className="grid gap-4"><Button variant="ghost" onClick={() => openMode("detail")}>編集メニューに戻る</Button>{body}</div> }}>
      <div ref={fallbackFocusRef} tabIndex={-1}>{children}</div>
    </EditModalLayout>
    <ConfirmDialog open={deleteIndex !== null} onOpenChange={(open) => !open && setDeleteIndex(null)} title="仮定額の期間を削除しますか？"
      description={deleteIndex !== null && card ? `${periodText(card.assumptions[deleteIndex])} の仮定額を削除します。未確定予測が変わる可能性があります。` : undefined}
      onConfirm={() => void deletePeriod()} />
  </>;
}
