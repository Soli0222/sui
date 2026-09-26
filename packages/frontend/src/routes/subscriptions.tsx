import type { Account, CreditCard, Subscription, SubscriptionOccurrence } from "@sui/shared";
import { getAnnualTotal, getMonthlySummary } from "@sui/shared";
import { useRef, useState, startTransition } from "react";
import { ArchivedSection } from "../components/ArchivedSection";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { AmountPeriodList } from "../components/ui/amount-period-list";
import { CardList, RecordCardLayout } from "../components/ui/card-list";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { SubscriptionCreateModal, SubscriptionEditorLayout } from "../components/subscriptions/subscription-editor";
import { formatSubscriptionSchedule, getVisibleSubscriptionPricePeriods, type SubscriptionSelection } from "../components/subscriptions/subscription-form";
import { useEditingNavigation } from "../components/editing/editing-navigation";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { formatCurrency, formatDateWithYear } from "../lib/format";
import { getCurrentYearMonth, getTodayDate } from "../lib/utils";
import { Pencil, Trash2 } from "lucide-react";

function SubscriptionAmountList({ subscription, referenceDate }: { subscription: Subscription; referenceDate: string }) {
  const periods = getVisibleSubscriptionPricePeriods(subscription, referenceDate);
  if (periods.length === 0) {
    return <span className="text-ink-3">適用中の金額なし</span>;
  }

  return <AmountPeriodList rows={periods.map((period) => ({
    key: period.key,
    amount: formatCurrency(period.amount, subscription.currencyCode),
    start: period.startDate,
    end: period.endDate ?? "無期限",
  }))} />;
}

function getYearMonthTotal(yearMonth: string) {
  return Number(yearMonth.slice(0, 4)) * 12 + Number(yearMonth.slice(5, 7)) - 1;
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

  const openEdit = (subscription: Subscription, origin: HTMLElement) => navigation.request(() => {
    selectionKey.current += 1;
    setSelection({ subscription, mode: "detail", key: selectionKey.current, origin, openedToday: getTodayDate() });
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

  const renderSubscriptionCard = (subscription: Subscription) => (
    <RecordCardLayout
      groupDetails
      title={<div><div className="break-words font-medium">{subscription.name}</div>
        <div className="mt-1 text-xs text-ink-3">{formatSubscriptionSchedule(subscription)}</div></div>}
      value={<SubscriptionAmountList subscription={subscription} referenceDate={today} />}
      details={<div className="break-words text-xs text-ink-2">支払い元 {subscription.paymentSource ?? "未設定"}</div>}
      actions={<>
          <IconButton aria-label={`${subscription.name}を編集`} onClick={(event) => openEdit(subscription, event.currentTarget)}>
            <Pencil aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <IconButton aria-label={`${subscription.name}を削除`} variant="danger" onClick={() => requestDelete(subscription)}>
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </IconButton>
      </>}
    />
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
        <CardList
          rows={monthlySummary.items}
          rowKey={({ subscription, date }) => `${subscription.id}-${date}`}
          emptyMessage="この月に課金されるサブスクはありません。"
          renderItem={({ subscription, date, amount }: SubscriptionOccurrence) => (<RecordCardLayout
            title={<div>
                <div className="break-words font-medium">{subscription.name}</div>
                <div className="text-xs text-ink-3">課金日 <span className="whitespace-nowrap">{formatDateWithYear(date)}</span>・{formatSubscriptionSchedule(subscription)}</div>
              </div>}
            value={<div className="font-data whitespace-nowrap font-semibold">{formatCurrency(amount, subscription.currencyCode)}</div>}
            details={<div className="break-words text-xs text-ink-2">支払い元 {subscription.paymentSource ?? "未設定"}</div>}
          />)}
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
            <CardList
              rows={activeSubscriptions}
              rowKey={(subscription) => subscription.id}
              emptyMessage={
                activeSubscriptions.length === 0 && archivedSubscriptions.length > 0
                  ? "現役のサブスクはありません。"
                  : "サブスクが登録されていません。上部の「サブスクを追加」から登録してください。"
              }
              renderItem={renderSubscriptionCard}
            />
            <ArchivedSection title="終了済み" count={archivedSubscriptions.length}>
              <CardList
                rows={archivedSubscriptions}
                rowKey={(subscription) => subscription.id}
                renderItem={renderSubscriptionCard}
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
