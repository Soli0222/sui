import type { Account, DateShiftPolicy, RecurringItem } from "@sui/shared";
import { useState, startTransition } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Table, TableWrapper } from "../components/ui/table";
import { useResource } from "../hooks/use-resource";
import { apiFetch } from "../lib/api";
import { formatCurrency, formatDateWithYear } from "../lib/format";

type RecurringForm = {
  name: string;
  type: "income" | "expense";
  amount: number;
  dayOfMonth: number;
  startDate: string | null;
  endDate: string | null;
  dateShiftPolicy: DateShiftPolicy;
  accountId: string;
  enabled: boolean;
  sortOrder: number;
};

const emptyForm: RecurringForm = {
  name: "",
  type: "expense" as const,
  amount: 0,
  dayOfMonth: 1,
  startDate: null,
  endDate: null,
  dateShiftPolicy: "none",
  accountId: "",
  enabled: true,
  sortOrder: 0,
};

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

export function RecurringPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<RecurringItem | null>(null);
  const [editForm, setEditForm] = useState<RecurringForm>(emptyForm);
  const { data, loading, error } = useResource(
    () =>
      Promise.all([
        apiFetch<RecurringItem[]>("/api/recurring-items"),
        apiFetch<Account[]>("/api/accounts"),
      ]).then(([items, accounts]) => ({ items, accounts })),
    [reloadKey],
  );

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));
  const accounts = data?.accounts ?? [];
  const canCreate =
    form.name.trim().length > 0 &&
    form.dayOfMonth >= 1 &&
    form.dayOfMonth <= 31 &&
    form.accountId !== "" &&
    isPeriodValid(form.startDate, form.endDate);
  const canSaveEdit =
    editForm.name.trim().length > 0 &&
    editForm.dayOfMonth >= 1 &&
    editForm.dayOfMonth <= 31 &&
    editForm.accountId !== "" &&
    isPeriodValid(editForm.startDate, editForm.endDate);

  const createItem = async () => {
    await apiFetch("/api/recurring-items", {
      method: "POST",
      body: JSON.stringify(form),
    });
    setForm({ ...emptyForm, accountId: accounts[0]?.id ?? "" });
    setCreateOpen(false);
    reload();
  };

  const updateItem = async (item: RecurringItem) => {
    await apiFetch(`/api/recurring-items/${item.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: item.name,
        type: item.type,
        amount: item.amount,
        dayOfMonth: item.dayOfMonth,
        startDate: item.startDate,
        endDate: item.endDate,
        dateShiftPolicy: item.dateShiftPolicy,
        accountId: item.accountId ?? "",
        enabled: item.enabled,
        sortOrder: item.sortOrder,
      }),
    });
    reload();
  };

  const deleteItem = async (id: string) => {
    if (!window.confirm("この固定収支を削除します。よろしいですか？")) {
      return;
    }
    await apiFetch(`/api/recurring-items/${id}`, { method: "DELETE" });
    reload();
  };

  const openEdit = (item: RecurringItem) => {
    setEditingItem(item);
    setEditForm({
      name: item.name,
      type: item.type,
      amount: item.amount,
      dayOfMonth: item.dayOfMonth,
      startDate: item.startDate,
      endDate: item.endDate,
      dateShiftPolicy: item.dateShiftPolicy,
      accountId: item.accountId ?? "",
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

    await updateItem({
      ...editingItem,
      ...editForm,
      accountId: editForm.accountId,
      account: accounts.find((account) => account.id === editForm.accountId) ?? null,
    });
    closeEdit();
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setForm({ ...emptyForm, accountId: accounts[0]?.id ?? "" });
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">固定収支管理</h2>
          <p className="mt-2 text-sm text-white/60">毎月発生する収入・支出と対象口座を管理します。</p>
        </div>
        <Button className="min-h-10 gap-2" onClick={() => setCreateOpen(true)}>
          <span className="text-lg leading-none">+</span>
          固定収支を追加
        </Button>
      </div>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">固定収支一覧</h2>
          <div className="text-sm text-white/60">{loading ? "読み込み中..." : error ?? `${data?.items.length ?? 0} 件`}</div>
        </div>
        <TableWrapper>
          <Table className="min-w-[64rem]">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.18em] text-white/45">
                <th className="px-3 py-3">カテゴリ</th>
                <th className="px-3 py-3">種別</th>
                <th className="px-3 py-3">金額</th>
                <th className="px-3 py-3">日</th>
                <th className="px-3 py-3">期間</th>
                <th className="px-3 py-3">対象口座</th>
                <th className="px-3 py-3">順序</th>
                <th className="px-3 py-3">有効</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((item) => (
                <RecurringRow
                  key={item.id}
                  item={item}
                  onEdit={openEdit}
                  onDelete={deleteItem}
                />
              ))}
            </tbody>
          </Table>
        </TableWrapper>
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : closeCreate())}>
        <DialogContent className="w-[min(92vw,36rem)]">
          <DialogTitle className="text-lg font-semibold">固定収支を追加</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-white/60">
            固定収支の内容を登録します。
          </DialogDescription>
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
        <DialogContent className="w-[min(92vw,36rem)]">
          <DialogTitle className="text-lg font-semibold">固定収支を編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-white/60">
            固定収支の内容を更新します。
          </DialogDescription>
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
  return (
    <div className="mt-6 grid gap-5">
      <section className="grid gap-4">
        <div className="text-xs uppercase tracking-[0.18em] text-white/45">基本情報</div>
        <label className="grid gap-2 text-sm">
          <span>カテゴリ名 *</span>
          <Input required value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} />
        </label>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="grid gap-2 text-sm">
            <span>種別</span>
            <Select value={form.type} onChange={(event) => onChange({ ...form, type: event.target.value as "income" | "expense" })}>
              <option value="income">収入</option>
              <option value="expense">支出</option>
            </Select>
          </label>
          <label className="grid gap-2 text-sm">
            <span>金額 (円)</span>
            <Input type="number" value={form.amount} onChange={(event) => onChange({ ...form, amount: Number(event.target.value) })} />
          </label>
          <label className="grid gap-2 text-sm">
            <span>毎月の発生日</span>
            <Input type="number" min={1} max={31} value={form.dayOfMonth} onChange={(event) => onChange({ ...form, dayOfMonth: Number(event.target.value) })} />
          </label>
        </div>
      </section>

      <section className="grid gap-3 border-t border-white/10 pt-4">
        <div className="text-xs uppercase tracking-[0.18em] text-white/45">期間</div>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm">
            <span>開始日</span>
            <Input type="date" value={form.startDate ?? ""} onChange={(event) => onChange({ ...form, startDate: parseOptionalDate(event.target.value) })} />
          </label>
          <label className="grid gap-2 text-sm">
            <span>終了日</span>
            <Input type="date" value={form.endDate ?? ""} onChange={(event) => onChange({ ...form, endDate: parseOptionalDate(event.target.value) })} />
          </label>
        </div>
        <div className="text-xs text-white/45">(空欄で無期限)</div>
        {!isPeriodValid(form.startDate, form.endDate) ? (
          <div className="text-sm text-sky-200">開始日は終了日以前にしてください。</div>
        ) : null}
      </section>

      <section className="grid gap-4 border-t border-white/10 pt-4">
        <div className="text-xs uppercase tracking-[0.18em] text-white/45">口座・その他</div>
        <label className="grid gap-2 text-sm">
          <span>{form.type === "income" ? "振り込み先口座 *" : "引き落とし口座 *"}</span>
          <Select value={form.accountId} onChange={(event) => onChange({ ...form, accountId: event.target.value })}>
            <option value="">口座を選択</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-2 text-sm">
          <span>土日祝の扱い</span>
          <DateShiftSelect value={form.dateShiftPolicy} onChange={(dateShiftPolicy) => onChange({ ...form, dateShiftPolicy })} />
        </label>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_8rem] md:items-end">
          <label className="grid gap-2 text-sm">
            <span>表示順</span>
            <Input type="number" value={form.sortOrder} onChange={(event) => onChange({ ...form, sortOrder: Number(event.target.value) })} />
          </label>
          <label className="flex h-11 items-center justify-center gap-3 rounded-xl border border-white/10 px-4 text-sm">
            <input aria-label="有効/無効" type="checkbox" checked={form.enabled} onChange={(event) => onChange({ ...form, enabled: event.target.checked })} />
            <span>有効</span>
          </label>
        </div>
      </section>

      <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
        <Button variant="ghost" onClick={onCancel}>
          キャンセル
        </Button>
        <Button disabled={!canSave} onClick={onSave}>
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

function DateShiftSelect({
  value,
  onChange,
}: {
  value: DateShiftPolicy;
  onChange: (value: DateShiftPolicy) => void;
}) {
  return (
    <Select value={value} onChange={(event) => onChange(event.target.value as DateShiftPolicy)}>
      <option value="none">シフトなし</option>
      <option value="previous">前営業日</option>
      <option value="next">後営業日</option>
    </Select>
  );
}

function RecurringRow({
  item,
  onEdit,
  onDelete,
}: {
  item: RecurringItem;
  onEdit: (item: RecurringItem) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <tr className="border-b border-white/5">
      <td className="px-3 py-3">{item.name}</td>
      <td className="px-3 py-3">{item.type === "income" ? "収入" : "支出"}</td>
      <td className="px-3 py-3">{formatCurrency(item.amount)}</td>
      <td className="px-3 py-3">{item.dayOfMonth}</td>
      <td className="px-3 py-3">{formatPeriod(item.startDate, item.endDate)}</td>
      <td className="px-3 py-3">{item.account?.name ?? "未設定"}</td>
      <td className="px-3 py-3">{item.sortOrder}</td>
      <td className="px-3 py-3 text-center">{item.enabled ? "有効" : "無効"}</td>
      <td className="px-3 py-3">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onEdit(item)}>
            編集
          </Button>
          <Button variant="danger" onClick={() => onDelete(item.id)}>
            削除
          </Button>
        </div>
      </td>
    </tr>
  );
}
