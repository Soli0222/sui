import type { Account, DateShiftPolicy, Recurrence, RecurringItem, RecurringItemType } from "@sui/shared";
import { useEffect, useId, useRef, useState, startTransition } from "react";
import { AccountSelect, DateShiftField, DayOfMonthField, DayOfWeekField, PeriodFields } from "../components/form-fields";
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
import { formatCurrency, formatDateWithYear, formatDayOfWeek } from "../lib/format";
import { Pencil, Trash2 } from "lucide-react";

type RecurringForm = {
  name: string;
  type: RecurringItemType;
  amount: number;
  recurrence: Recurrence;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  startDate: string | null;
  endDate: string | null;
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
  dayOfMonth: 1,
  dayOfWeek: 0,
  startDate: null,
  endDate: null,
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

const recurrenceOptions = [
  { value: "monthly", label: "毎月" },
  { value: "weekly", label: "毎週" },
] as const;

function isPeriodValid(startDate: string | null, endDate: string | null) {
  return !startDate || !endDate || startDate <= endDate;
}

function formatPeriod(startDate: string | null, endDate: string | null) {
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
  if (item.recurrence === "weekly") {
    return `毎週 ${formatDayOfWeek(item.dayOfWeek)}曜日`;
  }
  return `毎月 ${item.dayOfMonth} 日`;
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
    ? form.dayOfMonth !== null && form.dayOfMonth >= 1 && form.dayOfMonth <= 31
    : form.dayOfWeek !== null && form.dayOfWeek >= 0 && form.dayOfWeek <= 6;

  const hasAccount = form.type === "transfer" ? hasTransferAccount(form) : form.accountId !== "";

  return (
    form.name.trim().length > 0 &&
    dayValid &&
    hasAccount &&
    isPeriodValid(form.startDate, form.endDate) &&
    isTransferDestinationValid(form, accounts)
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
  if (form.recurrence === "monthly" && (form.dayOfMonth === null || form.dayOfMonth < 1 || form.dayOfMonth > 31)) missing.push("毎月の発生日");
  if (form.recurrence === "weekly" && (form.dayOfWeek === null || form.dayOfWeek < 0 || form.dayOfWeek > 6)) missing.push("曜日");
  if (!isPeriodValid(form.startDate, form.endDate)) missing.push("期間");
  return missing;
}

function toRecurringPayload(form: RecurringForm) {
  return {
    name: form.name,
    type: form.type,
    amount: form.amount,
    recurrence: form.recurrence,
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

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

export function RecurringPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<RecurringItem | null>(null);
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
  const canCreate = canSaveRecurringForm(form, accounts);
  const canSaveEdit = canSaveRecurringForm(editForm, accounts);

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
      toast({ title: "固定収支の追加に失敗しました", description: describeError(createError), variant: "error" });
    }
  };

  const updateItem = async (item: RecurringItem, nextForm: RecurringForm) => {
    await apiFetch(`/api/recurring-items/${item.id}`, {
      method: "PUT",
      body: JSON.stringify(toRecurringPayload(nextForm)),
    });
    reload();
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
    setEditForm({
      name: item.name,
      type: item.type,
      amount: item.amount,
      recurrence: item.recurrence,
      dayOfMonth: item.dayOfMonth,
      dayOfWeek: item.dayOfWeek,
      startDate: item.startDate,
      endDate: item.endDate,
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
    { key: "amount", header: "金額", align: "right", mono: true, render: (item) => formatCurrency(item.amount) },
    { key: "schedule", header: "周期", render: (item) => formatRecurringSchedule(item) },
    { key: "period", header: "期間", render: (item) => formatPeriod(item.startDate, item.endDate) },
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

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">固定収支管理</h2>
          <p className="mt-2 text-sm text-ink-2">毎月発生する収入・支出と対象口座を管理します。</p>
        </div>
        <Button className="min-h-10 gap-2" onClick={() => setCreateOpen(true)}>
          <span className="text-lg leading-none">+</span>
          固定収支を追加
        </Button>
      </div>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">固定収支一覧</h2>
          <div className="text-sm text-ink-2">{loading ? "読み込み中..." : `${data?.items.length ?? 0} 件`}</div>
        </div>
        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : (
          <ResponsiveTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(item) => item.id}
            emptyMessage="固定収支が登録されていません。上部の「固定収支を追加」から登録してください。"
            mobileRow={(item) => (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{item.name}</div>
                    <div className="text-xs text-ink-3">{getRecurringTypeLabel(item.type)}・{formatRecurringSchedule(item)}</div>
                  </div>
                  <div className="font-data text-base font-semibold">{formatCurrency(item.amount)}</div>
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
            )}
          />
        )}
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : closeCreate())}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">固定収支を追加</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">固定収支の内容を登録します。</DialogDescription>
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
          <DialogTitle className="text-lg font-semibold">固定収支を編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">固定収支の内容を更新します。</DialogDescription>
          <RecurringEditModal
            accounts={accounts}
            form={editForm}
            onChange={setEditForm}
            canSave={canSaveEdit}
            onCancel={closeEdit}
            onSave={saveEdit}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deletingItem)}
        onOpenChange={(open) => !open && setDeletingItem(null)}
        title="固定収支を削除しますか？"
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
}: {
  accounts: Account[];
  form: RecurringForm;
  onChange: (next: RecurringForm) => void;
  canSave: boolean;
  onCancel: () => void;
  onSave: () => void;
  actionLabel?: string;
}) {
  const transferDestinationAccounts = getTransferDestinationAccounts(accounts, form.accountId);
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

      <FormField label="金額 (円)" htmlFor={amountId} required>
        <MoneyInput id={amountId} currencyCode="JPY" value={form.amount} onChange={(value) => onChange({ ...form, amount: value })} />
      </FormField>

      <FormField label="周期" htmlFor="recurring-recurrence">
        <SegmentedControl
          aria-label="周期"
          value={form.recurrence}
          options={recurrenceOptions}
          onChange={(recurrence) => onChange({ ...form, recurrence, dayOfMonth: recurrence === "monthly" ? 1 : null, dayOfWeek: recurrence === "weekly" ? 0 : null })}
        />
      </FormField>

      {form.recurrence === "monthly" ? (
        <DayOfMonthField id="recurring-day" value={form.dayOfMonth} onChange={(value) => onChange({ ...form, dayOfMonth: value })} />
      ) : (
        <DayOfWeekField id="recurring-day-of-week" value={form.dayOfWeek} onChange={(value) => onChange({ ...form, dayOfWeek: value })} />
      )}

      <PeriodFields
        idPrefix="recurring-period"
        startDate={form.startDate ?? ""}
        endDate={form.endDate ?? ""}
        onChangeStartDate={(value) => onChange({ ...form, startDate: parseOptionalDate(value) })}
        onChangeEndDate={(value) => onChange({ ...form, endDate: parseOptionalDate(value) })}
        error={!isPeriodValid(form.startDate, form.endDate) ? "開始日は終了日以前にしてください。" : null}
      />

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
