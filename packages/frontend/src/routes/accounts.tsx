import type { Account } from "@sui/shared";
import { useState, startTransition } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Table, TableWrapper } from "../components/ui/table";
import { useResource } from "../hooks/use-resource";
import { apiFetch } from "../lib/api";
import { formatCurrency } from "../lib/format";

type AccountForm = {
  name: string;
  balance: number;
  balanceOffset: number;
  sortOrder: number;
};

const emptyForm: AccountForm = {
  name: "",
  balance: 0,
  balanceOffset: 0,
  sortOrder: 0,
};

export function AccountsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState<AccountForm>(emptyForm);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState<AccountForm>(emptyForm);
  const { data, loading, error } = useResource(() => apiFetch<Account[]>("/api/accounts"), [reloadKey]);
  const canCreate = form.name.trim().length > 0;
  const canSaveEdit = editForm.name.trim().length > 0;

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));

  const createAccount = async () => {
    await apiFetch("/api/accounts", {
      method: "POST",
      body: JSON.stringify(form),
    });
    setForm(emptyForm);
    reload();
  };

  const updateAccount = async (account: Account) => {
    await apiFetch(`/api/accounts/${account.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: account.name,
        balance: account.balance,
        balanceOffset: account.balanceOffset,
        sortOrder: account.sortOrder,
      }),
    });
    reload();
  };

  const deleteAccount = async (id: string) => {
    if (!window.confirm("この口座を削除します。よろしいですか？")) {
      return;
    }
    await apiFetch(`/api/accounts/${id}`, { method: "DELETE" });
    reload();
  };

  const openEdit = (account: Account) => {
    setEditingAccount(account);
    setEditForm({
      name: account.name,
      balance: account.balance,
      balanceOffset: account.balanceOffset,
      sortOrder: account.sortOrder,
    });
  };

  const closeEdit = () => {
    setEditingAccount(null);
    setEditForm(emptyForm);
  };

  const saveEdit = async () => {
    if (!editingAccount) {
      return;
    }

    await updateAccount({
      ...editingAccount,
      ...editForm,
    });
    closeEdit();
  };

  return (
    <div className="grid gap-6">
      <Card className="grid gap-4 md:grid-cols-5">
        <h2 className="text-xl font-semibold md:col-span-5">口座を追加</h2>
        <AccountFormFields form={form} onChange={setForm} />
        <div className="self-end justify-self-end">
          <Button disabled={!canCreate} onClick={createAccount}>
            追加
          </Button>
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">口座一覧</h2>
          <div className="text-sm text-white/60">{loading ? "読み込み中..." : error ?? `${data?.length ?? 0} 件`}</div>
        </div>
        <TableWrapper>
          <Table className="min-w-[52rem]">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.18em] text-white/45">
                <th className="px-3 py-3">口座名</th>
                <th className="px-3 py-3">残高</th>
                <th className="px-3 py-3">可処分残高</th>
                <th className="px-3 py-3">表示順</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  onEdit={openEdit}
                  onDelete={deleteAccount}
                />
              ))}
            </tbody>
          </Table>
        </TableWrapper>
      </Card>

      <Dialog open={Boolean(editingAccount)} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent>
          <DialogTitle className="text-lg font-semibold">口座を編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-white/60">
            口座情報を更新します。
          </DialogDescription>
          <div className="mt-6 grid gap-4">
            <div className="grid gap-4 md:grid-cols-4">
              <AccountFormFields form={editForm} onChange={setEditForm} />
            </div>
            <div className="flex justify-end gap-3">
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

function AccountFormFields({
  form,
  onChange,
}: {
  form: AccountForm;
  onChange: (next: AccountForm) => void;
}) {
  return (
    <>
      <label className="grid gap-2 text-sm">
        <span>口座名 *</span>
        <Input required value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} />
      </label>
      <label className="grid gap-2 text-sm">
        <span>現在残高 (円)</span>
        <Input
          type="number"
          inputMode="numeric"
          value={form.balance}
          onChange={(event) => onChange({ ...form, balance: Number(event.target.value) })}
        />
      </label>
      <label className="grid gap-2 text-sm">
        <span>オフセット (円)</span>
        <Input
          type="number"
          inputMode="numeric"
          value={form.balanceOffset}
          onChange={(event) => onChange({ ...form, balanceOffset: Number(event.target.value) })}
        />
      </label>
      <label className="grid gap-2 text-sm">
        <span>表示順</span>
        <Input
          type="number"
          inputMode="numeric"
          value={form.sortOrder}
          onChange={(event) => onChange({ ...form, sortOrder: Number(event.target.value) })}
        />
      </label>
    </>
  );
}

function AccountRow({
  account,
  onEdit,
  onDelete,
}: {
  account: Account;
  onEdit: (account: Account) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <tr className="border-b border-white/5">
      <td className="px-3 py-3">{account.name}</td>
      <td className="px-3 py-3">{formatCurrency(account.balance)}</td>
      <td className="px-3 py-3">{formatCurrency(account.balance - account.balanceOffset)}</td>
      <td className="px-3 py-3">{account.sortOrder}</td>
      <td className="px-3 py-3">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onEdit(account)}>
            編集
          </Button>
          <Button variant="danger" onClick={() => onDelete(account.id)}>
            削除
          </Button>
        </div>
      </td>
    </tr>
  );
}
