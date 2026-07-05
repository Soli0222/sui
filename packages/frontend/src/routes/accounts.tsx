import {
  SUPPORTED_CURRENCY_CODES,
  type Account,
  type ReconcileAccountPayload,
  type ReconcileAccountResponse,
  type SupportedCurrencyCode,
} from "@sui/shared";
import { useEffect, useId, useRef, useState, startTransition } from "react";
import { ConditionalField } from "../components/ui/conditional-field";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { Disclosure } from "../components/ui/disclosure";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { MoneyInput } from "../components/ui/money-input";
import { ResponsiveTable, MoneyCell, type ResponsiveTableColumn } from "../components/ui/responsive-table";
import { Select } from "../components/ui/select";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import {
  convertCurrencyInputToJpy,
  formatCurrencyParts,
  formatCurrencyWithJpy,
} from "../lib/format";
import { cn } from "../lib/utils";
import { Pencil, RefreshCcw, Trash2 } from "lucide-react";

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
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null);
  const { data, loading, error } = useResource(() => apiFetch<Account[]>("/api/accounts"), [reloadKey]);
  const { toast } = useToast();
  const canCreate = form.name.trim().length > 0 && isValidExchangeRate(form);
  const canSaveEdit = editForm.name.trim().length > 0 && isValidExchangeRate(editForm);

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));

  const createAccount = async () => {
    try {
      await apiFetch("/api/accounts", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setForm(emptyForm);
      setCreateOpen(false);
      reload();
      toast({ title: `${form.name} を追加しました` });
    } catch (createError) {
      toast({ title: "口座の追加に失敗しました", description: describeError(createError), variant: "error" });
    }
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

  const requestDelete = (account: Account) => setDeletingAccount(account);

  const confirmDelete = async () => {
    if (!deletingAccount) {
      return;
    }

    try {
      await apiFetch(`/api/accounts/${deletingAccount.id}`, { method: "DELETE" });
      toast({ title: `${deletingAccount.name} を削除しました` });
      setDeletingAccount(null);
      reload();
    } catch (deleteError) {
      toast({ title: "口座の削除に失敗しました", description: describeError(deleteError), variant: "error" });
    }
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

    try {
      await updateAccount({ ...editingAccount, ...editForm });
      closeEdit();
      toast({ title: `${editForm.name} を更新しました` });
    } catch (updateError) {
      toast({ title: "口座の更新に失敗しました", description: describeError(updateError), variant: "error" });
    }
  };

  const saveReconcile = async () => {
    if (!reconcilingAccount) {
      return;
    }

    try {
      const payload: ReconcileAccountPayload = { actualBalance: reconcileBalance };
      await apiFetch<ReconcileAccountResponse>(`/api/accounts/${reconcilingAccount.id}/reconcile`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      closeReconcile();
      reload();
      toast({ title: `${reconcilingAccount.name} を照合しました` });
    } catch (reconcileError) {
      toast({ title: "照合に失敗しました", description: describeError(reconcileError), variant: "error" });
    }
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setForm(emptyForm);
  };

  const columns: ResponsiveTableColumn<Account>[] = [
    { key: "name", header: "口座名", render: (account) => account.name },
    { key: "currency", header: "通貨", render: (account) => account.currencyCode },
    {
      key: "balance",
      header: "残高",
      align: "right",
      render: (account) => {
        const parts = formatCurrencyParts(
          account.balance,
          account.currencyCode,
          convertCurrencyInputToJpy(account.balance, account.currencyCode, account.exchangeRateToJpy),
        );
        return <MoneyCell primary={parts.primary} secondary={parts.secondary} />;
      },
    },
    {
      key: "disposable",
      header: "可処分残高",
      align: "right",
      render: (account) => {
        const disposable = account.balance - account.balanceOffset;
        const parts = formatCurrencyParts(
          disposable,
          account.currencyCode,
          convertCurrencyInputToJpy(disposable, account.currencyCode, account.exchangeRateToJpy),
        );
        return <MoneyCell primary={parts.primary} secondary={parts.secondary} />;
      },
    },
    {
      key: "reconciled",
      header: "最終照合",
      mono: true,
      render: (account) => <span className="text-ink-2">{formatLastReconciledAt(account.lastReconciledAt)}</span>,
    },
    {
      key: "rate",
      header: "換算レート",
      mono: true,
      render: (account) =>
        account.currencyCode === "JPY" ? "1" : `${account.exchangeRateToJpy.toLocaleString("ja-JP", { maximumFractionDigits: 4 })} JPY`,
    },
    { key: "sortOrder", header: "表示順", mono: true, render: (account) => account.sortOrder },
    {
      key: "actions",
      header: "",
      render: (account) => (
        <div className="flex justify-end gap-1">
          <IconButton aria-label="編集" onClick={() => openEdit(account)}>
            <Pencil aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <IconButton aria-label="照合" onClick={() => openReconcile(account)}>
            <RefreshCcw aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <IconButton aria-label="削除" variant="danger" onClick={() => requestDelete(account)}>
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
          <h2 className="text-2xl font-semibold">口座管理</h2>
          <p className="mt-2 text-sm text-ink-2">口座の残高・オフセット・表示順を管理します。</p>
        </div>
        <Button className="min-h-10 gap-2" onClick={() => setCreateOpen(true)}>
          <span className="text-lg leading-none">+</span>
          口座を追加
        </Button>
      </div>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">口座一覧</h2>
          <div className="text-sm text-ink-2">{loading ? "読み込み中..." : `${data?.length ?? 0} 件`}</div>
        </div>
        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : (
          <ResponsiveTable
            columns={columns}
            rows={data ?? []}
            rowKey={(account) => account.id}
            emptyMessage="口座が登録されていません。上部の「口座を追加」から登録してください。"
            mobileRow={(account) => (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{account.name}</div>
                    <div className="text-xs text-ink-3">{account.currencyCode}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-data text-base font-semibold">
                      {formatCurrencyWithJpy(
                        account.balance,
                        account.currencyCode,
                        convertCurrencyInputToJpy(account.balance, account.currencyCode, account.exchangeRateToJpy),
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-ink-3">
                  <span>最終照合 {formatLastReconciledAt(account.lastReconciledAt)}</span>
                  <div className="flex gap-1">
                    <IconButton aria-label="編集" onClick={() => openEdit(account)}>
                      <Pencil aria-hidden="true" className="h-4 w-4" />
                    </IconButton>
                    <IconButton aria-label="照合" onClick={() => openReconcile(account)}>
                      <RefreshCcw aria-hidden="true" className="h-4 w-4" />
                    </IconButton>
                    <IconButton aria-label="削除" variant="danger" onClick={() => requestDelete(account)}>
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
          <DialogTitle className="text-lg font-semibold">口座を追加</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">口座情報を登録します。</DialogDescription>
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
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">口座を編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">口座情報を更新します。</DialogDescription>
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
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">残高を照合</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">
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

      <ConfirmDialog
        open={Boolean(deletingAccount)}
        onOpenChange={(open) => !open && setDeletingAccount(null)}
        title="口座を削除しますか？"
        description={deletingAccount ? `「${deletingAccount.name}」を削除します。この操作は取り消せません。` : undefined}
        onConfirm={confirmDelete}
      />
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
  const nameId = useId();
  const currencyId = useId();
  const rateId = useId();
  const balanceId = useId();
  const offsetId = useId();
  const sortOrderId = useId();
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
  if (form.name.trim().length === 0) missing.push("口座名");
  if (!isValidExchangeRate(form)) missing.push("JPY換算レート");

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
      <FormField label="口座名" htmlFor={nameId} required>
        <Input id={nameId} ref={firstFieldRef} required value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} />
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

      <FormField
        label={`現在残高 (${form.currencyCode})`}
        htmlFor={balanceId}
        help={showBalanceAdjustmentNote ? "変更分は調整取引として記録されます。" : undefined}
      >
        <MoneyInput
          id={balanceId}
          currencyCode={form.currencyCode}
          value={form.balance}
          onChange={(value) => onChange({ ...form, balance: value })}
        />
      </FormField>

      <FormField
        label={`オフセット (${form.currencyCode})`}
        htmlFor={offsetId}
        help="この金額を残高から差し引いた額が可処分残高になります（例: 他人の預り金など、自由に使えない分を指定します）。"
      >
        <MoneyInput
          id={offsetId}
          currencyCode={form.currencyCode}
          value={form.balanceOffset}
          onChange={(value) => onChange({ ...form, balanceOffset: value })}
        />
      </FormField>

      <Disclosure summary="詳細設定">
        <FormField label="表示順" htmlFor={sortOrderId}>
          <Input
            id={sortOrderId}
            type="number"
            inputMode="numeric"
            value={form.sortOrder}
            onChange={(event) => onChange({ ...form, sortOrder: Number(event.target.value) })}
          />
        </FormField>
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
  const diff = actualBalance - account.balance;
  const inputId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  return (
    <form
      className="mt-6 grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <FormField label={`実残高 (${account.currencyCode})`} htmlFor={inputId} required>
        <MoneyInput
          id={inputId}
          ref={firstFieldRef}
          currencyCode={account.currencyCode}
          value={actualBalance}
          onChange={onChange}
        />
      </FormField>
      <div className="grid gap-3 rounded-xl border border-line bg-surface-2 p-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink-2">現在残高</span>
          <span className="font-data min-w-0 text-right">{formatAccountMoney(account, account.balance)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink-2">差分</span>
          <span className={cn("font-data", diff === 0 ? "text-ink" : diff > 0 ? "text-positive" : "text-critical")}>
            {formatSignedAccountMoney(account, diff)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink-2">照合後残高</span>
          <span className="font-data min-w-0 text-right">{formatAccountMoney(account, actualBalance)}</span>
        </div>
      </div>
      <div className="flex justify-end gap-3 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="submit">照合を実行</Button>
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

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
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

function formatAccountMoney(account: Account, amount: number) {
  const amountJpy = convertCurrencyInputToJpy(amount, account.currencyCode, account.exchangeRateToJpy);
  return formatCurrencyWithJpy(amount, account.currencyCode, amountJpy);
}

function formatSignedAccountMoney(account: Account, amount: number) {
  const formatted = formatAccountMoney(account, amount);
  return amount > 0 ? `+${formatted}` : formatted;
}

function isValidExchangeRate(form: AccountForm) {
  return form.currencyCode === "JPY" || form.exchangeRateToJpy > 0;
}
