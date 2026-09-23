import type {
  Account,
  CreateSubscriptionPayload,
  CreditCard,
  Recurrence,
  Subscription,
  SupportedCurrencyCode,
  SubscriptionAmountChange,
} from "@sui/shared";
import { addCalendarDays, convertMinorUnitToJpy, formatSchedule, resolveDatedAmount, SUPPORTED_CURRENCY_CODES } from "@sui/shared";
import { useEffect, useId, useRef, useState, startTransition } from "react";
import { ScheduleField } from "../components/ScheduleField";
import { ArchivedSection } from "../components/ArchivedSection";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConditionalField } from "../components/ui/conditional-field";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { MoneyInput } from "../components/ui/money-input";
import { ResponsiveTable, type ResponsiveTableColumn } from "../components/ui/responsive-table";
import { Select } from "../components/ui/select";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { getOccurrenceDatesInMonth } from "../lib/dates";
import { formatCurrency, formatDateWithYear } from "../lib/format";
import { getCurrentYearMonth, getTodayDate } from "../lib/utils";
import { Pencil, Trash2 } from "lucide-react";

type SubscriptionForm = CreateSubscriptionPayload & {
  currencyCode: SupportedCurrencyCode;
  exchangeRateToJpy: number;
  recurrence: Recurrence;
  interval: number;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
};

const today = getTodayDate();
const defaultDayOfMonth = Number(today.slice(8, 10));

const emptyForm: SubscriptionForm = {
  name: "",
  amount: 0,
  currencyCode: "JPY",
  exchangeRateToJpy: 1,
  recurrence: "monthly",
  interval: 1,
  startDate: today,
  dayOfMonth: defaultDayOfMonth,
  dayOfWeek: null,
  endDate: null,
  paymentSource: null,
};

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
  if (endDate === null) {
    return `${formatDateWithYear(startDate)} 〜`;
  }

  return `${formatDateWithYear(startDate)} 〜 ${formatDateWithYear(endDate)}`;
}

export interface SubscriptionPricePeriod {
  subscription: Subscription;
  amount: number;
  startDate: string;
  endDate: string | null;
  change: SubscriptionAmountChange | null;
  key: string;
}

/** Show the price history as contract periods, like the recurring-item list. */
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

export function partitionSubscriptionPricePeriods(periods: SubscriptionPricePeriod[], referenceDate: string) {
  return {
    active: periods.filter((period) => period.endDate === null || period.endDate >= referenceDate),
    archived: periods.filter((period) => period.endDate !== null && period.endDate < referenceDate),
  };
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

export function SubscriptionsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [form, setForm] = useState<SubscriptionForm>(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
  const [changeDate, setChangeDate] = useState("");
  const [changeAmount, setChangeAmount] = useState(0);
  const [editingChange, setEditingChange] = useState<SubscriptionAmountChange | null>(null);
  const [editForm, setEditForm] = useState<SubscriptionForm>(emptyForm);
  const [deletingSubscription, setDeletingSubscription] = useState<Subscription | null>(null);
  const { toast } = useToast();

  const { data, loading, error } = useResource(
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
  const { active: activePeriods, archived: archivedPeriods } = partitionSubscriptionPricePeriods(
    getSubscriptionPricePeriods(subscriptions), today,
  );
  const paymentSources = getPaymentSourceOptions(data?.accounts ?? [], data?.cards ?? []);
  const monthlySummary = getMonthlySummary(subscriptions, yearMonth);
  const annualTotal = getAnnualTotal(subscriptions, Number(yearMonth.slice(0, 4)));
  const annualMonthlyAverage = annualTotal / 12;
  const canCreate =
    form.name.trim().length > 0 &&
    form.amount > 0 &&
    isValidExchangeRate(form) &&
    form.startDate !== "" &&
    isPeriodValid(form.startDate, form.endDate) &&
    form.interval >= 1 &&
    (form.recurrence === "monthly"
      ? form.dayOfMonth !== null && form.dayOfMonth >= 1 && form.dayOfMonth <= 31
      : form.dayOfWeek !== null && form.dayOfWeek >= 0 && form.dayOfWeek <= 6);
  const canSaveEdit =
    editForm.name.trim().length > 0 &&
    editForm.amount > 0 &&
    isValidExchangeRate(editForm) &&
    editForm.startDate !== "" &&
    isPeriodValid(editForm.startDate, editForm.endDate) &&
    editForm.interval >= 1 &&
    (editForm.recurrence === "monthly"
      ? editForm.dayOfMonth !== null && editForm.dayOfMonth >= 1 && editForm.dayOfMonth <= 31
      : editForm.dayOfWeek !== null && editForm.dayOfWeek >= 0 && editForm.dayOfWeek <= 6);

  const createSubscription = async () => {
    try {
      await apiFetch("/api/subscriptions", {
        method: "POST",
        body: JSON.stringify(form),
      });
      const name = form.name;
      setForm(emptyForm);
      setCreateOpen(false);
      reload();
      toast({ title: `${name} を追加しました` });
    } catch (createError) {
      toast({ title: "サブスクの追加に失敗しました", description: describeError(createError), variant: "error" });
    }
  };

  const updateSubscription = async (subscription: Subscription) => {
    await apiFetch(`/api/subscriptions/${subscription.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: subscription.name,
        amount: subscription.amount,
        currencyCode: subscription.currencyCode,
        exchangeRateToJpy: subscription.exchangeRateToJpy,
        recurrence: subscription.recurrence,
        interval: subscription.interval,
        startDate: subscription.startDate,
        dayOfMonth: subscription.dayOfMonth,
        dayOfWeek: subscription.dayOfWeek,
        endDate: subscription.endDate,
        paymentSource: subscription.paymentSource,
      }),
    });
    reload();
  };

  const requestDelete = (subscription: Subscription) => setDeletingSubscription(subscription);

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

  const openEdit = (subscription: Subscription, change: SubscriptionAmountChange | null = null) => {
    setEditingSubscription(subscription);
    setChangeDate(change?.effectiveFrom ?? "");
    setChangeAmount(change?.amount ?? subscription.effectiveAmount ?? subscription.amount);
    setEditingChange(change);
    setEditForm({
      name: subscription.name,
      amount: subscription.amount,
      currencyCode: subscription.currencyCode,
      exchangeRateToJpy: subscription.exchangeRateToJpy,
      recurrence: subscription.recurrence,
      interval: subscription.interval,
      startDate: subscription.startDate,
      dayOfMonth: subscription.dayOfMonth,
      dayOfWeek: subscription.dayOfWeek,
      endDate: subscription.endDate,
      paymentSource: subscription.paymentSource,
    });
  };

  const closeEdit = () => {
    setEditingSubscription(null);
    setEditingChange(null);
    setEditForm(emptyForm);
  };

  const refreshEditing = async (id: string) => {
    const latest = await apiFetch<Subscription[]>("/api/subscriptions");
    setEditingSubscription(latest.find((item) => item.id === id) ?? null);
    reload();
  };

  const saveAmountChange = async () => {
    if (!editingSubscription || !changeDate || changeAmount <= 0) return;
    try {
      await apiFetch(`/api/subscriptions/${editingSubscription.id}/amount-changes${editingChange ? `/${editingChange.id}` : ""}`, {
        method: editingChange ? "PUT" : "POST",
        body: JSON.stringify({ effectiveFrom: changeDate, amount: changeAmount }),
      });
      await refreshEditing(editingSubscription.id);
      setEditingChange(null);
      setChangeDate("");
      toast({ title: editingChange ? "価格履歴を訂正しました" : "価格変更を予約しました" });
    } catch (changeError) {
      toast({ title: "価格履歴の保存に失敗しました", description: describeError(changeError), variant: "error" });
    }
  };

  const deleteAmountChange = async (change: SubscriptionAmountChange) => {
    if (!editingSubscription || !window.confirm(`${change.effectiveFrom} の価格履歴を削除します。過去の台帳集計も変わる可能性があります。続けますか？`)) return;
    try {
      await apiFetch(`/api/subscriptions/${editingSubscription.id}/amount-changes/${change.id}`, { method: "DELETE" });
      await refreshEditing(editingSubscription.id);
      toast({ title: "価格履歴を削除しました" });
    } catch (changeError) {
      toast({ title: "価格履歴の削除に失敗しました", description: describeError(changeError), variant: "error" });
    }
  };

  const saveEdit = async () => {
    if (!editingSubscription) {
      return;
    }

    try {
      await updateSubscription({ ...editingSubscription, ...editForm });
      closeEdit();
      toast({ title: `${editForm.name} を更新しました` });
    } catch (updateError) {
      toast({ title: "更新に失敗しました", description: describeError(updateError), variant: "error" });
    }
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setForm(emptyForm);
  };

  const columns: ResponsiveTableColumn<SubscriptionPricePeriod>[] = [
    { key: "name", header: "サービス", render: ({ subscription }) => subscription.name },
    { key: "amount", header: "金額", align: "right", mono: true, render: ({ subscription, amount }) => formatCurrency(amount, subscription.currencyCode) },
    { key: "schedule", header: "周期", render: ({ subscription }) => formatSubscriptionSchedule(subscription) },
    { key: "period", header: "期間", render: ({ startDate, endDate }) => formatPeriod(startDate, endDate) },
    { key: "source", header: "支払い元", render: ({ subscription }) => subscription.paymentSource ?? "未設定" },
    {
      key: "actions",
      header: "",
      render: ({ subscription, change }) => (
        <div className="flex justify-end gap-1">
          <IconButton aria-label="編集" onClick={() => openEdit(subscription, change)}>
            <Pencil aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <IconButton aria-label="削除" variant="danger" onClick={() => requestDelete(subscription)}>
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </div>
      ),
    },
  ];

  const renderSubscriptionMobileRow = ({ subscription, amount, startDate, endDate, change }: SubscriptionPricePeriod) => (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{subscription.name}</div>
          <div className="text-xs text-ink-3">{formatSubscriptionSchedule(subscription)}</div>
        </div>
        <div className="font-data text-base font-semibold">{formatCurrency(amount, subscription.currencyCode)}</div>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-ink-3">
        <span>{formatPeriod(startDate, endDate)}・{subscription.paymentSource ?? "未設定"}</span>
        <div className="flex gap-1">
          <IconButton aria-label="編集" onClick={() => openEdit(subscription, change)}>
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
        <Button className="min-h-10 gap-2" onClick={() => setCreateOpen(true)}>
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
            <Button variant="ghost" onClick={() => setYearMonth((value) => addMonths(value, -1))}>
              前月
            </Button>
            <div className="min-w-32 text-center text-sm font-medium">{formatYearMonth(yearMonth)}</div>
            <Button variant="ghost" onClick={() => setYearMonth((value) => addMonths(value, 1))}>
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
          <div className="text-sm text-ink-2">{loading ? "読み込み中..." : `${subscriptions.length} 件・価格期間 ${activePeriods.length + archivedPeriods.length} 件`}</div>
        </div>
        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : (
          <>
            <ResponsiveTable
              columns={columns}
              rows={activePeriods}
              rowKey={(period) => `${period.subscription.id}:${period.key}`}
              emptyMessage={
                activePeriods.length === 0 && archivedPeriods.length > 0
                  ? "現役のサブスクはありません。"
                  : "サブスクが登録されていません。上部の「サブスクを追加」から登録してください。"
              }
              mobileRow={renderSubscriptionMobileRow}
            />
            <ArchivedSection title="終了済み" count={archivedPeriods.length}>
              <ResponsiveTable
                columns={columns}
                rows={archivedPeriods}
                rowKey={(period) => `${period.subscription.id}:${period.key}`}
                mobileRow={renderSubscriptionMobileRow}
              />
            </ArchivedSection>
          </>
        )}
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : closeCreate())}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">サブスクを追加</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">
            サブスク台帳として登録します。残高予測へは直接追加されません。
          </DialogDescription>
          <SubscriptionEditModal
            form={form}
            paymentSources={paymentSources}
            canSave={canCreate}
            actionLabel="追加"
            onChange={setForm}
            onCancel={closeCreate}
            onSave={createSubscription}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingSubscription)} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">サブスクを編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">
            登録済みのサブスク台帳を更新します。残高予測へは直接追加されません。
          </DialogDescription>
          <SubscriptionEditModal
            form={editForm}
            paymentSources={paymentSources}
            canSave={canSaveEdit}
            onChange={setEditForm}
            onCancel={closeEdit}
            onSave={saveEdit}
            editingInitialAmount
          />
          {editingSubscription ? (
            <section className="mt-6 border-t border-line pt-5" aria-label="価格履歴">
              <h3 className="font-semibold">価格変更を予約</h3>
              <p className="mt-1 text-sm text-ink-2">現在価格: {formatCurrency(editingSubscription.effectiveAmount ?? editingSubscription.amount, editingSubscription.currencyCode)}。初期金額: {formatCurrency(editingSubscription.amount, editingSubscription.currencyCode)}。</p>
              {(() => {
                const next = (editingSubscription.amountChanges ?? []).find((change) => change.effectiveFrom > today);
                return next ? <p className="text-sm text-ink-2">次回価格: {formatCurrency(next.amount, editingSubscription.currencyCode)}（{next.effectiveFrom} から）</p> : null;
              })()}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <FormField label="適用開始日" htmlFor="subscription-change-date"><Input id="subscription-change-date" type="date" value={changeDate} onChange={(event) => setChangeDate(event.target.value)} /></FormField>
                <FormField label={`新価格 (${editingSubscription.currencyCode})`} htmlFor="subscription-change-amount"><MoneyInput id="subscription-change-amount" currencyCode={editingSubscription.currencyCode} value={changeAmount} onChange={setChangeAmount} /></FormField>
              </div>
              <div className="mt-3 flex gap-2">
                <Button type="button" disabled={!changeDate || changeAmount <= 0} onClick={saveAmountChange}>{editingChange ? "履歴を訂正" : "価格変更を予約"}</Button>
                {editingChange ? <Button type="button" variant="ghost" onClick={() => { setEditingChange(null); setChangeDate(""); }}>訂正をやめる</Button> : null}
              </div>
              {editingChange ? <p className="mt-2 text-sm text-ink-2">履歴の訂正は過去の台帳集計を変える可能性があります。</p> : null}
              <h4 className="mt-5 font-medium">価格履歴</h4>
              {(editingSubscription.amountChanges ?? []).length === 0 ? <p className="mt-2 text-sm text-ink-3">価格変更はありません。</p> : (
                <ul className="mt-2 space-y-2">
                  {(editingSubscription.amountChanges ?? []).map((change) => <li key={change.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>{change.effectiveFrom} から {formatCurrency(change.amount, editingSubscription.currencyCode)}</span>
                    <span className="flex gap-1"><IconButton aria-label={`${change.effectiveFrom} の履歴を訂正`} onClick={() => { setEditingChange(change); setChangeDate(change.effectiveFrom); setChangeAmount(change.amount); }}><Pencil aria-hidden="true" className="h-4 w-4" /></IconButton><IconButton aria-label={`${change.effectiveFrom} の履歴を削除`} variant="danger" onClick={() => deleteAmountChange(change)}><Trash2 aria-hidden="true" className="h-4 w-4" /></IconButton></span>
                  </li>)}
                </ul>
              )}
            </section>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deletingSubscription)}
        onOpenChange={(open) => !open && setDeletingSubscription(null)}
        title="サブスクを削除しますか？"
        description={deletingSubscription ? `「${deletingSubscription.name}」を削除します。この操作は取り消せません。` : undefined}
        onConfirm={confirmDelete}
      />
    </div>
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
  editingInitialAmount = false,
}: {
  form: SubscriptionForm;
  paymentSources: string[];
  onChange: (next: SubscriptionForm) => void;
  canSave: boolean;
  onCancel: () => void;
  onSave: () => void;
  actionLabel?: string;
  editingInitialAmount?: boolean;
}) {
  const nameId = useId();
  const amountId = useId();
  const currencyId = useId();
  const rateId = useId();
  const sourceId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
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
      <FormField label="サービス名" htmlFor={nameId} required>
        <Input id={nameId} ref={firstFieldRef} value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} />
      </FormField>

      <FormField label="通貨" htmlFor={currencyId}>
        <Select id={currencyId} value={form.currencyCode} onChange={(event) => setCurrencyCode(event.target.value as SupportedCurrencyCode)}>
          {SUPPORTED_CURRENCY_CODES.map((currencyCode) => (
            <option key={currencyCode} value={currencyCode}>
              {currencyCode}
            </option>
          ))}
        </Select>
      </FormField>

      <ConditionalField show={form.currencyCode !== "JPY"}>
        <FormField label="JPY換算レート" htmlFor={rateId}>
          <Input
            id={rateId}
            type="number"
            inputMode="decimal"
            min="0"
            step="0.0001"
            value={form.exchangeRateToJpy}
            onChange={(event) => onChange({ ...form, exchangeRateToJpy: Number(event.target.value) })}
          />
        </FormField>
      </ConditionalField>

      <FormField label={`${editingInitialAmount ? "初期金額（訂正）" : "金額"} (${form.currencyCode})`} htmlFor={amountId} required help={editingInitialAmount ? "通常の価格変更は下の「価格変更を予約」を使います。初期金額の訂正は過去の台帳集計を変える可能性があります。" : undefined}>
        <MoneyInput id={amountId} currencyCode={form.currencyCode} value={form.amount} onChange={(value) => onChange({ ...form, amount: value })} />
      </FormField>

      <ScheduleField
        id="subscription-schedule"
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

      {form.interval !== 12 ? (
        <FormField label="課金開始日" htmlFor="subscription-start" required>
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
        error={!isPeriodValid(form.startDate, form.endDate) ? "開始日は終了日以前にしてください。" : null}
      >
        <Input
          id="subscription-end"
          type="date"
          value={form.endDate ?? ""}
          onChange={(event) => onChange({ ...form, endDate: parseOptionalDate(event.target.value) })}
        />
      </FormField>

      <FormField label="支払い元" htmlFor={sourceId}>
        <Input
          id={sourceId}
          list="subscription-payment-sources"
          placeholder={paymentSources.length === 0 ? "任意入力" : "カード名・口座名から選択または入力"}
          value={form.paymentSource ?? ""}
          onChange={(event) => onChange({ ...form, paymentSource: parseOptionalText(event.target.value) })}
        />
      </FormField>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="text-xs text-ink-3">{!canSave && missing.length > 0 ? `必須: ${missing.join("、")}` : ""}</div>
        <div className="flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={onCancel}>
            キャンセル
          </Button>
          <Button type="submit" disabled={!canSave}>
            {actionLabel}
          </Button>
        </div>
      </div>
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
