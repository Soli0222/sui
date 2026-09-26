import { INT4_MAX, SUPPORTED_CURRENCY_CODES, addCalendarDays, type Subscription, type SupportedCurrencyCode } from "@sui/shared";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ScheduleField } from "../ScheduleField";
import { Button } from "../ui/button";
import { ConditionalField } from "../ui/conditional-field";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { FormField } from "../ui/form-field";
import { Input } from "../ui/input";
import { MoneyInput, readMoneyDraft } from "../ui/money-input";
import { EditModal, EditModalLayout, type EditChange } from "../editing/edit-surface";
import { Select } from "../ui/select";
import { useEditSession } from "../../hooks/use-edit-session";
import { useFieldValidation } from "../../hooks/use-field-validation";
import { apiFetch } from "../../lib/api";
import { formatCurrency } from "../../lib/format";
import { getTodayDate } from "../../lib/utils";
import { getSubscriptionPricePeriods, formatPeriod, formatSubscriptionSchedule, makeEmptyForm, parseOptionalDate, parseOptionalText, isPeriodValid, isValidExchangeRate, subscriptionBasicPayload, subscriptionInitialCorrectionPayload, subscriptionBasicChanges, subscriptionDraft, sessionStartDateFieldId, subscriptionFormErrors, type SubscriptionForm, type SubscriptionMode, type SubscriptionSelection, type SubscriptionDraft } from "./subscription-form";

export function SubscriptionEditorLayout({ children, selection, paymentSources, onClose, onSaved }: {
  children: ReactNode; selection: SubscriptionSelection | null; paymentSources: string[];
  onClose: () => void; onSaved: () => Promise<Subscription[]>;
}) {
  const placeholder = { id: "", ...makeEmptyForm(getTodayDate()), amountChanges: [] } as unknown as Subscription;
  const [savedItem, setSavedItem] = useState<Subscription>(selection?.subscription ?? placeholder);
  const [targetKey, setTargetKey] = useState(selection?.key ?? 0);
  const [localMode, setLocalMode] = useState<SubscriptionMode>(selection?.mode ?? "detail");
  const [changeId, setChangeId] = useState<string | undefined>(selection?.changeId);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const originRef = useRef<HTMLElement | null>(null);
  const fallbackFocusRef = useRef<HTMLDivElement>(null);
  if (selection && selection.key !== targetKey) {
    setTargetKey(selection.key);
    setSavedItem(selection.subscription);
    setLocalMode(selection.mode);
    setChangeId(selection.changeId);
  }
  const item = selection?.key === targetKey ? savedItem : selection?.subscription ?? placeholder;
  const mode = selection?.key === targetKey ? localMode : selection?.mode ?? "detail";
  const selectedChangeId = selection?.key === targetKey ? changeId : selection?.changeId;
  const change = item.amountChanges?.find((entry) => entry.id === selectedChangeId);
  const firstChangeDate = item.amountChanges?.reduce<string | null>((earliest, entry) =>
    earliest === null || entry.effectiveFrom < earliest ? entry.effectiveFrom : earliest, null) ?? null;
  const validate = (draft: SubscriptionDraft) => {
    const errors: Record<string, string> = {};
    if (mode === "basic") {
      Object.assign(errors, subscriptionFormErrors(draft.form, firstChangeDate));
    } else if (mode === "schedule" || mode === "change" || mode === "initial") {
      if (mode !== "initial" && (!draft.date || draft.date <= item.startDate)) errors.date = `適用開始日は契約開始日（${item.startDate}）より後にしてください。`;
      const parsed = readMoneyDraft(draft.amountRaw, item.currencyCode);
      if (parsed.kind !== "valid" || parsed.minorUnits === null || parsed.minorUnits <= 0 || parsed.minorUnits > INT4_MAX) errors.amount = "0より大きい金額を入力してください。";
    }
    return errors;
  };
  const session = useEditSession<SubscriptionDraft>({ identity: `subscription:${selection?.key ?? 0}:${item.id}:${mode}:${selectedChangeId ?? ""}`,
    initial: subscriptionDraft(item, mode, change), validate,
    fieldIds: { name: "subscription-editor-name", exchangeRateToJpy: "subscription-editor-rate",
      startDate: sessionStartDateFieldId(item), endDate: "subscription-end", paymentSource: "subscription-editor-payment",
      interval: "subscription-schedule-interval",
      dayOfMonth: "subscription-schedule-day", dayOfWeek: "subscription-schedule-day",
      date: "subscription-editor-date", amount: "subscription-editor-amount" } });
  const validation = useFieldValidation(session.draft, validate);
  useEffect(() => { if (selection) originRef.current = selection.origin; }, [selection]);
  const openMode = (nextMode: SubscriptionMode, nextChangeId?: string) => session.requestTransition(() => {
    validation.reset(); setLocalMode(nextMode); setChangeId(nextChangeId); setDeleteConfirm(false);
  });
  const requestClose = () => session.requestClose(onClose);
  const reload = async () => {
    const items = await onSaved();
    const latest = items.find((entry) => entry.id === item.id);
    if (!latest) throw new Error("保存後のサブスクを取得できませんでした。");
    setSavedItem(latest);
    return subscriptionDraft(latest, mode, latest.amountChanges?.find((entry) => entry.id === selectedChangeId));
  };
  const save = async () => {
    if (mode === "delete") { setDeleteConfirm(true); return; }
    validation.showAll();
    const succeeded = await session.save(async (draft) => {
      if (mode === "basic" || mode === "initial") {
        const amount = readMoneyDraft(draft.amountRaw, item.currencyCode).minorUnits;
        await apiFetch(`/api/subscriptions/${item.id}`, { method: "PUT",
          body: JSON.stringify(mode === "basic" ? subscriptionBasicPayload(item, draft.form)
            : subscriptionInitialCorrectionPayload(item, amount!)) });
      } else if (mode === "schedule" || mode === "change") {
        await apiFetch(`/api/subscriptions/${item.id}/amount-changes${mode === "change" ? `/${selectedChangeId}` : ""}`, {
          method: mode === "change" ? "PUT" : "POST",
          body: JSON.stringify({ effectiveFrom: draft.date, amount: readMoneyDraft(draft.amountRaw, item.currencyCode).minorUnits }),
        });
      }
    }, reload);
    if (succeeded) { validation.reset(); setLocalMode("detail"); }
  };
  const confirmDelete = async () => {
    setDeleteConfirm(false);
    const succeeded = await session.save(async () => {
      await apiFetch(`/api/subscriptions/${item.id}/amount-changes/${selectedChangeId}`, { method: "DELETE" });
    }, reload);
    if (succeeded) setLocalMode("detail");
  };
  const retryRefresh = async () => {
    if (await session.retryRefresh()) setLocalMode("detail");
  };
  const currentAmount = item.effectiveAmount ?? item.amount;
  const currentPeriod = getSubscriptionPricePeriods([item], true);
  const impact = "サブスク台帳と集計に反映。口座残高・残高予測には直接反映しません。";
  const changes: EditChange[] = mode === "basic" ? subscriptionBasicChanges(item, session.draft.form)
    : mode === "schedule" || mode === "change" || mode === "initial" ? [
    ...(mode !== "initial" ? [{ label: "適用開始日", before: change?.effectiveFrom ?? "未設定", after: session.draft.date || "未入力" }] : []),
    { label: "金額", before: formatCurrency(mode === "initial" ? item.amount : change?.amount ?? currentAmount, item.currencyCode),
      after: session.draft.amountRaw || "未入力" },
  ] : [];
  const body = mode === "detail" ? <div className="grid gap-5 text-sm">
    <dl className="grid gap-3 rounded-xl border border-line p-4">
      <div><dt className="text-ink-3">周期</dt><dd>{formatSubscriptionSchedule(item)}</dd></div>
      <div><dt className="text-ink-3">支払い元</dt><dd>{item.paymentSource ?? "未設定"}</dd></div>
      <div><dt className="text-ink-3">期間</dt><dd>{formatPeriod(item.startDate, item.endDate)}</dd></div>
    </dl>
    <Button variant="secondary" onClick={() => openMode("basic")}>基本情報を編集</Button>
    <section className="grid gap-3" aria-label="金額と適用期間">
      <h3 className="font-semibold">金額と適用期間</h3>
      <p className="text-xs text-ink-2">金額は各課金発生日に適用します。</p>
      <Button variant="secondary" onClick={() => openMode("schedule")}>期間を追加</Button>
      {currentPeriod.map((period) => {
        const label = period.change ? `${period.change.effectiveFrom}からの期間` : "初期金額";
        const today = getTodayDate();
        const state = period.endDate && period.endDate < today ? "過去" : period.startDate > today ? "将来" : "適用中";
        const invalid = period.change && period.change.effectiveFrom <= item.startDate || period.endDate && period.endDate < period.startDate;
        return <div key={period.key} className="rounded-xl border border-line p-3">
          <div className="font-data">{label} {formatCurrency(period.amount, item.currencyCode)}</div>
          <div className="text-xs text-ink-3">{formatPeriod(period.startDate, period.endDate)}・{state}</div>
          {invalid && <p className="text-xs text-critical">適用期間が不正です。訂正または削除してください。</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="ghost" aria-label={`${label}を訂正`} onClick={() => openMode(period.change ? "change" : "initial", period.change?.id)}>訂正</Button>
            {period.change && <Button variant="ghost" aria-label={`${label}を削除`} onClick={() => openMode("delete", period.change!.id)}>削除</Button>}
          </div>
        </div>;
      })}
    </section>
  </div> : mode === "basic" ? <><p className="mb-3 text-sm text-ink-2">現在の金額: {formatCurrency(currentAmount, item.currencyCode)}。金額の変更は別の操作です。</p>
    <SubscriptionEditModal embedded form={session.draft.form} paymentSources={paymentSources} canSave onCancel={requestClose}
      onSave={() => void save()} onChange={(form) => session.setDraft((draft) => ({ ...draft, form }))} showAmount={false}
      startDateError={validation.visibleErrors.startDate} errors={validation.visibleErrors} openedToday={selection?.openedToday} /></> : mode === "delete" ? <p className="text-sm">{change?.effectiveFrom}からの金額期間を削除します。過去の台帳集計も変わる可能性があります。</p>
    : <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      {mode !== "initial" ? <FormField label="適用開始日" htmlFor="subscription-editor-date" required error={validation.visibleErrors.date}>
        <Input id="subscription-editor-date" type="date" min={addCalendarDays(item.startDate, 1)} value={session.draft.date}
          onBlur={() => validation.touch("date")} onChange={(event) => session.setDraft((draft) => ({ ...draft, date: event.target.value }))} /></FormField> : null}
      <FormField label={mode === "initial" ? `初期金額（訂正） (${item.currencyCode})` : `金額 (${item.currencyCode})`}
        htmlFor="subscription-editor-amount" required error={validation.visibleErrors.amount}>
        <MoneyInput id="subscription-editor-amount" currencyCode={item.currencyCode}
          value={readMoneyDraft(session.draft.amountRaw, item.currencyCode).minorUnits} draftValue={session.draft.amountRaw}
          draftKey={`${item.id}:${mode}:${selectedChangeId ?? ""}`} onChange={() => {}}
          onDraftChange={(draft) => session.setDraft((current) => ({ ...current, amountRaw: draft.raw }))}
          onBlur={() => validation.touch("amount")} />
      </FormField><p className="text-xs text-ink-2">{mode === "initial" || mode === "change" ? "訂正は過去の台帳集計を変える可能性があります。" : "適用後の月別・年間集計が変わります。"}</p>
      <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">変更を保存</button>
    </form>;
  const shellMode = mode === "detail" ? "detail" : mode === "schedule" ? (session.draft.date > getTodayDate() ? "schedule" : "record") : mode === "basic" ? "edit" : "correct";
  return <><EditModalLayout open={Boolean(selection)} onRequestClose={requestClose} originRef={originRef} fallbackFocusRef={fallbackFocusRef}
    editor={{ subjectType: "サブスク", subjectName: item.name || "サブスク", mode: shellMode,
      status: session.status, changes,
      impact: mode === "detail" ? undefined : impact,
      error: session.error, saveLabel: mode === "schedule" && session.draft.date <= getTodayDate() ? "金額変更を記録" : mode === "delete" ? "削除を確認" : undefined,
      onSave: save, onRetryRefresh: retryRefresh, children: mode === "detail" ? body : <div className="grid gap-4"><Button variant="ghost" onClick={() => openMode("detail")}>編集メニューに戻る</Button>{body}</div> }}>
    <div ref={fallbackFocusRef} tabIndex={-1}>{children}</div>
  </EditModalLayout><ConfirmDialog open={deleteConfirm} onOpenChange={setDeleteConfirm} title="価格履歴を削除しますか？"
    description={change ? `${change.effectiveFrom} からの価格を削除します。過去の台帳集計も変わる可能性があります。` : undefined}
    onConfirm={confirmDelete} /></>;
}

export function SubscriptionCreateModal({ openedToday, paymentSources, onClose, onSaved }: {
  openedToday: string; paymentSources: string[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const initialForm = makeEmptyForm(openedToday);
  const validate = (draft: { form: SubscriptionForm; amountRaw: string }) => {
    const errors = subscriptionFormErrors(draft.form);
    const parsed = readMoneyDraft(draft.amountRaw, draft.form.currencyCode);
    if (parsed.kind !== "valid" || parsed.minorUnits === null || parsed.minorUnits <= 0 || parsed.minorUnits > INT4_MAX)
      errors.amount = "0より大きい金額を入力してください。";
    return errors;
  };
  const session = useEditSession({ identity: `subscription:create:${openedToday}`, initial: { form: initialForm, amountRaw: "" },
    validate, fieldIds: { name: "subscription-editor-name", amount: "subscription-editor-create-amount",
      exchangeRateToJpy: "subscription-editor-rate", startDate: sessionStartDateFieldId(initialForm), endDate: "subscription-end",
      interval: "subscription-schedule-interval",
      paymentSource: "subscription-editor-payment", dayOfMonth: "subscription-schedule-day", dayOfWeek: "subscription-schedule-day" } });
  const validation = useFieldValidation(session.draft, validate);
  const save = async () => {
    validation.showAll();
    const succeeded = await session.save(async (draft) => {
      const amount = readMoneyDraft(draft.amountRaw, draft.form.currencyCode).minorUnits!;
      await apiFetch("/api/subscriptions", { method: "POST", body: JSON.stringify({ ...draft.form, amount }) });
    }, async () => { await onSaved(); return session.draft; });
    if (succeeded) onClose();
  };
  const impact = "サブスク台帳と集計に反映。口座残高・残高予測には直接反映しません。";
  const requestClose = () => session.requestClose(onClose);
  return <EditModal open onRequestClose={() => session.requestClose(onClose)} subjectType="サブスク" subjectName="サブスク"
    mode="create" status={session.status} impact={impact} error={session.error} onSave={save}
    onRetryRefresh={() => { void session.retryRefresh().then((ok) => { if (ok) onClose(); }); }}>
    <SubscriptionEditModal embedded form={session.draft.form} paymentSources={paymentSources} canSave onCancel={requestClose}
      onSave={() => void save()} onChange={(form) => session.setDraft((draft) => ({ ...draft, form }))}
      showAmount amountRaw={session.draft.amountRaw} onAmountRawChange={(amountRaw) => session.setDraft((draft) => ({ ...draft, amountRaw }))}
      openedToday={openedToday} errors={validation.visibleErrors} startDateError={validation.visibleErrors.startDate} />
  </EditModal>;
}


function SubscriptionEditModal({
  form,
  paymentSources,
  onChange,
  canSave,
  onCancel,
  onSave,
  actionLabel = "保存",
  showAmount = true,
  startDateError = null,
  embedded = false,
  amountRaw,
  onAmountRawChange,
  openedToday,
  errors,
}: {
  form: SubscriptionForm;
  paymentSources: string[];
  onChange: (next: SubscriptionForm) => void;
  canSave: boolean;
  onCancel: () => void;
  onSave: () => void;
  actionLabel?: string;
  showAmount?: boolean;
  startDateError?: string | null;
  embedded?: boolean;
  amountRaw?: string;
  onAmountRawChange?: (raw: string) => void;
  openedToday?: string;
  errors?: Record<string, string>;
}) {
  const nameId = useId();
  const amountId = useId();
  const currencyId = useId();
  const rateId = useId();
  const sourceId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus({ preventScroll: true });
  }, []);

  const setCurrencyCode = (currencyCode: SupportedCurrencyCode) => {
    onChange({
      ...form,
      currencyCode,
      exchangeRateToJpy: currencyCode === "JPY" ? 1 : form.exchangeRateToJpy,
    });
  };

  const missing: string[] = [];
  if (form.name.trim().length === 0) missing.push("サービス名");
  if (form.amount <= 0) missing.push("金額");
  if (!isValidExchangeRate(form)) missing.push("JPY換算レート");
  if (form.interval !== 12 && form.startDate === "") missing.push("課金開始日");
  if (form.recurrence === "monthly" && (form.dayOfMonth === null || form.dayOfMonth < 1 || form.dayOfMonth > 31)) missing.push("課金日");
  if (form.recurrence === "weekly" && (form.dayOfWeek === null || form.dayOfWeek < 0 || form.dayOfWeek > 6)) missing.push("曜日");
  if (!isPeriodValid(form.startDate, form.endDate)) missing.push("期間");

  return (
    <form
      className="mt-6 grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) {
          onSave();
        }
      }}
    >
      <FormField label="サービス名" htmlFor={embedded ? "subscription-editor-name" : nameId} required error={errors?.name}>
        <Input id={embedded ? "subscription-editor-name" : nameId} ref={firstFieldRef} maxLength={100} value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} />
      </FormField>

      <FormField label="通貨" htmlFor={embedded ? "subscription-editor-currency" : currencyId} error={errors?.currencyCode}>
        <Select id={embedded ? "subscription-editor-currency" : currencyId} value={form.currencyCode} onChange={(event) => setCurrencyCode(event.target.value as SupportedCurrencyCode)}>
          {SUPPORTED_CURRENCY_CODES.map((currencyCode) => (
            <option key={currencyCode} value={currencyCode}>
              {currencyCode}
            </option>
          ))}
        </Select>
      </FormField>

      <ConditionalField show={form.currencyCode !== "JPY"}>
        <FormField label="JPY換算レート" htmlFor={embedded ? "subscription-editor-rate" : rateId} error={errors?.exchangeRateToJpy}>
          <Input
            id={embedded ? "subscription-editor-rate" : rateId}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.0001"
            value={form.exchangeRateToJpy}
            onChange={(event) => onChange({ ...form, exchangeRateToJpy: Number(event.target.value) })}
          />
        </FormField>
      </ConditionalField>

      {showAmount ? <FormField label={`金額 (${form.currencyCode})`} htmlFor={embedded ? "subscription-editor-create-amount" : amountId} required error={errors?.amount}>
        <MoneyInput id={embedded ? "subscription-editor-create-amount" : amountId} currencyCode={form.currencyCode} value={form.amount}
          draftValue={amountRaw} draftKey={embedded ? `subscription-create:${form.currencyCode}` : undefined}
          onDraftChange={onAmountRawChange ? (draft) => onAmountRawChange(draft.raw) : undefined}
          onChange={onAmountRawChange ? () => {} : (value) => onChange({ ...form, amount: value })} />
      </FormField> : null}

      <ScheduleField
        id="subscription-schedule"
        today={openedToday}
        value={form}
        onChange={(next) =>
          onChange({
            ...form,
            ...next,
            startDate: next.startDate ?? form.startDate,
            endDate: next.endDate ?? form.endDate,
          })
        }
      />
      {startDateError ? <p role="alert" className="text-xs text-critical">{startDateError}</p> : null}
      {errors?.interval || errors?.dayOfMonth || errors?.dayOfWeek ? <p role="alert" className="text-xs text-critical">{errors.interval ?? errors.dayOfMonth ?? errors.dayOfWeek}</p> : null}

      {form.interval !== 12 ? (
        <FormField label="課金開始日" htmlFor="subscription-start" required error={errors?.startDate}>
          <Input
            id="subscription-start"
            type="date"
            value={form.startDate}
            onChange={(event) => {
              const startDate = event.target.value;
              let next: SubscriptionForm = { ...form, startDate };
              if (next.recurrence === "monthly" && next.interval === 12 && startDate) {
                next = { ...next, dayOfMonth: Number(startDate.slice(8, 10)) };
              }
              onChange(next);
            }}
          />
        </FormField>
      ) : null}

      <FormField
        label="終了日"
        htmlFor="subscription-end"
        help="空欄で無期限になります。"
        error={errors?.endDate ?? (!isPeriodValid(form.startDate, form.endDate) ? "開始日は終了日以前にしてください。" : null)}
      >
        <Input
          id="subscription-end"
          type="date"
          value={form.endDate ?? ""}
          onChange={(event) => onChange({ ...form, endDate: parseOptionalDate(event.target.value) })}
        />
      </FormField>

      <FormField label="支払い元" htmlFor={embedded ? "subscription-editor-payment" : sourceId} error={errors?.paymentSource}>
        <Input
          id={embedded ? "subscription-editor-payment" : sourceId}
          list="subscription-payment-sources"
          placeholder={paymentSources.length === 0 ? "任意入力" : "カード名・口座名から選択または入力"}
          maxLength={100}
          value={form.paymentSource ?? ""}
          onChange={(event) => onChange({ ...form, paymentSource: parseOptionalText(event.target.value) })}
        />
      </FormField>

      {embedded ? <button type="submit" tabIndex={-1} aria-hidden="true" className="sr-only">変更を保存</button> : <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="text-xs text-ink-3">{!canSave && missing.length > 0 ? `必須: ${missing.join("、")}` : ""}</div>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onCancel}>
            キャンセル
          </Button>
          <Button type="submit" disabled={!canSave}>
            {actionLabel}
          </Button>
        </div>
      </div>}
    </form>
  );
}
