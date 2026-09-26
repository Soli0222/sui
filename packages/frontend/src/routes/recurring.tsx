import { formatSchedule, getRecurringAmountPeriods, type Account, type RecurringItem } from "@sui/shared";
import { useSearchParams } from "react-router-dom";
import { startTransition, useMemo, useRef, useState } from "react";
import { SpendingBacklinks } from "../components/spending-backlink";
import { ArchivedSection } from "../components/ArchivedSection";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { AmountPeriodList } from "../components/ui/amount-period-list";
import { CardList, RecordCardLayout } from "../components/ui/card-list";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { RecurringCreateModal, RecurringEditorLayout, type RecurringEditorSelection } from "../components/recurring/recurring-editor";
import { getRecurringFormCurrencyCode, getRecurringItemCurrencyCode, type RecurringForm } from "../components/recurring/recurring-form";
import { useEditingNavigation } from "../components/editing/editing-navigation";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { formatCurrency, formatDateWithYear } from "../lib/format";
import { getTodayDate } from "../lib/utils";
import { Pencil, Trash2 } from "lucide-react";

export { getRecurringFormCurrencyCode, getRecurringItemCurrencyCode };
export type { RecurringForm };

function getRecurringTypeLabel(type: RecurringItem["type"]) {
  return type === "income" ? "収入" : type === "expense" ? "支出" : "振替";
}

function formatRecurringSchedule(item: RecurringItem) {
  return formatSchedule({ recurrence: item.recurrence, interval: item.interval, dayOfMonth: item.dayOfMonth,
    dayOfWeek: item.dayOfWeek, startDate: item.startDate, endDate: item.endDate });
}

function formatRecurringAccounts(item: RecurringItem) {
  const source = item.account?.name ?? "未設定";
  return item.type === "transfer" ? `${source} → ${item.transferToAccount?.name ?? "未設定"}` : source;
}

export { getRecurringAmountPeriods };

function RecurringAmountList({ item, referenceDate }: { item: RecurringItem; referenceDate: string }) {
  const periods = getRecurringAmountPeriods(item).filter((period) => !period.endDate || period.endDate >= referenceDate);
  if (!periods.length) return <span className="text-ink-3">適用中の金額なし</span>;
  return <AmountPeriodList rows={periods.map((period) => ({
    key: period.key,
    amount: formatCurrency(period.amount, getRecurringItemCurrencyCode(item)),
    start: period.startDate ? formatDateWithYear(period.startDate) : "制限なし",
    end: period.endDate ? formatDateWithYear(period.endDate) : "",
  }))} />;
}

export function isEndedRecurringItem(item: RecurringItem, referenceDate: string): boolean {
  return item.endDate !== null && item.endDate < referenceDate;
}

export function partitionRecurringItems(items: RecurringItem[], referenceDate: string) {
  return {
    active: items.filter((item) => item.enabled && !isEndedRecurringItem(item, referenceDate)),
    archived: items.filter((item) => !item.enabled || isEndedRecurringItem(item, referenceDate)),
  };
}

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div role="alert" className="rounded-xl border border-critical/30 p-4 text-sm text-critical">
    {message} <Button variant="ghost" onClick={onRetry}>再読み込み</Button>
  </div>;
}

export function RecurringPage() {
  const [search, setSearch] = useSearchParams();
  const targetId = search.get("item");
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [selection, setSelection] = useState<RecurringEditorSelection | null>(null);
  const selectionKey = useRef(0);
  const [deletingItem, setDeletingItem] = useState<RecurringItem | null>(null);
  const { toast } = useToast();
  const navigation = useEditingNavigation();
  const today = getTodayDate();
  const { data, loading, error, setData } = useResource(() => Promise.all([
    apiFetch<RecurringItem[]>("/api/recurring-items"), apiFetch<Account[]>("/api/accounts"),
  ]).then(([items, accounts]) => ({ items, accounts })), [reloadKey]);
  const reload = () => startTransition(() => setReloadKey((value) => value + 1));
  const refresh = async () => {
    const [items, accounts] = await Promise.all([
      apiFetch<RecurringItem[]>("/api/recurring-items"), apiFetch<Account[]>("/api/accounts"),
    ]);
    setData({ items, accounts });
  };
  const { active, archived } = useMemo(() => partitionRecurringItems(data?.items ?? [], today), [data?.items, today]);
  const open = (item: RecurringItem, origin: HTMLElement) => navigation.request(() => {
    selectionKey.current += 1;
    setSelection({ item, mode: "detail", key: selectionKey.current, origin });
  });
  const openCreate = () => navigation.request(() => setCreateOpen(true));
  const requestDelete = (item: RecurringItem) => navigation.request(() => setDeletingItem(item));
  const confirmDelete = async () => {
    if (!deletingItem) return;
    try {
      await apiFetch(`/api/recurring-items/${deletingItem.id}`, { method: "DELETE" });
      toast({ title: `${deletingItem.name} を削除しました` });
      setDeletingItem(null);
      setSelection((current) => current?.item.id === deletingItem.id ? null : current);
      reload();
    } catch (deleteError) {
      toast({ title: "削除に失敗しました", description: deleteError instanceof Error ? deleteError.message : "不明なエラー", variant: "error" });
    }
  };
  const actions = (item: RecurringItem) => <>
    <IconButton aria-label={`${item.name}を編集`} onClick={(event) => open(item, event.currentTarget)}><Pencil aria-hidden="true" className="h-4 w-4" /></IconButton>
    <IconButton aria-label={`${item.name}を削除`} variant="danger" onClick={() => requestDelete(item)}><Trash2 aria-hidden="true" className="h-4 w-4" /></IconButton>
  </>;
  const renderItem = (item: RecurringItem) => <RecordCardLayout
    groupDetails
    title={
      <div className="min-w-0"><div className="break-words font-medium">{item.name}</div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-3"><span className="whitespace-nowrap">{getRecurringTypeLabel(item.type)}</span><span>{formatRecurringSchedule(item)}</span></div></div>
    }
    value={<RecurringAmountList item={item} referenceDate={today} />}
    details={<div className="break-words text-xs text-ink-2">対象口座 {formatRecurringAccounts(item)}</div>}
    actions={actions(item)}
  />;

  return <>
    <RecurringEditorLayout selection={selection} accounts={data?.accounts ?? []} onClose={() => setSelection(null)} onSaved={refresh}>
      <div className="grid gap-6">
        <SpendingBacklinks kind="recurring" reloadKey={reloadKey} />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-2xl font-semibold">予定収支管理</h2><p className="mt-2 text-sm text-ink-2">定期・単発の予定収支と対象口座を管理します。</p></div>
          <Button className="min-h-10 gap-2" onClick={openCreate}><span className="text-lg leading-none">+</span>予定収支を追加</Button>
        </div>
        {targetId && <Card>
          <h3 className="font-semibold">関連する振替予定</h3>
          {loading ? <p>読み込み中…</p> : error ? <ErrorBlock message={error} onRetry={reload} /> : <CardList
            rows={(data?.items ?? []).filter((item) => item.id === targetId)} rowKey={(item) => item.id} renderItem={renderItem}
            emptyMessage="この振替予定は削除済み、または見つかりません。" />}
          <Button variant="ghost" onClick={() => setSearch({})}>関連予定の表示を閉じる</Button>
        </Card>}
        <Card>
          <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">予定収支一覧</h2>
            <div className="text-sm text-ink-2">{loading ? "読み込み中..." : `${data?.items.length ?? 0} 件`}</div></div>
          {error ? <ErrorBlock message={error} onRetry={reload} /> : <>
            <CardList rows={active} rowKey={(item) => item.id} renderItem={renderItem}
              emptyMessage={active.length === 0 && archived.length > 0 ? "現役の予定収支はありません。" : "予定収支が登録されていません。上部の「予定収支を追加」から登録してください。"} />
            <ArchivedSection title="終了済み・無効" count={archived.length}><CardList rows={archived} rowKey={(item) => item.id} renderItem={renderItem} /></ArchivedSection>
          </>}
        </Card>
      </div>
    </RecurringEditorLayout>
    {createOpen && <RecurringCreateModal open accounts={data?.accounts ?? []} onClose={() => setCreateOpen(false)} onSaved={refresh} />}
    <ConfirmDialog open={Boolean(deletingItem)} onOpenChange={(next) => { if (!next) setDeletingItem(null); }} title={`${deletingItem?.name ?? "予定収支"}を削除しますか？`}
      description="予定収支を削除すると、未確定の予測からも取り除かれます。" onConfirm={confirmDelete} />
  </>;
}
