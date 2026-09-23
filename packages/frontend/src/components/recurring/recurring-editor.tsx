import { addCalendarDays, INT4_MAX, isOneTimeSchedule, type Account, type RecurringItem, type RecurringItemAmountChange } from "@sui/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ScheduleField } from "../ScheduleField";
import { AccountSelect, DateShiftField, PeriodFields } from "../form-fields";
import { EditModal, EditPanelLayout, type EditChange } from "../editing/edit-surface";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Disclosure } from "../ui/disclosure";
import { FormField } from "../ui/form-field";
import { Input } from "../ui/input";
import { MoneyInput, readMoneyDraft } from "../ui/money-input";
import { SegmentedControl } from "../ui/segmented-control";
import { SwitchField } from "../ui/switch";
import { useEditSession } from "../../hooks/use-edit-session";
import { useFieldValidation } from "../../hooks/use-field-validation";
import { apiFetch } from "../../lib/api";
import { formatCurrency, formatCurrencyInputValue, formatDateWithYear } from "../../lib/format";
import { getTodayDate } from "../../lib/utils";
import { formFromRecurring, getRecurringFormCurrencyCode, getRecurringItemCurrencyCode, newRecurringForm, normalizeTransferToAccountId, recurringBasicPayload, recurringInitialCorrectionPayload, recurringPayload, validateRecurringForm, type RecurringForm } from "./recurring-form";

type EditorMode = "detail" | "basic" | "history" | "schedule" | "initial" | "change" | "delete";
export type RecurringEditorSelection = { item: RecurringItem; mode: EditorMode; changeId?: string; key: number; origin?: HTMLElement | null };

const impact = "未確定の予測に反映します。確定済み取引と口座残高は変更しません。";
const historyImpact = "過去の未確定予測にも影響する可能性があります。確定済み取引と口座残高は変更しません。";

function amountRaw(amount: number, item: RecurringItem) {
  return formatCurrencyInputValue(amount, getRecurringItemCurrencyCode(item));
}

function recurringAmountError(raw: string, item: RecurringItem) {
  const parsed = readMoneyDraft(raw, getRecurringItemCurrencyCode(item));
  return parsed.kind !== "valid" || parsed.minorUnits === null || parsed.minorUnits < 0 || parsed.minorUnits > INT4_MAX
    ? "0以上の有効な金額を入力してください。" : null;
}

function nextChange(item: RecurringItem, today: string) {
  return [...(item.amountChanges ?? [])].filter((change) => change.effectiveFrom > today)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0] ?? null;
}

function getChange(item: RecurringItem, id: string | undefined) {
  return item.amountChanges?.find((change) => change.id === id) ?? null;
}

function formatScheduleLabel(item: RecurringItem) {
  if (isOneTimeSchedule(item)) return `単発・${formatDateWithYear(item.startDate!)}`;
  if (item.recurrence === "weekly") return `${item.interval === 1 ? "毎週" : `${item.interval}週ごと`}・曜日 ${item.dayOfWeek}`;
  return `${item.interval === 1 ? "毎月" : `${item.interval}か月ごと`} ${item.dayOfMonth}日`;
}

function FieldRows({ form, onChange, accounts, today, idPrefix, amount, amountError, onAmountChange, onTouched, errors = {}, startDateError }: {
  form: RecurringForm; onChange: (form: RecurringForm) => void; accounts: Account[]; today: string;
  idPrefix: string;
  amount?: string; amountError?: string | null; onAmountChange?: (raw: string) => void;
  onTouched?: (field: string) => void;
  errors?: Record<string, string>; startDateError?: string | null;
}) {
  const prefix = idPrefix;
  const currency = getRecurringFormCurrencyCode(form, accounts);
  const destinationAccounts = accounts.filter((account) => !form.accountId ||
    account.id !== form.accountId && account.currencyCode === currency);
  const oneTime = form.oneTime || isOneTimeSchedule(form);
  const set = (patch: Partial<RecurringForm>) => onChange({ ...form, ...patch });
  return <div className="grid gap-5" onBlurCapture={(event) => {
    const id = (event.target as HTMLElement).id;
    const fields: Record<string, string> = {
      [`${prefix}-name`]: "name", [`${prefix}-amount`]: "amount",
      [`${prefix}-account`]: "accountId", [`${prefix}-destination`]: "transferToAccountId",
      [`${prefix}-schedule-day`]: form.recurrence === "monthly" ? "dayOfMonth" : "dayOfWeek",
      [`${prefix}-schedule-one-time-date`]: "startDate", [`${prefix}-period-start`]: "startDate",
      [`${prefix}-period-end`]: "endDate", [`${prefix}-sort`]: "sortOrder",
    };
    if (fields[id]) onTouched?.(fields[id]);
  }}>
    <section className="grid gap-3" aria-label="内容と種別">
      <FormField label="カテゴリ名" htmlFor={`${prefix}-name`} required error={errors.name}>
        <Input id={`${prefix}-name`} value={form.name} required onChange={(event) => set({ name: event.target.value })} />
      </FormField>
      <FormField label="種別" htmlFor={`${prefix}-type`}>
        <SegmentedControl aria-label="種別" value={form.type} options={[
          { value: "income", label: "収入" }, { value: "expense", label: "支出" }, { value: "transfer", label: "振替" },
        ]} onChange={(type) => {
          const next = { ...form, type };
          onChange({ ...next, transferToAccountId: normalizeTransferToAccountId(next, accounts) });
        }} />
      </FormField>
      {amount !== undefined && onAmountChange && <FormField label={`金額 (${currency})`} htmlFor={`${prefix}-amount`} required error={amountError}>
        <MoneyInput id={`${prefix}-amount`} currencyCode={currency} value={readMoneyDraft(amount, currency).minorUnits}
          draftKey={`${prefix}:${currency}`} draftValue={amount} onDraftChange={(next) => onAmountChange(next.raw)} onChange={() => {}} />
      </FormField>}
    </section>
    <section className="grid gap-3" aria-label="スケジュール">
      <ScheduleField id={`${prefix}-schedule`} value={form} today={today} allowOneTime onChange={(next) => onChange({ ...form, ...next })} />
      {!oneTime && <PeriodFields idPrefix={`${prefix}-period`} startDate={form.startDate ?? ""} endDate={form.endDate ?? ""}
        startRequired={form.interval > 1} onChangeStartDate={(value) => {
          const startDate = value || null;
          onChange({ ...form, startDate, ...(form.recurrence === "monthly" && form.interval === 12 && startDate ? { dayOfMonth: Number(startDate.slice(8, 10)) } : {}) });
        }} onChangeEndDate={(value) => set({ endDate: value || null })}
        error={startDateError ?? errors.startDate ?? errors.endDate} />}
    </section>
    <section className="grid gap-3" aria-label="対象口座">
      <AccountSelect id={`${prefix}-account`} label={form.type === "income" ? "振り込み先口座" : form.type === "transfer" ? "送金元口座" : "引き落とし口座"}
        accounts={accounts} value={form.accountId} required={form.type !== "transfer"} error={errors.accountId}
        placeholder={form.type === "transfer" ? "送金元口座なし" : "対象口座を選択"} onChange={(accountId) => {
          const next = { ...form, accountId }; onChange({ ...next, transferToAccountId: normalizeTransferToAccountId(next, accounts) });
        }} />
      {form.type === "transfer" && <AccountSelect id={`${prefix}-destination`} label="振替先口座" accounts={destinationAccounts}
        value={form.transferToAccountId} error={errors.transferToAccountId} required={false} placeholder="振替先口座なし"
        onChange={(transferToAccountId) => set({ transferToAccountId })} />}
    </section>
    <Disclosure summary="詳細設定">
      <div className="grid gap-3">
        <DateShiftField id={`${prefix}-shift`} value={form.dateShiftPolicy} onChange={(dateShiftPolicy) => set({ dateShiftPolicy })} />
        <FormField label="表示順" htmlFor={`${prefix}-sort`} error={errors.sortOrder}>
          <Input id={`${prefix}-sort`} type="number" inputMode="numeric" value={form.sortOrder} onChange={(event) => set({ sortOrder: Number(event.target.value) })} />
        </FormField>
        <SwitchField label="有効" checked={form.enabled} onChange={(enabled) => set({ enabled })} />
      </div>
    </Disclosure>
  </div>;
}

type EditorDraft = { form: RecurringForm; date: string; amountRaw: string };
type CreateDraft = { form: RecurringForm; amountRaw: string };

function validateCreateDraft(draft: CreateDraft, accounts: Account[]) {
  const currency = getRecurringFormCurrencyCode(draft.form, accounts);
  const amount = readMoneyDraft(draft.amountRaw, currency);
  return { ...validateRecurringForm(draft.form, accounts, false), ...(amount.kind !== "valid" || amount.minorUnits === null || amount.minorUnits < 0 || amount.minorUnits > INT4_MAX
    ? { amount: "0以上の有効な金額を入力してください。" } : {}) };
}

function draftFor(item: RecurringItem, mode: EditorMode, change?: RecurringItemAmountChange | null): EditorDraft {
  return { form: formFromRecurring(item), date: change?.effectiveFrom ?? "", amountRaw: amountRaw(change?.amount ??
    (mode === "initial" ? item.amount : item.effectiveAmount ?? item.amount), item) };
}

function formChanges(before: RecurringForm, after: RecurringForm, accounts: Account[]): EditChange[] {
  const accountName = (id: string) => accounts.find((account) => account.id === id)?.name ?? (id ? "削除済みの口座" : "未設定");
  const schedule = (form: RecurringForm) => form.oneTime && form.startDate ? `単発 ${form.startDate}`
    : form.recurrence === "monthly" ? `${form.interval === 1 ? "毎月" : `${form.interval}か月ごと`} ${form.dayOfMonth ?? "?"}日`
      : `${form.interval === 1 ? "毎週" : `${form.interval}週ごと`} 曜日 ${form.dayOfWeek ?? "?"}`;
  const present = (key: keyof RecurringForm, value: RecurringForm[keyof RecurringForm]) => {
    if (key === "accountId" || key === "transferToAccountId") return accountName(String(value ?? ""));
    if (key === "type") return value === "income" ? "収入" : value === "expense" ? "支出" : "振替";
    if (key === "dateShiftPolicy") return value === "none" ? "シフトなし" : value === "previous" ? "前の営業日" : "次の営業日";
    if (key === "enabled") return value ? "有効" : "無効";
    return String(value ?? "未設定");
  };
  const entries: Array<[keyof RecurringForm, string]> = [
    ["name", "カテゴリ名"], ["type", "種別"], ["startDate", "開始日"], ["endDate", "終了日"],
    ["dateShiftPolicy", "営業日シフト"], ["accountId", "口座"], ["transferToAccountId", "振替先"],
    ["enabled", "有効"], ["sortOrder", "表示順"],
  ];
  const result = entries.filter(([key]) => before[key] !== after[key]).map(([key, label]) => ({
    label, before: present(key, before[key]), after: present(key, after[key]),
  }));
  if (schedule(before) !== schedule(after)) result.push({ label: "周期", before: schedule(before), after: schedule(after) });
  return result;
}

export function RecurringCreateModal({ open, accounts, onClose, onSaved }: {
  open: boolean; accounts: Account[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [openedToday, setOpenedToday] = useState(getTodayDate);
  const session = useEditSession<CreateDraft>({ identity: `recurring:create:${openedToday}`, initial: { form: newRecurringForm(), amountRaw: "" },
    validate: (draft) => validateCreateDraft(draft, accounts),
    fieldIds: { name: "recurring-create-name", amount: "recurring-create-amount", accountId: "recurring-create-account",
      transferToAccountId: "recurring-create-destination", dayOfMonth: "recurring-create-schedule-day",
      dayOfWeek: "recurring-create-schedule-day", startDate: "recurring-create-period-start", endDate: "recurring-create-period-end" },
  });
  const validation = useFieldValidation(session.draft, (draft) => validateCreateDraft(draft, accounts));
  const requestClose = () => session.requestClose(onClose);
  const save = async () => {
    validation.showAll();
    const succeeded = await session.save(async (draft) => {
      const currency = getRecurringFormCurrencyCode(draft.form, accounts);
      const parsed = readMoneyDraft(draft.amountRaw, currency);
      await apiFetch("/api/recurring-items", { method: "POST", body: JSON.stringify(recurringPayload(draft.form, parsed.minorUnits!)) });
    }, async () => { await onSaved(); return session.draft; });
    if (succeeded) { onClose(); setOpenedToday(getTodayDate()); validation.reset(); }
  };
  const retryRefresh = async () => { if (await session.retryRefresh()) onClose(); };
  return <EditModal open={open} onRequestClose={requestClose} subjectType="予定収支" subjectName="予定収支" mode="create"
    status={session.status} error={session.error} impact={impact} saveLabel="予定収支を追加" onSave={save} onRetryRefresh={retryRefresh}
    changes={session.dirty ? [{ label: "登録する予定", before: "未登録", after: session.draft.form.name || "入力中" }] : []}>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <FieldRows idPrefix="recurring-create" form={session.draft.form} onChange={(form) => session.setDraft((draft) => ({ ...draft, form }))}
        accounts={accounts} today={openedToday} amount={session.draft.amountRaw}
        amountError={validation.visibleErrors.amount} errors={validation.visibleErrors} onTouched={validation.touch}
        onAmountChange={(amountRaw) => session.setDraft((draft) => ({ ...draft, amountRaw }))} />
      <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">予定収支を追加</button>
    </form>
  </EditModal>;
}

const placeholderItem: RecurringItem = {
  id: "", name: "", type: "expense", amount: 0, amountChanges: [], recurrence: "monthly",
  interval: 1, dayOfMonth: 1, dayOfWeek: null, startDate: null, endDate: null,
  dateShiftPolicy: "none", accountId: null, account: null, transferToAccountId: null,
  transferToAccount: null, enabled: true, sortOrder: 0, deletedAt: null,
  createdAt: "", updatedAt: "",
};

export function RecurringEditorLayout({ children, selection, accounts, onClose, onSaved }: {
  children: ReactNode; selection: RecurringEditorSelection | null; accounts: Account[];
  onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [savedItem, setSavedItem] = useState<RecurringItem>(selection?.item ?? placeholderItem);
  const [targetKey, setTargetKey] = useState(selection?.key ?? 0);
  const [localMode, setLocalMode] = useState<EditorMode>(selection?.mode ?? "detail");
  const [localChangeId, setLocalChangeId] = useState<string | undefined>(selection?.changeId);
  const [openedToday, setOpenedToday] = useState(getTodayDate);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const originRef = useRef<HTMLElement | null>(null);
  const fallbackFocusRef = useRef<HTMLHeadingElement | null>(null);
  if (selection && selection.key !== targetKey) {
    setTargetKey(selection.key);
    setSavedItem(selection.item);
    setLocalMode(selection.mode);
    setLocalChangeId(selection.changeId);
    setOpenedToday(getTodayDate());
  }
  const currentItem = selection?.key === targetKey ? savedItem : selection?.item ?? placeholderItem;
  const mode = selection?.key === targetKey ? localMode : selection?.mode ?? "detail";
  const changeId = selection?.key === targetKey ? localChangeId : selection?.changeId;
  const change = getChange(currentItem, changeId);
  const today = openedToday;
  const validateDraft = (draft: EditorDraft) => {
    if (mode === "basic") {
      const errors = validateRecurringForm(draft.form, accounts, false);
      const earliest = currentItem.amountChanges?.reduce<string | null>((date, entry) => !date || entry.effectiveFrom < date ? entry.effectiveFrom : date, null) ?? null;
      if (draft.form.startDate && earliest && draft.form.startDate >= earliest) errors.startDate = "開始日は最初の金額変更日より前にしてください。";
      return errors;
    }
    if (mode === "schedule" || mode === "change") {
      const errors: Record<string, string> = {};
      const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? new Date(`${draft.date}T00:00:00Z`) : null;
      if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== draft.date) errors.date = "適用開始日を入力してください。";
      if (currentItem.startDate && draft.date <= currentItem.startDate) errors.date = "適用開始日は予定開始日の翌日以降にしてください。";
      const amountError = recurringAmountError(draft.amountRaw, currentItem);
      if (amountError) errors.amount = amountError;
      return errors;
    }
    if (mode === "initial") {
      const amountError = recurringAmountError(draft.amountRaw, currentItem);
      return amountError ? { amount: amountError } : {};
    }
    return {};
  };
  const session = useEditSession<EditorDraft>({
    identity: `recurring:${selection?.key ?? 0}:${currentItem.id}:${mode}:${changeId ?? ""}`,
    initial: draftFor(currentItem, mode, change),
    validate: validateDraft,
    fieldIds: { name: "recurring-basic-name", accountId: "recurring-basic-account", transferToAccountId: "recurring-basic-destination",
      dayOfMonth: "recurring-basic-schedule-day", dayOfWeek: "recurring-basic-schedule-day",
      startDate: "recurring-basic-period-start", endDate: "recurring-basic-period-end", sortOrder: "recurring-basic-sort",
      date: "recurring-editor-effective-date", amount: "recurring-editor-amount" },
  });
  const validation = useFieldValidation(session.draft, validateDraft);

  useEffect(() => {
    if (selection) originRef.current = selection.origin ?? null;
  }, [selection]);

  const openMode = (nextMode: EditorMode, nextChangeId?: string) => session.requestTransition(() => {
    validation.reset();
    setLocalMode(nextMode);
    setLocalChangeId(nextChangeId);
    setDeleteConfirm(false);
  });
  const requestClose = () => session.requestClose(onClose);
  const fetchLatest = async (): Promise<EditorDraft> => {
    const latest = await apiFetch<RecurringItem>(`/api/recurring-items/${currentItem.id}`);
    setSavedItem(latest);
    await onSaved();
    return draftFor(latest, mode, getChange(latest, changeId));
  };
  const save = async () => {
    if (mode === "delete") { setDeleteConfirm(true); return; }
    validation.showAll();
    const succeeded = await session.save(async (draft) => {
      if (mode === "basic") {
        const updated = await apiFetch<RecurringItem>(`/api/recurring-items/${currentItem.id}`, {
          method: "PUT", body: JSON.stringify(recurringBasicPayload(currentItem, draft.form)),
        });
        setSavedItem(updated);
      } else if (mode === "initial") {
        const parsed = readMoneyDraft(draft.amountRaw, getRecurringItemCurrencyCode(currentItem));
        const updated = await apiFetch<RecurringItem>(`/api/recurring-items/${currentItem.id}`, {
          method: "PUT", body: JSON.stringify(recurringInitialCorrectionPayload(currentItem, parsed.minorUnits!)),
        });
        setSavedItem(updated);
      } else if (mode === "schedule" || mode === "change") {
        const parsed = readMoneyDraft(draft.amountRaw, getRecurringItemCurrencyCode(currentItem));
        await apiFetch(`/api/recurring-items/${currentItem.id}/amount-changes${mode === "change" ? `/${changeId}` : ""}`, {
          method: mode === "change" ? "PUT" : "POST",
          body: JSON.stringify({ effectiveFrom: draft.date, amount: parsed.minorUnits }),
        });
      }
    }, fetchLatest);
    if (succeeded) { validation.reset(); setLocalMode("detail"); }
  };
  const confirmDelete = async () => {
    setDeleteConfirm(false);
    const succeeded = await session.save(async () => {
      await apiFetch(`/api/recurring-items/${currentItem.id}/amount-changes/${changeId}`, { method: "DELETE" });
    }, fetchLatest);
    if (succeeded) { validation.reset(); setLocalMode("history"); }
  };
  const retryRefresh = async () => {
    if (await session.retryRefresh()) setLocalMode(mode === "delete" ? "history" : "detail");
  };
  const activeSelectionKey = selection?.key;
  useEffect(() => {
    if (activeSelectionKey) document.querySelector<HTMLElement>(".edit-panel h2")?.focus();
  }, [activeSelectionKey, mode]);
  const currency = getRecurringItemCurrencyCode(currentItem);
  const changes: EditChange[] = mode === "basic"
    ? formChanges(formFromRecurring(currentItem), session.draft.form, accounts)
    : mode === "schedule" || mode === "change"
      ? [
          ...(change?.effectiveFrom !== session.draft.date ? [{ label: "適用開始日", before: change?.effectiveFrom ?? "未設定", after: session.draft.date || "未入力" }] : []),
          ...(amountRaw(change?.amount ?? currentItem.effectiveAmount ?? currentItem.amount, currentItem) !== session.draft.amountRaw
            ? [{ label: "金額", before: formatCurrency(change?.amount ?? currentItem.effectiveAmount ?? currentItem.amount, currency), after: session.draft.amountRaw || "未入力" }] : []),
        ]
      : mode === "initial" && amountRaw(currentItem.amount, currentItem) !== session.draft.amountRaw
        ? [{ label: "初期金額", before: formatCurrency(currentItem.amount, currency), after: session.draft.amountRaw || "未入力" }]
        : [];
  const next = nextChange(currentItem, today);
  const currentAmount = currentItem.effectiveAmount ?? currentItem.amount;
  const title = mode === "history" ? `${currentItem.name}の変更履歴`
    : mode === "schedule" ? `${currentItem.name}の金額変更`
      : mode === "initial" ? `${currentItem.name}の初期金額を訂正`
        : mode === "change" ? `${currentItem.name}の履歴を訂正`
          : mode === "delete" ? `${currentItem.name}の履歴を削除` : undefined;

  const body = mode === "detail" ? <div className="grid gap-5 text-sm">
    <dl className="grid gap-3 rounded-xl border border-line p-4">
      <div><dt className="text-ink-3">現在の金額</dt><dd className="font-data text-lg">{formatCurrency(currentAmount, currency)}</dd></div>
      <div><dt className="text-ink-3">次の金額変更</dt><dd>{next ? `${formatDateWithYear(next.effectiveFrom)}から ${formatCurrency(next.amount, currency)}` : "予定なし"}</dd></div>
      <div><dt className="text-ink-3">周期</dt><dd>{formatScheduleLabel(currentItem)}</dd></div>
      <div><dt className="text-ink-3">口座</dt><dd>{currentItem.type === "transfer" ? `${currentItem.account?.name ?? "未設定"} → ${currentItem.transferToAccount?.name ?? "未設定"}` : currentItem.account?.name ?? "未設定"}</dd></div>
      <div><dt className="text-ink-3">期間</dt><dd>{currentItem.startDate ?? "制限なし"} 〜 {currentItem.endDate ?? "制限なし"}</dd></div>
      <div><dt className="text-ink-3">状態</dt><dd>{currentItem.enabled ? "有効" : "無効"}</dd></div>
    </dl>
    <div className="grid gap-2 sm:grid-cols-2">
      <Button variant="secondary" onClick={() => openMode("basic")}>基本情報を編集</Button>
      {!isOneTimeSchedule(currentItem) && <Button variant="secondary" onClick={() => openMode("schedule")}>金額変更を予約</Button>}
      <Button variant="ghost" onClick={() => openMode("history")}>変更履歴</Button>
    </div>
  </div> : mode === "basic" ? <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <p className="text-sm text-ink-2">現在の金額: {formatCurrency(currentAmount, currency)}。金額の変更は別の操作です。</p>
    <FieldRows idPrefix="recurring-basic" form={session.draft.form} onChange={(form) => session.setDraft((draft) => ({ ...draft, form }))}
      accounts={accounts} today={today} errors={validation.visibleErrors} onTouched={validation.touch} />
    <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">変更を保存</button>
  </form> : mode === "history" ? <div className="grid gap-3" aria-label="金額と適用期間">
    <p className="text-sm text-ink-2">金額は営業日シフト前の発生日で判定します。</p>
    <div className="rounded-xl border border-line p-3">
      <div className="font-data">初期金額 {formatCurrency(currentItem.amount, currency)}</div>
      <div className="text-xs text-ink-3">{currentItem.startDate ?? "制限なし"}から</div>
      <Button variant="ghost" onClick={() => openMode("initial")}>初期金額を訂正</Button>
    </div>
    {[...(currentItem.amountChanges ?? [])].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).map((entry) => <div key={entry.id} className="rounded-xl border border-line p-3">
      <div className="font-data">{formatCurrency(entry.amount, currency)}・{entry.effectiveFrom}から</div>
      {currentItem.startDate && entry.effectiveFrom <= currentItem.startDate && <p className="text-xs text-critical">開始日以前の履歴です。訂正または削除してください。</p>}
      <div className="mt-2 flex gap-2"><Button variant="ghost" onClick={() => openMode("change", entry.id)}>{entry.effectiveFrom} の履歴を訂正</Button>
        <Button variant="ghost" onClick={() => openMode("delete", entry.id)}>{entry.effectiveFrom} の履歴を削除</Button></div>
    </div>)}
    {!isOneTimeSchedule(currentItem) && <Button variant="secondary" onClick={() => openMode("schedule")}>金額変更を予約</Button>}
    <Button variant="ghost" onClick={() => openMode("detail")}>詳細に戻る</Button>
  </div> : mode === "delete" ? <div className="grid gap-3 text-sm">
    <p>{change?.effectiveFrom}からの {change ? formatCurrency(change.amount, currency) : "履歴"} を削除します。</p>
    <p>{historyImpact}</p>
  </div> : mode === "schedule" || mode === "initial" || mode === "change" ? <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    {mode !== "initial" && <FormField label="適用開始日" htmlFor="recurring-editor-effective-date" required error={validation.visibleErrors.date}>
      <Input id="recurring-editor-effective-date" type="date" min={currentItem.startDate ? addCalendarDays(currentItem.startDate, 1) : undefined}
        value={session.draft.date} onBlur={() => validation.touch("date")} onChange={(event) => session.setDraft((draft) => ({ ...draft, date: event.target.value }))} />
    </FormField>}
    <FormField label={mode === "initial" ? "初期金額（訂正）" : "金額"} htmlFor="recurring-editor-amount" required error={validation.visibleErrors.amount}>
      <MoneyInput id="recurring-editor-amount" currencyCode={currency} value={readMoneyDraft(session.draft.amountRaw, currency).minorUnits}
        draftValue={session.draft.amountRaw} draftKey={`${currentItem.id}:${mode}:${changeId ?? ""}`}
        onDraftChange={(nextDraft) => session.setDraft((draft) => ({ ...draft, amountRaw: nextDraft.raw }))} onChange={() => {}} onBlur={() => validation.touch("amount")} />
    </FormField>
    <p className="text-sm text-ink-2">{mode === "schedule" ? "指定日からの未確定予定額を変更します。" : historyImpact}</p>
    <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">{mode === "schedule" ? "金額変更を保存" : "訂正を保存"}</button>
  </form> : null;
  const shellMode = mode === "detail" || mode === "history" ? "detail" : mode === "schedule" ? (session.draft.date > today ? "schedule" : "record") : mode === "basic" ? "edit" : "correct";
  return <>
    <EditPanelLayout open={Boolean(selection)} onRequestClose={requestClose} originRef={originRef} fallbackFocusRef={fallbackFocusRef}
      editor={{ subjectType: "予定収支", subjectName: currentItem.name || "予定収支", title, mode: shellMode,
        status: session.status, changes, impact: mode === "detail" || mode === "history" ? undefined : mode === "initial" || mode === "change" || mode === "delete" ? historyImpact : impact,
        error: session.error, saveLabel: mode === "schedule" && session.draft.date <= today ? "金額変更を記録" : mode === "delete" ? "削除を確認" : undefined,
        onSave: save, onRetryRefresh: retryRefresh, children: body }}>
      <div ref={fallbackFocusRef as React.RefObject<HTMLDivElement>} tabIndex={-1}>{children}</div>
    </EditPanelLayout>
    <ConfirmDialog open={deleteConfirm} onOpenChange={setDeleteConfirm} title="金額履歴を削除しますか？"
      description={`${change?.effectiveFrom ?? "対象日"}からの金額を削除します。未確定予測が変わる可能性があります。`}
      onConfirm={confirmDelete} />
  </>;
}
