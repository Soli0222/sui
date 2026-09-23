import type {
  Account,
  CreateSubscriptionPayload,
  CreditCard,
  Recurrence,
  Subscription,
  SupportedCurrencyCode,
  SubscriptionAmountChange,
} from "@sui/shared";
import { addCalendarDays, convertMinorUnitToJpy, formatSchedule, resolveDatedAmount, SUPPORTED_CURRENCY_CODES, INT4_MAX } from "@sui/shared";
import { useEffect, useId, useRef, useState, startTransition, type ReactNode } from "react";
import { ScheduleField } from "../components/ScheduleField";
import { ArchivedSection } from "../components/ArchivedSection";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConditionalField } from "../components/ui/conditional-field";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { MoneyInput, readMoneyDraft } from "../components/ui/money-input";
import { EditModal, EditModalLayout, type EditChange } from "../components/editing/edit-surface";
import { useEditingNavigation } from "../components/editing/editing-navigation";
import { useEditSession } from "../hooks/use-edit-session";
import { useFieldValidation } from "../hooks/use-field-validation";
import { ResponsiveTable, type ResponsiveTableColumn } from "../components/ui/responsive-table";
import { Select } from "../components/ui/select";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { getOccurrenceDatesInMonth } from "../lib/dates";
import { formatCurrency, formatCurrencyInputValue, formatDateWithYear } from "../lib/format";
import { getCurrentYearMonth, getTodayDate } from "../lib/utils";
import { Pencil, Trash2 } from "lucide-react";

export type SubscriptionForm = CreateSubscriptionPayload & {
  currencyCode: SupportedCurrencyCode;
  exchangeRateToJpy: number;
  recurrence: Recurrence;
  interval: number;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
};

export function subscriptionBasicPayload(saved: Subscription, draft: SubscriptionForm): CreateSubscriptionPayload {
  return { name: draft.name, amount: saved.amount, currencyCode: draft.currencyCode,
    exchangeRateToJpy: draft.exchangeRateToJpy, recurrence: draft.recurrence, interval: draft.interval,
    startDate: draft.startDate, dayOfMonth: draft.dayOfMonth, dayOfWeek: draft.dayOfWeek,
    endDate: draft.endDate, paymentSource: draft.paymentSource };
}

export function subscriptionInitialCorrectionPayload(saved: Subscription, amount: number): CreateSubscriptionPayload {
  return { name: saved.name, amount, currencyCode: saved.currencyCode, exchangeRateToJpy: saved.exchangeRateToJpy,
    recurrence: saved.recurrence, interval: saved.interval, startDate: saved.startDate,
    dayOfMonth: saved.dayOfMonth, dayOfWeek: saved.dayOfWeek, endDate: saved.endDate,
    paymentSource: saved.paymentSource };
}

function makeEmptyForm(openedToday: string): SubscriptionForm { return {
  name: "",
  amount: 0,
  currencyCode: "JPY",
  exchangeRateToJpy: 1,
  recurrence: "monthly",
  interval: 1,
  startDate: openedToday,
  dayOfMonth: Number(openedToday.slice(8, 10)),
  dayOfWeek: null,
  endDate: null,
  paymentSource: null,
}; }

function parseOptionalDate(value: string) {
  return value === "" ? null : value;
}

function parseOptionalText(value: string) {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isPeriodValid(startDate: string, endDate: string | null | undefined) {
  return !endDate || startDate <= endDate;
}

function isValidExchangeRate(form: SubscriptionForm) {
  return form.currencyCode === "JPY" || form.exchangeRateToJpy > 0;
}

function formatSubscriptionSchedule(subscription: Subscription) {
  return formatSchedule({
    recurrence: subscription.recurrence,
    interval: subscription.interval,
    dayOfMonth: subscription.dayOfMonth,
    dayOfWeek: subscription.dayOfWeek,
    startDate: subscription.startDate,
    endDate: subscription.endDate,
  });
}

function formatPeriod(startDate: string, endDate: string | null) {
  return `${startDate} 〜 ${endDate ?? "無期限"}`;
}

export interface SubscriptionPricePeriod {
  subscription: Subscription;
  amount: number;
  startDate: string;
  endDate: string | null;
  change: SubscriptionAmountChange | null;
  key: string;
}

/** Derive inclusive price periods clipped to the subscription contract. */
export function getSubscriptionPricePeriods(subscriptions: Subscription[]): SubscriptionPricePeriod[] {
  return subscriptions.flatMap((subscription) => {
    const changes = [...(subscription.amountChanges ?? [])].sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom));
    const prices = [{ amount: subscription.amount, effectiveFrom: subscription.startDate, change: null as SubscriptionAmountChange | null, key: "initial" },
      ...changes.map((change) => ({ amount: change.amount, effectiveFrom: change.effectiveFrom, change, key: change.id }))];

    return prices.flatMap((price, index) => {
      const startDate = price.effectiveFrom < subscription.startDate ? subscription.startDate : price.effectiveFrom;
      const nextDate = prices[index + 1]?.effectiveFrom;
      const priceEnd = nextDate ? addCalendarDays(nextDate, -1) : null;
      const endDate = subscription.endDate && priceEnd
        ? (subscription.endDate < priceEnd ? subscription.endDate : priceEnd)
        : subscription.endDate ?? priceEnd;
      return endDate && endDate < startDate ? [] : [{ subscription, amount: price.amount, startDate, endDate, change: price.change, key: price.key }];
    });
  });
}

export function getVisibleSubscriptionPricePeriods(subscription: Subscription, referenceDate: string): SubscriptionPricePeriod[] {
  return getSubscriptionPricePeriods([subscription]).filter((period) => period.endDate === null || period.endDate >= referenceDate);
}

function SubscriptionAmountList({ subscription, referenceDate }: { subscription: Subscription; referenceDate: string }) {
  const periods = getVisibleSubscriptionPricePeriods(subscription, referenceDate);
  if (periods.length === 0) {
    return <span className="text-ink-3">適用中の金額なし</span>;
  }

  return (
    <div className="grid gap-1">
      {periods.map((period) => (
        <div key={period.key}>
          <span className="font-data">{formatCurrency(period.amount, subscription.currencyCode)}</span>{" "}
          <span className="text-xs text-ink-3">{formatPeriod(period.startDate, period.endDate)}</span>
        </div>
      ))}
    </div>
  );
}

function getYearMonthTotal(yearMonth: string) {
  return Number(yearMonth.slice(0, 4)) * 12 + Number(yearMonth.slice(5, 7)) - 1;
}

export interface SubscriptionOccurrence {
  subscription: Subscription;
  date: string;
  amount: number;
}

export function getMonthlySummary(subscriptions: Subscription[], yearMonth: string) {
  const items: SubscriptionOccurrence[] = [];

  for (const subscription of subscriptions) {
    for (const date of getOccurrenceDatesInMonth(subscription, yearMonth, true)) {
      items.push({ subscription, date, amount: resolveDatedAmount(subscription.amount, subscription.amountChanges ?? [], date) });
    }
  }

  items.sort(
    (left, right) => left.date.localeCompare(right.date) || left.subscription.name.localeCompare(right.subscription.name, "ja-JP"),
  );

  return {
    items,
    total: items.reduce(
      (sum, item) =>
        sum +
        convertMinorUnitToJpy(
          item.amount,
          item.subscription.currencyCode,
          item.subscription.exchangeRateToJpy,
        ),
      0,
    ),
  };
}

export function getAnnualTotal(subscriptions: Subscription[], year: number) {
  let total = 0;

  for (let month = 1; month <= 12; month += 1) {
    total += getMonthlySummary(subscriptions, `${year}-${String(month).padStart(2, "0")}`).total;
  }

  return total;
}

function addMonths(yearMonth: string, offset: number) {
  const total = getYearMonthTotal(yearMonth) + offset;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function formatYearMonth(yearMonth: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
  }).format(new Date(`${yearMonth}-01T00:00:00+09:00`));
}

export function isEndedSubscription(subscription: Subscription, referenceDate: string): boolean {
  return subscription.endDate !== null && subscription.endDate < referenceDate;
}

export function partitionSubscriptions(
  subscriptions: Subscription[],
  referenceDate: string,
): { active: Subscription[]; archived: Subscription[] } {
  const active: Subscription[] = [];
  const archived: Subscription[] = [];

  for (const subscription of subscriptions) {
    if (isEndedSubscription(subscription, referenceDate)) {
      archived.push(subscription);
    } else {
      active.push(subscription);
    }
  }

  return { active, archived };
}

function getPaymentSourceOptions(accounts: Account[], cards: CreditCard[]) {
  return Array.from(
    new Set([...cards.map((card) => card.name), ...accounts.map((account) => account.name)].filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right, "ja-JP"));
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

type SubscriptionMode = "detail" | "basic" | "history" | "schedule" | "initial" | "change" | "delete";
type SubscriptionSelection = { subscription: Subscription; mode: SubscriptionMode; key: number; origin: HTMLElement; openedToday: string; changeId?: string };
type SubscriptionDraft = { form: SubscriptionForm; date: string; amountRaw: string };

function formFromSubscription(item: Subscription): SubscriptionForm {
  return { name: item.name, amount: item.amount, currencyCode: item.currencyCode,
    exchangeRateToJpy: item.exchangeRateToJpy, recurrence: item.recurrence, interval: item.interval,
    startDate: item.startDate, dayOfMonth: item.dayOfMonth, dayOfWeek: item.dayOfWeek,
    endDate: item.endDate, paymentSource: item.paymentSource };
}

function subscriptionDraft(item: Subscription, mode: SubscriptionMode, change?: SubscriptionAmountChange) : SubscriptionDraft {
  const amount = mode === "initial" ? item.amount : change?.amount ?? item.effectiveAmount ?? item.amount;
  return { form: formFromSubscription(item), date: change?.effectiveFrom ?? "",
    amountRaw: formatCurrencyInputValue(amount, item.currencyCode) };
}

function sessionStartDateFieldId(form: Pick<SubscriptionForm, "recurrence" | "interval">) {
  return form.recurrence === "monthly" && form.interval === 12 ? "subscription-schedule-month" : "subscription-start";
}

function subscriptionFormErrors(form: SubscriptionForm, firstChangeDate: string | null = null) {
  const errors: Record<string, string> = {};
  if (!form.name.trim() || form.name.length > 100) errors.name = "サービス名を1〜100文字で入力してください。";
  if (!Number.isFinite(form.exchangeRateToJpy) || !isValidExchangeRate(form)) errors.exchangeRateToJpy = "JPY換算レートを入力してください。";
  if (!form.startDate) errors.startDate = "課金開始日を入力してください。";
  if (!isPeriodValid(form.startDate, form.endDate)) errors.endDate = "開始日は終了日以前にしてください。";
  if (firstChangeDate && form.startDate >= firstChangeDate) errors.startDate = `課金開始日は最初の価格変更日（${firstChangeDate}）より前にしてください。`;
  if (!Number.isInteger(form.interval) || form.interval < 1) errors.interval = "周期を確認してください。";
  if (form.recurrence === "monthly" && (form.dayOfMonth === null || form.dayOfMonth < 1 || form.dayOfMonth > 31)) errors.dayOfMonth = "課金日を確認してください。";
  if (form.recurrence === "weekly" && (form.dayOfWeek === null || form.dayOfWeek < 0 || form.dayOfWeek > 6)) errors.dayOfWeek = "曜日を確認してください。";
  if (form.paymentSource && form.paymentSource.length > 100) errors.paymentSource = "支払い元は100文字以内で入力してください。";
  return errors;
}

export function subscriptionBasicChanges(saved: Subscription, draft: SubscriptionForm): EditChange[] {
  const changes: EditChange[] = [];
  const add = (label: string, before: string | number | null | undefined, after: string | number | null | undefined) => {
    if (before !== after) changes.push({ label, before: before ?? "未設定", after: after ?? "未設定" });
  };
  add("サービス名", saved.name, draft.name);
  add("通貨", saved.currencyCode, draft.currencyCode);
  add("JPY換算レート", saved.exchangeRateToJpy, draft.exchangeRateToJpy);
  if (saved.recurrence !== draft.recurrence || saved.interval !== draft.interval ||
    saved.dayOfMonth !== draft.dayOfMonth || saved.dayOfWeek !== draft.dayOfWeek) {
    changes.push({ label: "周期・課金日", before: formatSubscriptionSchedule(saved), after: formatSchedule(draft) });
  }
  add("課金開始日", saved.startDate, draft.startDate);
  add("終了日", saved.endDate, draft.endDate);
  add("支払い元", saved.paymentSource, draft.paymentSource);
  return changes;
}

function SubscriptionEditorLayout({ children, selection, paymentSources, onClose, onSaved }: {
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
    if (succeeded) { validation.reset(); setLocalMode(mode === "change" || mode === "initial" ? "history" : "detail"); }
  };
  const confirmDelete = async () => {
    setDeleteConfirm(false);
    const succeeded = await session.save(async () => {
      await apiFetch(`/api/subscriptions/${item.id}/amount-changes/${selectedChangeId}`, { method: "DELETE" });
    }, reload);
    if (succeeded) setLocalMode("history");
  };
  const retryRefresh = async () => {
    if (await session.retryRefresh()) setLocalMode(mode === "delete" || mode === "change" || mode === "initial" ? "history" : "detail");
  };
  const currentAmount = item.effectiveAmount ?? item.amount;
  const currentPeriod = getSubscriptionPricePeriods([item]);
  const futureChange = [...(item.amountChanges ?? [])].filter((entry) => entry.effectiveFrom > getTodayDate())
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))[0];
  const impact = "サブスク台帳と集計に反映。口座残高・残高予測には直接反映しません。";
  const changes: EditChange[] = mode === "basic" ? subscriptionBasicChanges(item, session.draft.form)
    : mode === "schedule" || mode === "change" || mode === "initial" ? [
    ...(mode !== "initial" ? [{ label: "適用開始日", before: change?.effectiveFrom ?? "未設定", after: session.draft.date || "未入力" }] : []),
    { label: "金額", before: formatCurrency(mode === "initial" ? item.amount : change?.amount ?? currentAmount, item.currencyCode),
      after: session.draft.amountRaw || "未入力" },
  ] : [];
  const body = mode === "detail" ? <div className="grid gap-5 text-sm">
    <dl className="grid gap-3 rounded-xl border border-line p-4">
      <div><dt className="text-ink-3">現在の金額</dt><dd className="font-data text-lg">{formatCurrency(currentAmount, item.currencyCode)}</dd></div>
      <div><dt className="text-ink-3">次の金額変更</dt><dd>{futureChange ? `${futureChange.effectiveFrom}から ${formatCurrency(futureChange.amount, item.currencyCode)}` : "予定なし"}</dd></div>
      <div><dt className="text-ink-3">周期</dt><dd>{formatSubscriptionSchedule(item)}</dd></div>
      <div><dt className="text-ink-3">支払い元</dt><dd>{item.paymentSource ?? "未設定"}</dd></div>
      <div><dt className="text-ink-3">期間</dt><dd>{formatPeriod(item.startDate, item.endDate)}</dd></div>
    </dl>
    <div className="grid gap-2 sm:grid-cols-2"><Button variant="secondary" onClick={() => openMode("basic")}>基本情報を編集</Button>
      <Button variant="secondary" onClick={() => openMode("schedule")}>金額変更を予約</Button>
      <Button variant="ghost" onClick={() => openMode("history")}>価格履歴</Button></div>
  </div> : mode === "basic" ? <><p className="mb-3 text-sm text-ink-2">現在の金額: {formatCurrency(currentAmount, item.currencyCode)}。金額の変更は別の操作です。</p>
    <div className="mb-3 flex flex-wrap gap-2"><Button variant="ghost" onClick={() => openMode("schedule")}>金額変更を予約</Button>
      <Button variant="ghost" onClick={() => openMode("history")}>価格履歴</Button></div>
    <SubscriptionEditModal embedded form={session.draft.form} paymentSources={paymentSources} canSave onCancel={requestClose}
      onSave={() => void save()} onChange={(form) => session.setDraft((draft) => ({ ...draft, form }))} showAmount={false}
      startDateError={validation.visibleErrors.startDate} errors={validation.visibleErrors} openedToday={selection?.openedToday} /></> : mode === "history" ? <div className="grid gap-3" aria-label="金額と適用期間">
    <p className="text-sm text-ink-2">価格は適用開始日から有効です。</p>
    {currentPeriod.map((period) => <div key={period.key} className="rounded-xl border border-line p-3">
      <div className="font-data">{period.change ? "価格" : "初期金額"} {formatCurrency(period.amount, item.currencyCode)}</div>
      <div className="text-xs text-ink-3">{formatPeriod(period.startDate, period.endDate)}</div>
      {period.change && period.change.effectiveFrom <= item.startDate ? <p className="text-xs text-critical">契約開始日以前の履歴です。訂正または削除してください。</p> : null}
      <div className="mt-2 flex gap-2">{period.change ? <><Button variant="ghost" onClick={() => openMode("change", period.change!.id)}>{period.change.effectiveFrom} の履歴を訂正</Button>
        <Button variant="ghost" onClick={() => openMode("delete", period.change!.id)}>{period.change.effectiveFrom} の履歴を削除</Button></>
        : <Button variant="ghost" onClick={() => openMode("initial")}>初期金額を訂正</Button>}</div>
    </div>)}
    <Button variant="secondary" onClick={() => openMode("schedule")}>期間を追加</Button>
    <Button variant="ghost" onClick={() => openMode("detail")}>詳細に戻る</Button>
  </div> : mode === "delete" ? <p className="text-sm">{change?.effectiveFrom}からの価格履歴を削除します。過去の台帳集計も変わる可能性があります。</p>
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
  const shellMode = mode === "detail" || mode === "history" ? "detail" : mode === "schedule" ? (session.draft.date > getTodayDate() ? "schedule" : "record") : mode === "basic" ? "edit" : "correct";
  return <><EditModalLayout open={Boolean(selection)} onRequestClose={requestClose} originRef={originRef} fallbackFocusRef={fallbackFocusRef}
    editor={{ subjectType: "サブスク", subjectName: item.name || "サブスク", mode: shellMode,
      title: mode === "history" ? `${item.name}の価格履歴` : undefined, status: session.status, changes,
      impact: mode === "detail" || mode === "history" ? undefined : impact,
      error: session.error, saveLabel: mode === "schedule" && session.draft.date <= getTodayDate() ? "金額変更を記録" : mode === "delete" ? "削除を確認" : undefined,
      onSave: save, onRetryRefresh: retryRefresh, children: body }}>
    <div ref={fallbackFocusRef} tabIndex={-1}>{children}</div>
  </EditModalLayout><ConfirmDialog open={deleteConfirm} onOpenChange={setDeleteConfirm} title="価格履歴を削除しますか？"
    description={change ? `${change.effectiveFrom} からの価格を削除します。過去の台帳集計も変わる可能性があります。` : undefined}
    onConfirm={confirmDelete} /></>;
}

function SubscriptionCreateModal({ openedToday, paymentSources, onClose, onSaved }: {
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

export function SubscriptionsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [createOpen, setCreateOpen] = useState(false);
  const [createKey, setCreateKey] = useState(0);
  const [createToday, setCreateToday] = useState(getTodayDate());
  const [selection, setSelection] = useState<SubscriptionSelection | null>(null);
  const selectionKey = useRef(0);
  const [deletingSubscription, setDeletingSubscription] = useState<Subscription | null>(null);
  const { toast } = useToast();
  const navigation = useEditingNavigation();
  const today = getTodayDate();

  const { data, loading, error, setData } = useResource(
    () =>
      Promise.all([
        apiFetch<Subscription[]>("/api/subscriptions"),
        apiFetch<Account[]>("/api/accounts"),
        apiFetch<CreditCard[]>("/api/credit-cards"),
      ]).then(([subscriptions, accounts, cards]) => ({ subscriptions, accounts, cards })),
    [reloadKey],
  );

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));
  const subscriptions = data?.subscriptions ?? [];
  const { active: activeSubscriptions, archived: archivedSubscriptions } = partitionSubscriptions(
    subscriptions, today,
  );
  const paymentSources = getPaymentSourceOptions(data?.accounts ?? [], data?.cards ?? []);
  const monthlySummary = getMonthlySummary(subscriptions, yearMonth);
  const annualTotal = getAnnualTotal(subscriptions, Number(yearMonth.slice(0, 4)));
  const annualMonthlyAverage = annualTotal / 12;

  const requestDelete = (subscription: Subscription) => navigation.request(() => setDeletingSubscription(subscription));

  const confirmDelete = async () => {
    if (!deletingSubscription) {
      return;
    }

    try {
      await apiFetch(`/api/subscriptions/${deletingSubscription.id}`, { method: "DELETE" });
      toast({ title: `${deletingSubscription.name} を削除しました` });
      setDeletingSubscription(null);
      reload();
    } catch (deleteError) {
      toast({ title: "削除に失敗しました", description: describeError(deleteError), variant: "error" });
    }
  };

  const openEdit = (subscription: Subscription, mode: "detail" | "basic", origin: HTMLElement) => navigation.request(() => {
    selectionKey.current += 1;
    setSelection({ subscription, mode, key: selectionKey.current, origin, openedToday: getTodayDate() });
  });
  const refreshEditing = async () => {
    const [subscriptions, accounts, cards] = await Promise.all([
      apiFetch<Subscription[]>("/api/subscriptions"), apiFetch<Account[]>("/api/accounts"),
      apiFetch<CreditCard[]>("/api/credit-cards"),
    ]);
    setData({ subscriptions, accounts, cards });
    return subscriptions;
  };

  const openCreate = () => navigation.request(() => {
    setCreateToday(getTodayDate());
    setCreateKey((key) => key + 1);
    setCreateOpen(true);
  });

  const columns: ResponsiveTableColumn<Subscription>[] = [
    { key: "name", header: "サービス", render: (subscription) => <button type="button" className="text-left font-medium text-brand" onClick={(event) => openEdit(subscription, "detail", event.currentTarget)}>{subscription.name}</button> },
    { key: "amounts", header: "金額と適用期間", render: (subscription) => <SubscriptionAmountList subscription={subscription} referenceDate={today} /> },
    { key: "schedule", header: "周期", render: (subscription) => formatSubscriptionSchedule(subscription) },
    { key: "source", header: "支払い元", render: (subscription) => subscription.paymentSource ?? "未設定" },
    {
      key: "actions",
      header: "",
      render: (subscription) => (
        <div className="flex justify-end gap-1">
          <IconButton aria-label="編集" onClick={(event) => openEdit(subscription, "basic", event.currentTarget)}>
            <Pencil aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <IconButton aria-label="削除" variant="danger" onClick={() => requestDelete(subscription)}>
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </div>
      ),
    },
  ];

  const renderSubscriptionMobileRow = (subscription: Subscription) => (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" className="truncate text-left font-medium text-brand" onClick={(event) => openEdit(subscription, "detail", event.currentTarget)}>{subscription.name}</button>
          <div className="text-xs text-ink-3">{formatSubscriptionSchedule(subscription)}</div>
        </div>
      </div>
      <SubscriptionAmountList subscription={subscription} referenceDate={today} />
      <div className="flex items-center justify-between gap-3 text-xs text-ink-3">
        <span>{subscription.paymentSource ?? "未設定"}</span>
        <div className="flex gap-1">
          <IconButton aria-label="編集" onClick={(event) => openEdit(subscription, "basic", event.currentTarget)}>
            <Pencil aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <IconButton aria-label="削除" variant="danger" onClick={() => requestDelete(subscription)}>
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </>
  );

  return (
    <SubscriptionEditorLayout selection={selection} paymentSources={paymentSources} onClose={() => setSelection(null)} onSaved={refreshEditing}>
    <div className="grid gap-6">
      <datalist id="subscription-payment-sources">
        {paymentSources.map((source) => (
          <option key={source} value={source} />
        ))}
      </datalist>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">サブスク管理</h2>
          <p className="mt-2 text-sm text-ink-2">定額課金を登録して、月別・年別の支払予定をまとめて確認します。</p>
          <p className="mt-1 max-w-3xl text-sm text-ink-2">
            残高予測には直接反映しません。カード払い分はクレジットカード請求額に含めて扱い、
            口座引き落としの定額支払いを予測に含めたい場合は予定収支に登録します。
          </p>
        </div>
        <Button className="min-h-10 gap-2" onClick={openCreate}>
          <span className="text-lg leading-none">+</span>
          サブスクを追加
        </Button>
      </div>

      <Card className="grid gap-4 md:grid-cols-3">
        <div className="min-w-0 rounded-lg border border-line bg-surface-2 p-4">
          <div className="break-words text-sm font-medium text-ink-3">{yearMonth.slice(0, 4)}年の年間合計</div>
          <div className="font-data mt-3 overflow-x-auto whitespace-nowrap text-2xl font-semibold sm:text-4xl">{formatCurrency(annualTotal, "JPY")}</div>
          <div className="mt-2 text-sm text-ink-2">合計額（JPY 換算）</div>
        </div>
        <div className="min-w-0 rounded-lg border border-line bg-surface-2 p-4">
          <div className="text-sm font-medium text-ink-3">月あたり</div>
          <div className="font-data mt-3 overflow-x-auto whitespace-nowrap text-2xl font-semibold sm:text-3xl">{formatCurrency(annualMonthlyAverage, "JPY")}</div>
          <div className="mt-2 text-sm text-ink-2">年間合計の12分の1（JPY 換算）</div>
        </div>
        <div className="min-w-0 rounded-lg border border-line bg-surface-2 p-4">
          <div className="text-sm font-medium text-ink-3">件数</div>
          <div className="mt-3 break-words text-2xl font-semibold sm:text-3xl">
            {loading ? "読み込み中..." : `${subscriptions.length}件`}
          </div>
          <div className="mt-2 text-sm text-ink-2">登録済みサブスク</div>
        </div>
      </Card>

      <Card className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">月別一覧</h2>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => navigation.request(() => setYearMonth((value) => addMonths(value, -1)))}>
              前月
            </Button>
            <div className="min-w-32 text-center text-sm font-medium">{formatYearMonth(yearMonth)}</div>
            <Button variant="ghost" onClick={() => navigation.request(() => setYearMonth((value) => addMonths(value, 1)))}>
              次月
            </Button>
          </div>
        </div>
        <div className="flex items-end justify-between gap-4 rounded-2xl border border-line bg-surface-2 px-4 py-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-ink-3">月合計</div>
            <div className="font-data mt-1 overflow-x-auto whitespace-nowrap text-2xl font-semibold">{formatCurrency(monthlySummary.total, "JPY")}</div>
          </div>
          <div className="text-sm text-ink-2">{monthlySummary.items.length} 件</div>
        </div>
        <ResponsiveTable
          columns={[
            { key: "name", header: "サービス", render: ({ subscription }: SubscriptionOccurrence) => subscription.name },
            { key: "day", header: "課金日", render: ({ subscription, date }: SubscriptionOccurrence) => `${formatDateWithYear(date)}（${formatSubscriptionSchedule(subscription)}）` },
            { key: "amount", header: "金額", align: "right", mono: true, render: ({ subscription, amount }: SubscriptionOccurrence) => formatCurrency(amount, subscription.currencyCode) },
            { key: "source", header: "支払い元", render: ({ subscription }: SubscriptionOccurrence) => subscription.paymentSource ?? "未設定" },
          ]}
          rows={monthlySummary.items}
          rowKey={({ subscription, date }) => `${subscription.id}-${date}`}
          emptyMessage="この月に課金されるサブスクはありません。"
          mobileRow={({ subscription, date, amount }: SubscriptionOccurrence) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{subscription.name}</div>
                <div className="text-xs text-ink-3">{formatDateWithYear(date)}・{formatSubscriptionSchedule(subscription)}</div>
              </div>
              <div className="font-data">{formatCurrency(amount, subscription.currencyCode)}</div>
            </div>
          )}
        />
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">サブスク一覧</h2>
          <div className="text-sm text-ink-2">{loading ? "読み込み中..." : `${subscriptions.length} 件`}</div>
        </div>
        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : (
          <>
            <ResponsiveTable
              columns={columns}
              rows={activeSubscriptions}
              rowKey={(subscription) => subscription.id}
              emptyMessage={
                activeSubscriptions.length === 0 && archivedSubscriptions.length > 0
                  ? "現役のサブスクはありません。"
                  : "サブスクが登録されていません。上部の「サブスクを追加」から登録してください。"
              }
              mobileRow={renderSubscriptionMobileRow}
            />
            <ArchivedSection title="終了済み" count={archivedSubscriptions.length}>
              <ResponsiveTable
                columns={columns}
                rows={archivedSubscriptions}
                rowKey={(subscription) => subscription.id}
                mobileRow={renderSubscriptionMobileRow}
              />
            </ArchivedSection>
          </>
        )}
      </Card>

      {createOpen ? <SubscriptionCreateModal key={createKey} openedToday={createToday} paymentSources={paymentSources}
        onClose={() => setCreateOpen(false)} onSaved={async () => { await refreshEditing(); }} /> : null}

      <ConfirmDialog
        open={Boolean(deletingSubscription)}
        onOpenChange={(open) => !open && setDeletingSubscription(null)}
        title="サブスクを削除しますか？"
        description={deletingSubscription ? `「${deletingSubscription.name}」を削除します。この操作は取り消せません。` : undefined}
        onConfirm={confirmDelete}
      />
    </div>
    </SubscriptionEditorLayout>
  );
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

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="grid gap-3 rounded-xl border border-critical/40 bg-critical/10 p-4 text-sm text-ink">
      <p role="alert">{message}</p>
      <Button className="justify-self-start" variant="secondary" onClick={onRetry}>
        再試行
      </Button>
    </div>
  );
}
