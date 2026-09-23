import { useSearchParams } from "react-router-dom";
import { SpendingBacklinks } from "../components/spending-backlink";
import { addCalendarDays, DEFAULT_CURRENCY_CODE, formatSchedule, isOneTimeSchedule } from "@sui/shared";
import type { Account, DateShiftPolicy, Recurrence, RecurringItem, RecurringItemAmountChange, RecurringItemType, SupportedCurrencyCode } from "@sui/shared";
import { useEffect, useId, useRef, useState, startTransition } from "react";
import { ScheduleField } from "../components/ScheduleField";
import { ArchivedSection } from "../components/ArchivedSection";
import { AccountSelect, DateShiftField, PeriodFields } from "../components/form-fields";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { Disclosure } from "../components/ui/disclosure";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { MoneyInput } from "../components/ui/money-input";
import { ResponsiveTable, type ResponsiveTableColumn } from "../components/ui/responsive-table";
import { SegmentedControl } from "../components/ui/segmented-control";
import { SwitchField } from "../components/ui/switch";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { formatCurrency, formatDateWithYear } from "../lib/format";
import { getTodayDate } from "../lib/utils";
import { Pencil, Trash2 } from "lucide-react";

export type RecurringForm = {
  name: string;
  type: RecurringItemType;
  amount: number;
  recurrence: Recurrence;
  interval: number;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  startDate: string | null;
  endDate: string | null;
  oneTime?: boolean;
  dateShiftPolicy: DateShiftPolicy;
  accountId: string;
  transferToAccountId: string;
  enabled: boolean;
  sortOrder: number;
};

const emptyForm: RecurringForm = {
  name: "",
  type: "expense" as const,
  amount: 0,
  recurrence: "monthly",
  interval: 1,
  dayOfMonth: 1,
  dayOfWeek: 0,
  startDate: null,
  endDate: null,
  oneTime: false,
  dateShiftPolicy: "none",
  accountId: "",
  transferToAccountId: "",
  enabled: true,
  sortOrder: 0,
};

const typeOptions = [
  { value: "income", label: "収入" },
  { value: "expense", label: "支出" },
  { value: "transfer", label: "振替" },
] as const;

function isPeriodValid(startDate: string | null, endDate: string | null) {
  return !startDate || !endDate || startDate <= endDate;
}

function formatPeriod(item: RecurringItem) {
  const { startDate, endDate } = item;

  if (isOneTimeSchedule(item)) {
    return startDate ? formatDateWithYear(startDate) : "単発";
  }

  if (!startDate && !endDate) {
    return "無期限";
  }

  if (startDate && endDate) {
    return `${formatDateWithYear(startDate)} 〜 ${formatDateWithYear(endDate)}`;
  }

  if (startDate) {
    return `${formatDateWithYear(startDate)} 〜`;
  }

  return `〜 ${formatDateWithYear(endDate!)}`;
}

function parseOptionalDate(value: string) {
  return value === "" ? null : value;
}

function getRecurringTypeLabel(type: RecurringItemType) {
  if (type === "income") {
    return "収入";
  }

  if (type === "expense") {
    return "支出";
  }

  return "振替";
}

function getAccountLabel(type: RecurringItemType) {
  if (type === "income") {
    return "振り込み先口座";
  }

  if (type === "transfer") {
    return "送金元口座";
  }

  return "引き落とし口座";
}

function formatRecurringSchedule(item: RecurringItem) {
  return formatSchedule({
    recurrence: item.recurrence,
    interval: item.interval,
    dayOfMonth: item.dayOfMonth,
    dayOfWeek: item.dayOfWeek,
    startDate: item.startDate,
    endDate: item.endDate,
  });
}

function isOneTimeForm(form: RecurringForm) {
  if (form.oneTime) {
    return true;
  }
  return isOneTimeSchedule({
    recurrence: form.recurrence,
    interval: form.interval,
    dayOfMonth: form.dayOfMonth,
    dayOfWeek: form.dayOfWeek,
    startDate: form.startDate,
    endDate: form.endDate,
  });
}

function getTransferDestinationAccounts(accounts: Account[], sourceAccountId: string) {
  const sourceAccount = accounts.find((account) => account.id === sourceAccountId);
  if (!sourceAccount) {
    return accounts;
  }

  return accounts.filter(
    (account) => account.id !== sourceAccount.id && account.currencyCode === sourceAccount.currencyCode,
  );
}

function isTransferDestinationValid(form: RecurringForm, accounts: Account[]) {
  if (form.type !== "transfer") {
    return true;
  }

  if (form.transferToAccountId === "") {
    return true;
  }

  return getTransferDestinationAccounts(accounts, form.accountId).some(
    (account) => account.id === form.transferToAccountId,
  );
}

function normalizeTransferToAccountId(form: RecurringForm, accounts: Account[]) {
  if (form.type !== "transfer") {
    return "";
  }

  return isTransferDestinationValid(form, accounts) ? form.transferToAccountId : "";
}

function hasTransferAccount(form: RecurringForm) {
  return form.accountId !== "" || form.transferToAccountId !== "";
}

function canSaveRecurringForm(form: RecurringForm, accounts: Account[]) {
  const dayValid = form.recurrence === "monthly"
    ? form.dayOfMonth !== null && form.dayOfMonth >= 1 && form.dayOfMonth <= 31 && form.interval >= 1
    : form.dayOfWeek !== null && form.dayOfWeek >= 0 && form.dayOfWeek <= 6 && form.interval >= 1;

  const hasAccount = form.type === "transfer" ? hasTransferAccount(form) : form.accountId !== "";

  return (
    form.name.trim().length > 0 &&
    dayValid &&
    hasAccount &&
    isPeriodValid(form.startDate, form.endDate) &&
    isTransferDestinationValid(form, accounts) &&
    !(form.interval > 1 && form.startDate === null)
  );
}

function getMissingFields(form: RecurringForm, accounts: Account[]) {
  const missing: string[] = [];
  if (form.name.trim().length === 0) missing.push("カテゴリ名");
  if (form.type === "transfer") {
    if (!hasTransferAccount(form)) missing.push("口座");
  } else if (form.accountId === "") {
    missing.push("口座");
  }
  if (form.type === "transfer" && !isTransferDestinationValid(form, accounts)) missing.push("振替先口座");
  if (form.oneTime) {
    if (!form.startDate) missing.push("予定日");
  } else if (form.recurrence === "monthly" && (form.dayOfMonth === null || form.dayOfMonth < 1 || form.dayOfMonth > 31)) {
    missing.push("毎月の発生日");
  } else if (form.recurrence === "weekly" && (form.dayOfWeek === null || form.dayOfWeek < 0 || form.dayOfWeek > 6)) {
    missing.push("曜日");
  }
  if (form.interval > 1 && form.startDate === null) missing.push("開始日");
  if (!isPeriodValid(form.startDate, form.endDate)) missing.push("期間");
  return missing;
}

function toRecurringPayload(form: RecurringForm) {
  return {
    name: form.name,
    type: form.type,
    amount: form.amount,
    recurrence: form.recurrence,
    interval: form.interval,
    dayOfMonth: form.recurrence === "monthly" ? form.dayOfMonth : null,
    dayOfWeek: form.recurrence === "weekly" ? form.dayOfWeek : null,
    startDate: form.startDate,
    endDate: form.endDate,
    dateShiftPolicy: form.dateShiftPolicy,
    accountId: form.accountId || null,
    transferToAccountId: form.type === "transfer" ? form.transferToAccountId || null : null,
    enabled: form.enabled,
    sortOrder: form.sortOrder,
  };
}

function formatRecurringAccounts(item: RecurringItem) {
  const sourceName = item.account?.name ?? "未設定";
  if (item.type !== "transfer") {
    return sourceName;
  }

  return `${sourceName} → ${item.transferToAccount?.name ?? "未設定"}`;
}

export function getRecurringItemCurrencyCode(item: RecurringItem): SupportedCurrencyCode {
  if (item.type === "transfer") {
    return item.account?.currencyCode ?? item.transferToAccount?.currencyCode ?? DEFAULT_CURRENCY_CODE;
  }

  return item.account?.currencyCode ?? DEFAULT_CURRENCY_CODE;
}

export function getRecurringFormCurrencyCode(
  form: Pick<RecurringForm, "type" | "accountId" | "transferToAccountId">,
  accounts: Account[],
): SupportedCurrencyCode {
  if (form.type === "transfer") {
    const sourceAccount = accounts.find((account) => account.id === form.accountId);
    if (sourceAccount) {
      return sourceAccount.currencyCode;
    }

    const destinationAccount = accounts.find((account) => account.id === form.transferToAccountId);
    return destinationAccount?.currencyCode ?? DEFAULT_CURRENCY_CODE;
  }

  const account = accounts.find((account) => account.id === form.accountId);
  return account?.currencyCode ?? DEFAULT_CURRENCY_CODE;
}

const today = getTodayDate();

export function getRecurringAmountPeriods(item: RecurringItem) {
  const changes = [...(item.amountChanges ?? [])].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const prices = [{ key: "initial", startDate: item.startDate, amount: item.amount },
    ...changes.map((change) => ({ key: change.id, startDate: change.effectiveFrom, amount: change.amount }))];
  return prices.map((price, index) => {
    const nextStart = prices[index + 1]?.startDate;
    const priceEnd = nextStart ? addCalendarDays(nextStart, -1) : null;
    const endDate = item.endDate && priceEnd ? (item.endDate < priceEnd ? item.endDate : priceEnd) : item.endDate ?? priceEnd;
    return { ...price, endDate };
  }).filter((period) => !period.startDate || !period.endDate || period.startDate <= period.endDate);
}

function formatAmountPeriod(startDate: string | null, endDate: string | null) {
  return `${startDate ? formatDateWithYear(startDate) : "制限なし"} 〜 ${endDate ? formatDateWithYear(endDate) : ""}`;
}

function RecurringAmountList({ item, referenceDate }: { item: RecurringItem; referenceDate: string }) {
  const periods = getRecurringAmountPeriods(item).filter((period) => !period.endDate || period.endDate >= referenceDate);
  if (!periods.length) return <span className="text-ink-3">適用中の金額なし</span>;
  return <div className="grid gap-1">{periods.map((period) => <div key={period.key}>
    <span className="font-data">{formatCurrency(period.amount, getRecurringItemCurrencyCode(item))}</span>{" "}
    <span className="text-xs text-ink-3">{formatAmountPeriod(period.startDate, period.endDate)}</span>
  </div>)}</div>;
}

export function isEndedRecurringItem(item: RecurringItem, referenceDate: string): boolean {
  return item.endDate !== null && item.endDate < referenceDate;
}

export function partitionRecurringItems(
  items: RecurringItem[],
  referenceDate: string,
): { active: RecurringItem[]; archived: RecurringItem[] } {
  const active: RecurringItem[] = [];
  const archived: RecurringItem[] = [];

  for (const item of items) {
    if (isEndedRecurringItem(item, referenceDate)) {
      archived.push(item);
    } else {
      active.push(item);
    }
  }

  return { active, archived };
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

export function RecurringPage() {
  const [search, setSearch] = useSearchParams();
  const targetId = search.get("item");
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<RecurringItem | null>(null);
  const [editSection, setEditSection] = useState<"prices" | "details">("prices");
  const [addingChange, setAddingChange] = useState(false);
  const [editingChange, setEditingChange] = useState<RecurringItemAmountChange | null>(null);
  const [deletingChange, setDeletingChange] = useState<RecurringItemAmountChange | null>(null);
  const [changeDate, setChangeDate] = useState("");
  const [changeAmount, setChangeAmount] = useState(0);
  const [correctingInitial, setCorrectingInitial] = useState(false);
  const [initialDraft, setInitialDraft] = useState(0);
  const editingPeriods = editingItem ? getRecurringAmountPeriods(editingItem) : [];
  const editingPeriodLabels = new Map(editingPeriods.map((period) => [period.key, formatAmountPeriod(period.startDate, period.endDate)]));
  const [editForm, setEditForm] = useState<RecurringForm>(emptyForm);
  const [deletingItem, setDeletingItem] = useState<RecurringItem | null>(null);
  const { data, loading, error } = useResource(
    () =>
      Promise.all([
        apiFetch<RecurringItem[]>("/api/recurring-items"),
        apiFetch<Account[]>("/api/accounts"),
      ]).then(([items, accounts]) => ({ items, accounts })),
    [reloadKey],
  );
  const { toast } = useToast();

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));
  const accounts = data?.accounts ?? [];
  const { active: activeItems, archived: archivedItems } = partitionRecurringItems(
    data?.items ?? [],
    today,
  );
  const canCreate = canSaveRecurringForm(form, accounts);
  const earliestChangeDate = editingItem?.amountChanges?.reduce<string | null>((earliest, change) => !earliest || change.effectiveFrom < earliest ? change.effectiveFrom : earliest, null) ?? null;
  const editStartDateError = editForm.startDate && earliestChangeDate && editForm.startDate >= earliestChangeDate ? "開始日は最初の金額変更日より前にしてください。" : null;
  const canSaveEdit = canSaveRecurringForm(editForm, accounts) && !editStartDateError;
  const changeDateError = editingItem?.startDate && changeDate && changeDate <= editingItem.startDate ? "適用開始日は予定開始日の翌日以降にしてください。" : null;

  const createItem = async () => {
    try {
      await apiFetch("/api/recurring-items", {
        method: "POST",
        body: JSON.stringify(toRecurringPayload(form)),
      });
      const name = form.name;
      setForm({ ...emptyForm, accountId: accounts[0]?.id ?? "" });
      setCreateOpen(false);
      reload();
      toast({ title: `${name} を追加しました` });
    } catch (createError) {
      toast({ title: "予定収支の追加に失敗しました", description: describeError(createError), variant: "error" });
    }
  };

  const updateItem = async (item: RecurringItem, nextForm: RecurringForm) => {
    const updated = await apiFetch<RecurringItem>(`/api/recurring-items/${item.id}`, {
      method: "PUT",
      body: JSON.stringify(toRecurringPayload(nextForm)),
    });
    reload();
    return updated;
  };

  const requestDelete = (item: RecurringItem) => setDeletingItem(item);

  const confirmDelete = async () => {
    if (!deletingItem) {
      return;
    }

    try {
      await apiFetch(`/api/recurring-items/${deletingItem.id}`, { method: "DELETE" });
      toast({ title: `${deletingItem.name} を削除しました` });
      setDeletingItem(null);
      reload();
    } catch (deleteError) {
      toast({ title: "削除に失敗しました", description: describeError(deleteError), variant: "error" });
    }
  };

  const openEdit = (item: RecurringItem) => {
    setEditingItem(item);
    setEditSection("prices");
    setInitialDraft(item.amount);
    setAddingChange(false);
    setEditingChange(null);
    setCorrectingInitial(false);
    setEditForm({
      name: item.name,
      type: item.type,
      amount: item.amount,
      recurrence: item.recurrence,
      interval: item.interval,
      dayOfMonth: item.dayOfMonth,
      dayOfWeek: item.dayOfWeek,
      startDate: item.startDate,
      endDate: item.endDate,
      oneTime: isOneTimeSchedule(item),
      dateShiftPolicy: item.dateShiftPolicy,
      accountId: item.accountId ?? "",
      transferToAccountId: item.transferToAccountId ?? "",
      enabled: item.enabled,
      sortOrder: item.sortOrder,
    });
  };

  const closeEdit = () => {
    setEditingItem(null);
    setEditForm(emptyForm);
    setAddingChange(false);
    setEditingChange(null);
    setCorrectingInitial(false);
  };

  const saveInitialCorrection = async () => {
    if (!editingItem) return;
    try {
      const updated = await updateItem(editingItem, { ...editForm, amount: initialDraft });
      setEditingItem(updated);
      setEditForm((current) => ({ ...current, amount: initialDraft }));
      setCorrectingInitial(false);
      toast({ title: "初期金額を訂正しました" });
    } catch (error) { toast({ title: "訂正に失敗しました", description: describeError(error), variant: "error" }); }
  };

  const saveAmountChange = async () => {
    if (!editingItem) return;
    try {
      await apiFetch(`/api/recurring-items/${editingItem.id}/amount-changes${editingChange ? `/${editingChange.id}` : ""}`, { method: editingChange ? "PUT" : "POST", body: JSON.stringify({ effectiveFrom: changeDate, amount: changeAmount }) });
      const items = await apiFetch<RecurringItem[]>("/api/recurring-items");
      setEditingItem(items.find((item) => item.id === editingItem.id) ?? null);
      setEditingChange(null);
      setAddingChange(false);
      reload();
      toast({ title: "金額履歴を保存しました" });
    } catch (error) { toast({ title: "保存に失敗しました", description: describeError(error), variant: "error" }); }
  };

  const deleteAmountChange = async () => {
    if (!editingItem || !deletingChange) return;
    try {
      await apiFetch(`/api/recurring-items/${editingItem.id}/amount-changes/${deletingChange.id}`, { method: "DELETE" });
      const items = await apiFetch<RecurringItem[]>("/api/recurring-items");
      setEditingItem(items.find((item) => item.id === editingItem.id) ?? null);
      setDeletingChange(null);
      reload();
      toast({ title: "金額履歴を削除しました" });
    } catch (error) { toast({ title: "削除に失敗しました", description: describeError(error), variant: "error" }); }
  };

  const saveEdit = async () => {
    if (!editingItem) {
      return;
    }

    try {
      await updateItem(editingItem, editForm);
      closeEdit();
      toast({ title: `${editForm.name} を更新しました` });
    } catch (updateError) {
      toast({ title: "更新に失敗しました", description: describeError(updateError), variant: "error" });
    }
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setForm({ ...emptyForm, accountId: accounts[0]?.id ?? "" });
  };

  const columns: ResponsiveTableColumn<RecurringItem>[] = [
    { key: "name", header: "カテゴリ", render: (item) => item.name },
    { key: "type", header: "種別", render: (item) => getRecurringTypeLabel(item.type) },
    { key: "amount", header: "金額と適用期間", align: "right", render: (item) => <RecurringAmountList item={item} referenceDate={today} /> },
    { key: "schedule", header: "周期", render: (item) => formatRecurringSchedule(item) },
    { key: "period", header: "期間", render: (item) => formatPeriod(item) },
    { key: "account", header: "対象口座", render: (item) => formatRecurringAccounts(item) },
    { key: "sortOrder", header: "順序", mono: true, render: (item) => item.sortOrder },
    { key: "enabled", header: "有効", render: (item) => (item.enabled ? "有効" : "無効") },
    {
      key: "actions",
      header: "",
      render: (item) => (
        <div className="flex justify-end gap-1">
          <IconButton aria-label="編集" onClick={() => openEdit(item)}>
            <Pencil aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <IconButton aria-label="削除" variant="danger" onClick={() => requestDelete(item)}>
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </div>
      ),
    },
  ];

  const renderRecurringMobileRow = (item: RecurringItem) => (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{item.name}</div>
          <div className="text-xs text-ink-3">{getRecurringTypeLabel(item.type)}・{formatRecurringSchedule(item)}</div>
        </div>
        <RecurringAmountList item={item} referenceDate={today} />
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-ink-3">
        <span>{formatRecurringAccounts(item)}・{item.enabled ? "有効" : "無効"}</span>
        <div className="flex gap-1">
          <IconButton aria-label="編集" onClick={() => openEdit(item)}>
            <Pencil aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <IconButton aria-label="削除" variant="danger" onClick={() => requestDelete(item)}>
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </>
  );

  return (
    <div className="grid gap-6">
      <SpendingBacklinks kind="recurring" reloadKey={reloadKey} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">予定収支管理</h2>
          <p className="mt-2 text-sm text-ink-2">定期・単発の予定収支と対象口座を管理します。</p>
        </div>
        <Button className="min-h-10 gap-2" onClick={() => setCreateOpen(true)}>
          <span className="text-lg leading-none">+</span>
          予定収支を追加
        </Button>
      </div>

      {targetId && (
        <Card>
          <h3 className="font-semibold">関連する振替予定</h3>
          {loading ? <p>読み込み中…</p> : error ? <ErrorBlock message={error} onRetry={reload} /> : (
            <ResponsiveTable columns={columns} rows={(data?.items ?? []).filter(item => item.id === targetId)}
              rowKey={item => item.id} mobileRow={renderRecurringMobileRow}
              emptyMessage="この振替予定は削除済み、または見つかりません。" />
          )}
          <Button variant="ghost" onClick={() => setSearch({})}>関連予定の表示を閉じる</Button>
        </Card>
      )}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">予定収支一覧</h2>
          <div className="text-sm text-ink-2">{loading ? "読み込み中..." : `${data?.items.length ?? 0} 件`}</div>
        </div>
        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : (
          <>
            <ResponsiveTable
              columns={columns}
              rows={activeItems}
              rowKey={(item) => item.id}
              emptyMessage={
                activeItems.length === 0 && archivedItems.length > 0
                  ? "現役の予定収支はありません。"
                  : "予定収支が登録されていません。上部の「予定収支を追加」から登録してください。"
              }
              mobileRow={renderRecurringMobileRow}
            />
            <ArchivedSection title="終了済み" count={archivedItems.length}>
              <ResponsiveTable
                columns={columns}
                rows={archivedItems}
                rowKey={(item) => item.id}
                mobileRow={renderRecurringMobileRow}
              />
            </ArchivedSection>
          </>
        )}
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : closeCreate())}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">予定収支を追加</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">予定収支の内容を登録します。</DialogDescription>
          <RecurringEditModal
            accounts={accounts}
            form={form}
            onChange={setForm}
            canSave={canCreate}
            actionLabel="追加"
            onCancel={closeCreate}
            onSave={createItem}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingItem)} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">予定収支を編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">予定収支の内容を更新します。</DialogDescription>
          <div className="mt-5 flex gap-2 border-b border-line pb-3" aria-label="編集項目">
            <Button type="button" variant={editSection === "prices" ? "secondary" : "ghost"} onClick={() => setEditSection("prices")}>金額と適用期間</Button>
            <Button type="button" variant={editSection === "details" ? "secondary" : "ghost"} onClick={() => setEditSection("details")}>基本情報</Button>
          </div>
          {editSection === "details" ? <RecurringEditModal
            accounts={accounts}
            form={editForm}
            onChange={setEditForm}
            canSave={canSaveEdit}
            onCancel={closeEdit}
            onSave={saveEdit}
            showAmount={false}
            startDateError={editStartDateError}
          /> : editingItem ? <section className="mt-4 grid gap-3" aria-label="金額と適用期間">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-ink-2">金額は営業日シフト前の発生日に適用されます。</p>
              {!isOneTimeSchedule(editingItem) ? <Button type="button" variant="secondary" onClick={() => { setAddingChange(true); setEditingChange(null); setChangeDate(""); setChangeAmount(editingItem.effectiveAmount ?? editingItem.amount); }}>期間を追加</Button> : null}
            </div>
            <div className="rounded-xl border border-line p-3">
              <div className="flex items-center justify-between gap-3">
                <div><div className="text-xs text-ink-3">初期金額</div><div className="font-data font-medium">{formatCurrency(editingItem.amount, getRecurringItemCurrencyCode(editingItem))}</div><div className="text-xs text-ink-3">{editingPeriodLabels.get("initial") ?? "適用期間なし"}</div></div>
                <Button type="button" variant="ghost" onClick={() => { setCorrectingInitial(!correctingInitial); setInitialDraft(editingItem.amount); }}>訂正</Button>
              </div>
              {correctingInitial ? <div className="mt-3 grid gap-3 border-t border-line pt-3">
                <FormField label="初期金額（訂正）" htmlFor="recurring-initial-correction"><MoneyInput id="recurring-initial-correction" currencyCode={getRecurringItemCurrencyCode(editingItem)} value={initialDraft} onChange={setInitialDraft} /></FormField>
                <p className="text-xs text-ink-3">初期金額の訂正は過去の未確定予測も変える可能性があります。</p>
                <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setCorrectingInitial(false)}>キャンセル</Button><Button type="button" disabled={initialDraft < 0 || initialDraft > 2147483647} onClick={saveInitialCorrection}>訂正を保存</Button></div>
              </div> : null}
            </div>
            {[...(editingItem.amountChanges ?? [])].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).map((change) => <div key={change.id} className="rounded-xl border border-line p-3">
              <div className="flex items-center justify-between gap-3">
                <div><div className="font-data font-medium">{formatCurrency(change.amount, getRecurringItemCurrencyCode(editingItem))}</div><div className="text-xs text-ink-3">{editingPeriodLabels.get(change.id) ?? `${change.effectiveFrom} から`}</div>{editingItem.startDate && change.effectiveFrom <= editingItem.startDate ? <div className="text-xs text-critical">開始日以前の履歴です。訂正または削除してください。</div> : null}</div>
                <div className="flex gap-1"><IconButton aria-label={`${change.effectiveFrom} の履歴を訂正`} onClick={() => { setAddingChange(false); setEditingChange(change); setChangeDate(change.effectiveFrom); setChangeAmount(change.amount); }}><Pencil aria-hidden="true" className="h-4 w-4" /></IconButton><IconButton aria-label={`${change.effectiveFrom} の履歴を削除`} variant="danger" onClick={() => setDeletingChange(change)}><Trash2 aria-hidden="true" className="h-4 w-4" /></IconButton></div>
              </div>
              {editingChange?.id === change.id ? <div className="mt-3 grid gap-3 border-t border-line pt-3">
                <div className="grid gap-3 sm:grid-cols-2"><FormField label="適用開始日" htmlFor="recurring-change-date" error={changeDateError}><Input id="recurring-change-date" type="date" min={editingItem.startDate ? addCalendarDays(editingItem.startDate, 1) : undefined} value={changeDate} onChange={(event) => setChangeDate(event.target.value)} /></FormField><FormField label="金額" htmlFor="recurring-change-amount"><MoneyInput id="recurring-change-amount" currencyCode={getRecurringItemCurrencyCode(editingItem)} value={changeAmount} onChange={setChangeAmount} /></FormField></div>
                <p className="text-xs text-ink-3">履歴の訂正は過去の未確定予測も変える可能性があります。</p>
                <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setEditingChange(null)}>キャンセル</Button><Button type="button" disabled={!changeDate || changeAmount < 0 || changeAmount > 2147483647 || Boolean(changeDateError)} onClick={saveAmountChange}>訂正を保存</Button></div>
              </div> : null}
            </div>)}
            {addingChange ? <div className="rounded-xl border border-line p-3">
              <div className="font-medium">新しい金額</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2"><FormField label="適用開始日" htmlFor="recurring-new-change-date" error={changeDateError}><Input id="recurring-new-change-date" type="date" min={editingItem.startDate ? addCalendarDays(editingItem.startDate, 1) : undefined} value={changeDate} onChange={(event) => setChangeDate(event.target.value)} /></FormField><FormField label="金額" htmlFor="recurring-new-change-amount"><MoneyInput id="recurring-new-change-amount" currencyCode={getRecurringItemCurrencyCode(editingItem)} value={changeAmount} onChange={setChangeAmount} /></FormField></div>
              <div className="mt-3 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setAddingChange(false)}>キャンセル</Button><Button type="button" disabled={!changeDate || changeAmount < 0 || changeAmount > 2147483647 || Boolean(changeDateError)} onClick={saveAmountChange}>追加を保存</Button></div>
            </div> : null}
            <div className="flex justify-end border-t border-line pt-3"><Button type="button" variant="ghost" onClick={closeEdit}>閉じる</Button></div>
          </section> : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={Boolean(deletingChange)} onOpenChange={(open) => !open && setDeletingChange(null)} title="金額履歴を削除しますか？" description={deletingChange ? `${deletingChange.effectiveFrom} からの金額を削除します。過去の未確定予測も変える可能性があります。` : undefined} onConfirm={deleteAmountChange} />

      <ConfirmDialog
        open={Boolean(deletingItem)}
        onOpenChange={(open) => !open && setDeletingItem(null)}
        title="予定収支を削除しますか？"
        description={deletingItem ? `「${deletingItem.name}」を削除します。この操作は取り消せません。` : undefined}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function RecurringEditModal({
  accounts,
  form,
  onChange,
  canSave,
  onCancel,
  onSave,
  actionLabel = "保存",
  showAmount = true,
  startDateError = null,
}: {
  accounts: Account[];
  form: RecurringForm;
  onChange: (next: RecurringForm) => void;
  canSave: boolean;
  onCancel: () => void;
  onSave: () => void;
  actionLabel?: string;
  showAmount?: boolean;
  startDateError?: string | null;
}) {
  const transferDestinationAccounts = getTransferDestinationAccounts(accounts, form.accountId);
  const currencyCode = getRecurringFormCurrencyCode(form, accounts);
  const nameId = useId();
  const amountId = useId();
  const dateShiftId = useId();
  const sortOrderId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const missing = getMissingFields(form, accounts);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

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
      <FormField label="カテゴリ名" htmlFor={nameId} required>
        <Input id={nameId} ref={firstFieldRef} required value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} />
      </FormField>

      <FormField label="種別" htmlFor="recurring-type">
        <SegmentedControl
          aria-label="種別"
          value={form.type}
          options={typeOptions}
          onChange={(type) => {
            const nextForm = { ...form, type };
            onChange({ ...nextForm, transferToAccountId: normalizeTransferToAccountId(nextForm, accounts) });
          }}
        />
      </FormField>

      {showAmount ? <FormField label={`金額 (${currencyCode})`} htmlFor={amountId} required>
        <MoneyInput id={amountId} currencyCode={currencyCode} value={form.amount} onChange={(value) => onChange({ ...form, amount: value })} />
      </FormField> : null}

      <ScheduleField
        id="recurring-schedule"
        value={form}
        allowOneTime
        onChange={(next) => onChange({ ...form, ...next })}
      />

      {!isOneTimeForm(form) ? (
        <PeriodFields
          idPrefix="recurring-period"
          startDate={form.startDate ?? ""}
          endDate={form.endDate ?? ""}
          startRequired={form.interval > 1}
          onChangeStartDate={(value) => {
            const startDate = parseOptionalDate(value);
            let next: RecurringForm = { ...form, startDate };
            if (next.recurrence === "monthly" && next.interval === 12 && startDate) {
              next = { ...next, dayOfMonth: Number(startDate.slice(8, 10)) };
            }
            onChange(next);
          }}
          onChangeEndDate={(value) => onChange({ ...form, endDate: parseOptionalDate(value) })}
          error={startDateError ?? (!isPeriodValid(form.startDate, form.endDate) ? "開始日は終了日以前にしてください。" : null)}
        />
      ) : null}

      <AccountSelect
        id="recurring-account"
        label={getAccountLabel(form.type)}
        accounts={accounts}
        value={form.accountId}
        required={form.type !== "transfer"}
        placeholder={form.type === "transfer" ? "送金元口座なし" : "対象口座を選択"}
        onChange={(accountId) => {
          const nextForm = { ...form, accountId };
          onChange({ ...nextForm, transferToAccountId: normalizeTransferToAccountId(nextForm, accounts) });
        }}
      />

      {form.type === "transfer" ? (
        <AccountSelect
          id="recurring-transfer-account"
          label="振替先口座"
          accounts={transferDestinationAccounts}
          value={form.transferToAccountId}
          required={false}
          placeholder="振替先口座なし"
          onChange={(accountId) => onChange({ ...form, transferToAccountId: accountId })}
        />
      ) : null}

      <DateShiftField id={dateShiftId} value={form.dateShiftPolicy} onChange={(dateShiftPolicy) => onChange({ ...form, dateShiftPolicy })} />

      <Disclosure summary="詳細設定">
        <FormField label="表示順" htmlFor={sortOrderId}>
          <Input id={sortOrderId} type="number" inputMode="numeric" value={form.sortOrder} onChange={(event) => onChange({ ...form, sortOrder: Number(event.target.value) })} />
        </FormField>
        <SwitchField label="有効" checked={form.enabled} onChange={(enabled) => onChange({ ...form, enabled })} />
      </Disclosure>

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
