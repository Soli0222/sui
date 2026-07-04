import {
  SUPPORTED_CURRENCY_CODES,
  type Account,
  type ReconcileAccountPayload,
  type ReconcileAccountResponse,
  type SupportedCurrencyCode,
} from "@sui/shared";
import { useState, startTransition } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Table, TableWrapper } from "../components/ui/table";
import { useResource } from "../hooks/use-resource";
import { apiFetch } from "../lib/api";
import {
  convertCurrencyInputToJpy,
  formatCurrencyInputValue,
  formatCurrencyWithJpy,
  parseCurrencyInputValue,
} from "../lib/format";

type AccountForm = {
  name: string;
  balance: number;
  balanceOffset: number;
  currencyCode: SupportedCurrencyCode;
  exchangeRateToJpy: number;
  sortOrder: number;
};

const emptyForm: AccountForm = {
  name: "",
  balance: 0,
  balanceOffset: 0,
  currencyCode: "JPY",
  exchangeRateToJpy: 1,
  sortOrder: 0,
};

export function AccountsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState<AccountForm>(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState<AccountForm>(emptyForm);
  const [reconcilingAccount, setReconcilingAccount] = useState<Account | null>(null);
  const [reconcileBalance, setReconcileBalance] = useState(0);
  const { data, loading, error } = useResource(() => apiFetch<Account[]>("/api/accounts"), [reloadKey]);
  const canCreate = form.name.trim().length > 0 && isValidExchangeRate(form);
  const canSaveEdit = editForm.name.trim().length > 0 && isValidExchangeRate(editForm);

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));

  const createAccount = async () => {
    await apiFetch("/api/accounts", {
      method: "POST",
      body: JSON.stringify(form),
    });
    setForm(emptyForm);
    setCreateOpen(false);
    reload();
  };

  const updateAccount = async (account: Account) => {
    await apiFetch(`/api/accounts/${account.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: account.name,
        balance: account.balance,
        balanceOffset: account.balanceOffset,
        currencyCode: account.currencyCode,
        exchangeRateToJpy: account.exchangeRateToJpy,
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
      currencyCode: account.currencyCode,
      exchangeRateToJpy: account.exchangeRateToJpy,
      sortOrder: account.sortOrder,
    });
  };

  const openReconcile = (account: Account) => {
    setReconcilingAccount(account);
    setReconcileBalance(account.balance);
  };

  const closeEdit = () => {
    setEditingAccount(null);
    setEditForm(emptyForm);
  };

  const closeReconcile = () => {
    setReconcilingAccount(null);
    setReconcileBalance(0);
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

  const saveReconcile = async () => {
    if (!reconcilingAccount) {
      return;
    }

    const payload: ReconcileAccountPayload = { actualBalance: reconcileBalance };
    await apiFetch<ReconcileAccountResponse>(`/api/accounts/${reconcilingAccount.id}/reconcile`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    closeReconcile();
    reload();
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setForm(emptyForm);
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">口座管理</h2>
          <p className="mt-2 text-sm text-white/60">口座の残高・オフセット・表示順を管理します。</p>
        </div>
        <Button className="min-h-10 gap-2" onClick={() => setCreateOpen(true)}>
          <span className="text-lg leading-none">+</span>
          口座を追加
        </Button>
      </div>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">口座一覧</h2>
          <div className="text-sm text-white/60">{loading ? "読み込み中..." : error ?? `${data?.length ?? 0} 件`}</div>
        </div>
        <TableWrapper>
          <Table className="min-w-[72rem]">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.18em] text-white/45">
                <th className="px-3 py-3">口座名</th>
                <th className="px-3 py-3">通貨</th>
                <th className="px-3 py-3">残高</th>
                <th className="px-3 py-3">可処分残高</th>
                <th className="px-3 py-3">最終照合</th>
                <th className="px-3 py-3">換算レート</th>
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
                  onReconcile={openReconcile}
                  onDelete={deleteAccount}
                />
              ))}
            </tbody>
          </Table>
        </TableWrapper>
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : closeCreate())}>
        <DialogContent className="w-[min(94vw,36rem)]">
          <DialogTitle className="text-lg font-semibold">口座を追加</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-white/60">
            口座情報を登録します。
          </DialogDescription>
          <AccountEditModal
            form={form}
            onChange={setForm}
            canSave={canCreate}
            actionLabel="追加"
            onCancel={closeCreate}
            onSave={createAccount}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingAccount)} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent className="w-[min(94vw,36rem)]">
          <DialogTitle className="text-lg font-semibold">口座を編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-white/60">
            口座情報を更新します。
          </DialogDescription>
          <AccountEditModal
            form={editForm}
            onChange={setEditForm}
            canSave={canSaveEdit}
            onCancel={closeEdit}
            onSave={saveEdit}
            showBalanceAdjustmentNote
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reconcilingAccount)} onOpenChange={(open) => !open && closeReconcile()}>
        <DialogContent className="w-[min(94vw,34rem)]">
          <DialogTitle className="text-lg font-semibold">残高を照合</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-white/60">
            実残高との差分を調整取引として記録します。
          </DialogDescription>
          {reconcilingAccount ? (
            <ReconcileModal
              account={reconcilingAccount}
              actualBalance={reconcileBalance}
              onChange={setReconcileBalance}
              onCancel={closeReconcile}
              onSave={saveReconcile}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccountEditModal({
  form,
  onChange,
  canSave,
  onCancel,
  onSave,
  actionLabel = "保存",
  showBalanceAdjustmentNote = false,
}: {
  form: AccountForm;
  onChange: (next: AccountForm) => void;
  canSave: boolean;
  onCancel: () => void;
  onSave: () => void;
  actionLabel?: string;
  showBalanceAdjustmentNote?: boolean;
}) {
  return (
    <div className="mt-6 grid gap-5">
      <section className="grid gap-4">
        <div className="text-xs uppercase tracking-[0.18em] text-white/45">基本情報</div>
        <div className="grid gap-4 md:grid-cols-2">
          <AccountFormFields
            form={form}
            onChange={onChange}
            showBalanceAdjustmentNote={showBalanceAdjustmentNote}
          />
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

function AccountFormFields({
  form,
  onChange,
  showBalanceAdjustmentNote,
}: {
  form: AccountForm;
  onChange: (next: AccountForm) => void;
  showBalanceAdjustmentNote: boolean;
}) {
  const amountStep = form.currencyCode === "JPY" ? 1 : 0.01;
  const setCurrencyCode = (currencyCode: SupportedCurrencyCode) => {
    onChange({
      ...form,
      currencyCode,
      exchangeRateToJpy: currencyCode === "JPY" ? 1 : form.exchangeRateToJpy,
    });
  };

  return (
    <>
      <label className="grid gap-2 text-sm">
        <span>口座名 *</span>
        <Input required value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} />
      </label>
      <label className="grid gap-2 text-sm">
        <span>通貨</span>
        <Select
          value={form.currencyCode}
          onChange={(event) => setCurrencyCode(event.target.value as SupportedCurrencyCode)}
        >
          {SUPPORTED_CURRENCY_CODES.map((currencyCode) => (
            <option key={currencyCode} value={currencyCode}>
              {currencyCode}
            </option>
          ))}
        </Select>
      </label>
      {form.currencyCode !== "JPY" ? (
        <label className="grid gap-2 text-sm">
          <span>JPY換算レート</span>
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.0001"
            value={form.exchangeRateToJpy}
            onChange={(event) => onChange({ ...form, exchangeRateToJpy: Number(event.target.value) })}
          />
        </label>
      ) : null}
      <label className="grid gap-2 text-sm">
        <span>現在残高 ({form.currencyCode})</span>
        <Input
          type="number"
          inputMode="decimal"
          step={amountStep}
          value={formatCurrencyInputValue(form.balance, form.currencyCode)}
          onChange={(event) => onChange({
            ...form,
            balance: parseCurrencyInputValue(event.target.value, form.currencyCode),
          })}
        />
        {showBalanceAdjustmentNote ? (
          <span className="text-xs text-white/50">変更分は調整取引として記録されます。</span>
        ) : null}
      </label>
      <label className="grid gap-2 text-sm">
        <span>オフセット ({form.currencyCode})</span>
        <Input
          type="number"
          inputMode="decimal"
          step={amountStep}
          value={formatCurrencyInputValue(form.balanceOffset, form.currencyCode)}
          onChange={(event) => onChange({
            ...form,
            balanceOffset: parseCurrencyInputValue(event.target.value, form.currencyCode),
          })}
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
  onReconcile,
  onDelete,
}: {
  account: Account;
  onEdit: (account: Account) => void;
  onReconcile: (account: Account) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <tr className="border-b border-white/5">
      <td className="px-3 py-3">{account.name}</td>
      <td className="px-3 py-3">{account.currencyCode}</td>
      <td className="px-3 py-3">
        <MoneyValue account={account} amount={account.balance} />
      </td>
      <td className="px-3 py-3">
        <MoneyValue account={account} amount={account.balance - account.balanceOffset} />
      </td>
      <td className="px-3 py-3 text-white/70">{formatLastReconciledAt(account.lastReconciledAt)}</td>
      <td className="px-3 py-3">
        {account.currencyCode === "JPY"
          ? "1"
          : `${account.exchangeRateToJpy.toLocaleString("ja-JP", { maximumFractionDigits: 4 })} JPY`}
      </td>
      <td className="px-3 py-3">{account.sortOrder}</td>
      <td className="px-3 py-3">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onEdit(account)}>
            編集
          </Button>
          <Button variant="ghost" onClick={() => onReconcile(account)}>
            照合
          </Button>
          <Button variant="danger" onClick={() => onDelete(account.id)}>
            削除
          </Button>
        </div>
      </td>
    </tr>
  );
}

function ReconcileModal({
  account,
  actualBalance,
  onChange,
  onCancel,
  onSave,
}: {
  account: Account;
  actualBalance: number;
  onChange: (next: number) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const amountStep = account.currencyCode === "JPY" ? 1 : 0.01;
  const diff = actualBalance - account.balance;

  return (
    <div className="mt-6 grid gap-5">
      <label className="grid gap-2 text-sm">
        <span>実残高 ({account.currencyCode})</span>
        <Input
          type="number"
          inputMode="decimal"
          step={amountStep}
          value={formatCurrencyInputValue(actualBalance, account.currencyCode)}
          onChange={(event) => onChange(parseCurrencyInputValue(event.target.value, account.currencyCode))}
        />
      </label>
      <div className="grid gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/60">現在残高</span>
          <span className="min-w-0 break-words text-right">{formatAccountMoney(account, account.balance)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/60">差分</span>
          <span className={diff === 0 ? "text-white/80" : diff > 0 ? "text-sky-300" : "text-pink-300"}>
            {formatSignedAccountMoney(account, diff)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-white/60">照合後残高</span>
          <span className="min-w-0 break-words text-right">{formatAccountMoney(account, actualBalance)}</span>
        </div>
      </div>
      <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
        <Button variant="ghost" onClick={onCancel}>
          キャンセル
        </Button>
        <Button onClick={onSave}>
          照合を実行
        </Button>
      </div>
    </div>
  );
}

function MoneyValue({ account, amount }: { account: Account; amount: number }) {
  return (
    <div>
      <div>{formatAccountMoney(account, amount)}</div>
    </div>
  );
}

function formatAccountMoney(account: Account, amount: number) {
  const amountJpy = convertCurrencyInputToJpy(amount, account.currencyCode, account.exchangeRateToJpy);
  return formatCurrencyWithJpy(amount, account.currencyCode, amountJpy);
}

function formatSignedAccountMoney(account: Account, amount: number) {
  const formatted = formatAccountMoney(account, amount);
  return amount > 0 ? `+${formatted}` : formatted;
}

const lastReconciledAtFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "short",
  day: "numeric",
});

function formatLastReconciledAt(value: string | null) {
  if (!value) {
    return "未照合";
  }

  return lastReconciledAtFormatter.format(new Date(value));
}

function isValidExchangeRate(form: AccountForm) {
  return form.currencyCode === "JPY" || form.exchangeRateToJpy > 0;
}
