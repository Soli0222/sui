import type {
  Account,
  CreateSubscriptionPayload,
  CreditCard,
  Subscription,
} from "@sui/shared";
import { startTransition, useState } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Table, TableWrapper } from "../components/ui/table";
import { useResource } from "../hooks/use-resource";
import { apiFetch } from "../lib/api";
import { formatCurrency, formatDateWithYear } from "../lib/format";
import { cn } from "../lib/utils";
import { getCurrentYearMonth, getTodayDate } from "../lib/utils";

type SubscriptionForm = CreateSubscriptionPayload;

const today = getTodayDate();
const defaultDayOfMonth = Number(today.slice(8, 10));

const emptyForm: SubscriptionForm = {
  name: "",
  amount: 0,
  intervalMonths: 1,
  startDate: today,
  dayOfMonth: defaultDayOfMonth,
  endDate: null,
  paymentSource: null,
};

const intervalOptions = [
  { value: "1", label: "毎月" },
  { value: "3", label: "3ヶ月ごと" },
  { value: "6", label: "半年ごと" },
  { value: "12", label: "毎年" },
  { value: "custom", label: "カスタム" },
] as const;

function parseOptionalDate(value: string) {
  return value === "" ? null : value;
}

function parseOptionalText(value: string) {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function resolveCustomInterval(intervalMonths: number) {
  return intervalOptions.some((option) => option.value === String(intervalMonths)) ? 2 : intervalMonths;
}

function isPeriodValid(startDate: string, endDate: string | null | undefined) {
  return !endDate || startDate <= endDate;
}

function getIntervalOptionValue(intervalMonths: number) {
  return intervalOptions.some((option) => option.value === String(intervalMonths))
    ? String(intervalMonths)
    : "custom";
}

function formatInterval(intervalMonths: number) {
  if (intervalMonths === 1) {
    return "毎月";
  }
  if (intervalMonths === 12) {
    return "毎年";
  }
  return `${intervalMonths}ヶ月ごと`;
}

function formatPeriod(startDate: string, endDate: string | null) {
  if (endDate === null) {
    return `${formatDateWithYear(startDate)} 〜`;
  }

  return `${formatDateWithYear(startDate)} 〜 ${formatDateWithYear(endDate)}`;
}

function getYearMonthTotal(yearMonth: string) {
  return Number(yearMonth.slice(0, 4)) * 12 + Number(yearMonth.slice(5, 7)) - 1;
}

function isActiveInMonth(subscription: Subscription, yearMonth: string) {
  const startYearMonth = subscription.startDate.slice(0, 7);
  if (startYearMonth > yearMonth) {
    return false;
  }

  if (subscription.endDate && subscription.endDate.slice(0, 7) < yearMonth) {
    return false;
  }

  return (getYearMonthTotal(yearMonth) - getYearMonthTotal(startYearMonth)) % subscription.intervalMonths === 0;
}

function getMonthlySummary(subscriptions: Subscription[], yearMonth: string) {
  const items = subscriptions
    .filter((subscription) => isActiveInMonth(subscription, yearMonth))
    .sort((left, right) => left.dayOfMonth - right.dayOfMonth || left.name.localeCompare(right.name, "ja-JP"));

  return {
    items,
    total: items.reduce((sum, item) => sum + item.amount, 0),
  };
}

function getAnnualTotal(subscriptions: Subscription[], year: number) {
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

function getPaymentSourceOptions(accounts: Account[], cards: CreditCard[]) {
  return Array.from(
    new Set([...cards.map((card) => card.name), ...accounts.map((account) => account.name)].filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right, "ja-JP"));
}

export function SubscriptionsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [form, setForm] = useState<SubscriptionForm>(emptyForm);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
  const [editForm, setEditForm] = useState<SubscriptionForm>(emptyForm);

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
  const paymentSources = getPaymentSourceOptions(data?.accounts ?? [], data?.cards ?? []);
  const monthlySummary = getMonthlySummary(subscriptions, yearMonth);
  const annualTotal = getAnnualTotal(subscriptions, Number(yearMonth.slice(0, 4)));
  const canCreate =
    form.name.trim().length > 0 &&
    form.amount > 0 &&
    form.intervalMonths > 0 &&
    form.dayOfMonth >= 1 &&
    form.dayOfMonth <= 31 &&
    form.startDate !== "" &&
    isPeriodValid(form.startDate, form.endDate);
  const canSaveEdit =
    editForm.name.trim().length > 0 &&
    editForm.amount > 0 &&
    editForm.intervalMonths > 0 &&
    editForm.dayOfMonth >= 1 &&
    editForm.dayOfMonth <= 31 &&
    editForm.startDate !== "" &&
    isPeriodValid(editForm.startDate, editForm.endDate);

  const createSubscription = async () => {
    await apiFetch("/api/subscriptions", {
      method: "POST",
      body: JSON.stringify(form),
    });
    setForm(emptyForm);
    reload();
  };

  const updateSubscription = async (subscription: Subscription) => {
    await apiFetch(`/api/subscriptions/${subscription.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: subscription.name,
        amount: subscription.amount,
        intervalMonths: subscription.intervalMonths,
        startDate: subscription.startDate,
        dayOfMonth: subscription.dayOfMonth,
        endDate: subscription.endDate,
        paymentSource: subscription.paymentSource,
      }),
    });
    reload();
  };

  const deleteSubscription = async (id: string) => {
    if (!window.confirm("このサブスクを削除します。よろしいですか？")) {
      return;
    }

    await apiFetch(`/api/subscriptions/${id}`, { method: "DELETE" });
    reload();
  };

  const openEdit = (subscription: Subscription) => {
    setEditingSubscription(subscription);
    setEditForm({
      name: subscription.name,
      amount: subscription.amount,
      intervalMonths: subscription.intervalMonths,
      startDate: subscription.startDate,
      dayOfMonth: subscription.dayOfMonth,
      endDate: subscription.endDate,
      paymentSource: subscription.paymentSource,
    });
  };

  const closeEdit = () => {
    setEditingSubscription(null);
    setEditForm(emptyForm);
  };

  const saveEdit = async () => {
    if (!editingSubscription) {
      return;
    }

    await updateSubscription({
      ...editingSubscription,
      ...editForm,
    });
    closeEdit();
  };

  return (
    <div className="grid gap-6">
      <datalist id="subscription-payment-sources">
        {paymentSources.map((source) => (
          <option key={source} value={source} />
        ))}
      </datalist>

      <Card className="grid gap-4">
        <div>
          <h2 className="text-xl font-semibold">サブスクを追加</h2>
          <p className="mt-2 text-sm text-white/60">定額課金を登録して、月別・年別の支払予定をまとめて確認します。</p>
        </div>
        <SubscriptionFormFields form={form} paymentSources={paymentSources} onChange={setForm} />
        {!isPeriodValid(form.startDate, form.endDate) ? (
          <div className="text-sm text-sky-200">開始日は終了日以前にしてください。</div>
        ) : null}
        <div className="flex justify-end">
          <Button disabled={!canCreate} onClick={createSubscription}>
            追加
          </Button>
        </div>
      </Card>

      <Card className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
        <div>
          <div className="text-sm uppercase tracking-[0.18em] text-white/45">{yearMonth.slice(0, 4)}年の年間合計</div>
          <div className="mt-3 text-4xl font-semibold">{formatCurrency(annualTotal)}</div>
          <div className="mt-2 text-sm text-white/60">選択中の年に課金されるサブスク支払額の合計です。</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/65">
          <div>{loading ? "読み込み中..." : error ?? `${subscriptions.length} 件のサブスクを集計中`}</div>
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
        <div className="flex items-end justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-white/45">月合計</div>
            <div className="mt-1 text-2xl font-semibold">{formatCurrency(monthlySummary.total)}</div>
          </div>
          <div className="text-sm text-white/60">{monthlySummary.items.length} 件</div>
        </div>
        <TableWrapper>
          <Table className="min-w-[56rem]">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.18em] text-white/45">
                <th className="px-3 py-3">サービス</th>
                <th className="px-3 py-3">課金日</th>
                <th className="px-3 py-3">頻度</th>
                <th className="px-3 py-3">金額</th>
                <th className="px-3 py-3">支払い元</th>
              </tr>
            </thead>
            <tbody>
              {monthlySummary.items.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-sm text-white/50" colSpan={5}>
                    この月に課金されるサブスクはありません。
                  </td>
                </tr>
              ) : (
                monthlySummary.items.map((subscription) => (
                  <tr key={`${subscription.id}-${yearMonth}`} className="border-b border-white/5">
                    <td className="px-3 py-3">{subscription.name}</td>
                    <td className="px-3 py-3">毎月 {subscription.dayOfMonth} 日</td>
                    <td className="px-3 py-3">{formatInterval(subscription.intervalMonths)}</td>
                    <td className="px-3 py-3">{formatCurrency(subscription.amount)}</td>
                    <td className="px-3 py-3">{subscription.paymentSource ?? "未設定"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </TableWrapper>
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">サブスク一覧</h2>
          <div className="text-sm text-white/60">{loading ? "読み込み中..." : error ?? `${subscriptions.length} 件`}</div>
        </div>
        <TableWrapper>
          <Table className="min-w-[72rem]">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.18em] text-white/45">
                <th className="px-3 py-3">サービス</th>
                <th className="px-3 py-3">金額</th>
                <th className="px-3 py-3">頻度</th>
                <th className="px-3 py-3">課金日</th>
                <th className="px-3 py-3">開始日</th>
                <th className="px-3 py-3">期間</th>
                <th className="px-3 py-3">支払い元</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((subscription) => (
                <SubscriptionRow
                  key={subscription.id}
                  subscription={subscription}
                  onEdit={openEdit}
                  onDelete={deleteSubscription}
                />
              ))}
            </tbody>
          </Table>
        </TableWrapper>
      </Card>

      <Dialog open={Boolean(editingSubscription)} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent className="w-[min(92vw,40rem)]">
          <DialogTitle className="text-lg font-semibold">サブスクを編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-white/60">
            登録済みのサブスク内容を更新します。
          </DialogDescription>
          <div className="mt-6 grid gap-5">
            <SubscriptionFormFields form={editForm} paymentSources={paymentSources} onChange={setEditForm} />
            {!isPeriodValid(editForm.startDate, editForm.endDate) ? (
              <div className="text-sm text-sky-200">開始日は終了日以前にしてください。</div>
            ) : null}
            <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
              <Button variant="ghost" onClick={closeEdit}>
                キャンセル
              </Button>
              <Button disabled={!canSaveEdit} onClick={saveEdit}>
                保存
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SubscriptionFormFields({
  form,
  paymentSources,
  onChange,
}: {
  form: SubscriptionForm;
  paymentSources: string[];
  onChange: (next: SubscriptionForm) => void;
}) {
  const intervalValue = getIntervalOptionValue(form.intervalMonths);
  const isCustomInterval = intervalValue === "custom";

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
        <label className="grid min-w-0 gap-2 text-sm md:col-span-2 xl:col-span-4">
          <span>サービス名 *</span>
          <Input value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} />
        </label>
        <label className="grid min-w-0 gap-2 text-sm xl:col-span-2">
          <span>金額 (円) *</span>
          <Input type="number" min={1} value={form.amount} onChange={(event) => onChange({ ...form, amount: Number(event.target.value) })} />
        </label>
        <label className="grid min-w-0 gap-2 text-sm xl:col-span-2">
          <span>頻度</span>
          <Select
            value={intervalValue}
            onChange={(event) =>
              onChange({
                ...form,
                intervalMonths:
                  event.target.value === "custom"
                    ? resolveCustomInterval(form.intervalMonths)
                    : Number(event.target.value),
              })}
          >
            {intervalOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        {isCustomInterval ? (
          <label className="grid min-w-0 gap-2 text-sm xl:col-span-2">
            <span>周期 (ヶ月) *</span>
            <Input
              type="number"
              min={1}
              value={form.intervalMonths}
              onChange={(event) => onChange({ ...form, intervalMonths: Number(event.target.value) })}
            />
          </label>
        ) : null}
        <label
          className={cn(
            "grid min-w-0 gap-2 text-sm",
            isCustomInterval ? "xl:col-span-2" : "xl:col-span-4",
          )}
        >
          <span>課金開始日 *</span>
          <Input type="date" value={form.startDate} onChange={(event) => onChange({ ...form, startDate: event.target.value })} />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
        <label className="grid min-w-0 gap-2 text-sm xl:col-span-3">
          <span>課金日 (1-31)</span>
          <Input type="number" min={1} max={31} value={form.dayOfMonth} onChange={(event) => onChange({ ...form, dayOfMonth: Number(event.target.value) })} />
        </label>
        <label className="grid min-w-0 gap-2 text-sm xl:col-span-3">
          <span>終了日</span>
          <Input type="date" value={form.endDate ?? ""} onChange={(event) => onChange({ ...form, endDate: parseOptionalDate(event.target.value) })} />
        </label>
        <label className="grid min-w-0 gap-2 text-sm md:col-span-2 xl:col-span-6">
          <span>支払い元</span>
          <Input
            list="subscription-payment-sources"
            placeholder={paymentSources.length === 0 ? "任意入力" : "カード名・口座名から選択または入力"}
            value={form.paymentSource ?? ""}
            onChange={(event) => onChange({ ...form, paymentSource: parseOptionalText(event.target.value) })}
          />
        </label>
      </div>
    </div>
  );
}

function SubscriptionRow({
  subscription,
  onEdit,
  onDelete,
}: {
  subscription: Subscription;
  onEdit: (subscription: Subscription) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <tr className="border-b border-white/5">
      <td className="px-3 py-3">{subscription.name}</td>
      <td className="px-3 py-3">{formatCurrency(subscription.amount)}</td>
      <td className="px-3 py-3">{formatInterval(subscription.intervalMonths)}</td>
      <td className="px-3 py-3">毎月 {subscription.dayOfMonth} 日</td>
      <td className="px-3 py-3">{formatDateWithYear(subscription.startDate)}</td>
      <td className="px-3 py-3">{formatPeriod(subscription.startDate, subscription.endDate)}</td>
      <td className="px-3 py-3">{subscription.paymentSource ?? "未設定"}</td>
      <td className="px-3 py-3">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onEdit(subscription)}>
            編集
          </Button>
          <Button variant="danger" onClick={() => onDelete(subscription.id)}>
            削除
          </Button>
        </div>
      </td>
    </tr>
  );
}
