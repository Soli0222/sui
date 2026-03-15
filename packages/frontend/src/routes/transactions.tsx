import type { Account, Transaction, TransactionsResponse } from "@sui/shared";
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

const transactionTypeLabels = {
  income: "収入",
  expense: "支出",
  transfer: "振替",
} as const;

type TransactionForm = {
  accountId: string;
  transferToAccountId: string;
  date: string;
  type: "income" | "expense" | "transfer";
  description: string;
  amount: number;
};

const emptyForm: TransactionForm = {
  accountId: "",
  transferToAccountId: "",
  date: "",
  type: "expense" as const,
  description: "",
  amount: 0,
};

function canSubmitTransaction(form: TransactionForm) {
  return !(
    form.accountId === "" ||
    form.date === "" ||
    form.description.trim() === "" ||
    form.amount <= 0 ||
    (form.type === "transfer" && form.transferToAccountId === "")
  );
}

function toTransactionPayload(form: TransactionForm) {
  return {
    accountId: form.accountId,
    transferToAccountId: form.transferToAccountId || undefined,
    date: form.date,
    type: form.type,
    description: form.description,
    amount: form.amount,
  };
}

export function TransactionsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(1);
  const [accountFilter, setAccountFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editForm, setEditForm] = useState<TransactionForm>(emptyForm);
  const { data, loading, error } = useResource(
    () =>
      Promise.all([
        apiFetch<Account[]>("/api/accounts"),
        apiFetch<TransactionsResponse>(
          `/api/transactions?page=${page}&limit=20${accountFilter ? `&accountId=${accountFilter}` : ""}`,
        ),
      ]).then(([accounts, transactions]) => ({ accounts, transactions })),
    [reloadKey, page, accountFilter],
  );

  const accounts = data?.accounts ?? [];
  const transactions = data?.transactions;

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));
  const canCreate = canSubmitTransaction(form);
  const canSaveEdit = canSubmitTransaction(editForm);

  const submitTransaction = async () => {
    await apiFetch("/api/transactions", {
      method: "POST",
      body: JSON.stringify(toTransactionPayload(form)),
    });
    setForm(emptyForm);
    reload();
  };

  const openEdit = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setEditForm({
      accountId: transaction.accountId,
      transferToAccountId: transaction.transferToAccountId ?? "",
      date: transaction.date,
      type: transaction.type,
      description: transaction.description,
      amount: transaction.amount,
    });
  };

  const closeEdit = () => {
    setEditingTransaction(null);
    setEditForm(emptyForm);
  };

  const saveEdit = async () => {
    if (!editingTransaction) {
      return;
    }

    await apiFetch(`/api/transactions/${editingTransaction.id}`, {
      method: "PUT",
      body: JSON.stringify(toTransactionPayload(editForm)),
    });
    closeEdit();
    reload();
  };

  return (
    <div className="grid gap-6">
      <Card className="grid gap-4 md:grid-cols-3">
        <h2 className="md:col-span-3 text-xl font-semibold">手動取引を追加</h2>
        <TransactionFormFields accounts={accounts} form={form} onChange={setForm} />
        <div className="md:col-span-3 flex justify-end">
          <Button disabled={!canCreate} onClick={submitTransaction}>
            取引を記録
          </Button>
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">取引履歴</h2>
          <div className="flex items-center gap-3">
            <Select value={accountFilter} onChange={(event) => { setAccountFilter(event.target.value); setPage(1); }}>
              <option value="">全口座</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
            <div className="whitespace-nowrap text-sm text-white/60">{loading ? "読み込み中..." : error ?? `${transactions?.total ?? 0} 件`}</div>
          </div>
        </div>
        <TableWrapper>
          <Table className="min-w-[48rem]">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.18em] text-white/45">
                <th className="px-3 py-3">日付</th>
                <th className="px-3 py-3">口座</th>
                <th className="px-3 py-3">種別</th>
                <th className="px-3 py-3">内容</th>
                <th className="px-3 py-3">金額</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {(transactions?.items ?? []).map((transaction) => (
                <TransactionRow key={transaction.id} transaction={transaction} onEdit={openEdit} />
              ))}
            </tbody>
          </Table>
        </TableWrapper>
        <div className="mt-4 flex justify-end gap-2">
          <Button className="border border-white/10" variant="ghost" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            前へ
          </Button>
          <Button
            className="border border-white/10"
            variant="ghost"
            disabled={!transactions || page * transactions.limit >= transactions.total}
            onClick={() => setPage((value) => value + 1)}
          >
            次へ
          </Button>
        </div>
      </Card>

      <Dialog open={Boolean(editingTransaction)} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent className="w-[min(92vw,36rem)]">
          <DialogTitle className="text-lg font-semibold">取引を編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-white/60">
            取引内容を更新します。
          </DialogDescription>
          <div className="mt-6 grid gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              <TransactionFormFields accounts={accounts} form={editForm} onChange={setEditForm} />
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

function TransactionFormFields({
  accounts,
  form,
  onChange,
}: {
  accounts: Account[];
  form: TransactionForm;
  onChange: (next: TransactionForm) => void;
}) {
  return (
    <>
      <Select value={form.accountId} onChange={(event) => onChange({ ...form, accountId: event.target.value })}>
        <option value="">対象口座</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </Select>
      <Select
        value={form.type}
        onChange={(event) =>
          onChange({
            ...form,
            type: event.target.value as "income" | "expense" | "transfer",
            transferToAccountId: event.target.value === "transfer" ? form.transferToAccountId : "",
          })}
      >
        <option value="income">収入</option>
        <option value="expense">支出</option>
        <option value="transfer">振替</option>
      </Select>
      <Input type="date" value={form.date} onChange={(event) => onChange({ ...form, date: event.target.value })} />
      {form.type === "transfer" ? (
        <Select
          value={form.transferToAccountId}
          onChange={(event) => onChange({ ...form, transferToAccountId: event.target.value })}
        >
          <option value="">振替先口座</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      ) : null}
      <Input
        className={form.type === "transfer" ? undefined : "md:col-span-2"}
        placeholder="内容"
        value={form.description}
        onChange={(event) => onChange({ ...form, description: event.target.value })}
      />
      <Input
        type="number"
        placeholder="金額"
        value={form.amount}
        onChange={(event) => onChange({ ...form, amount: Number(event.target.value) })}
      />
    </>
  );
}

function TransactionRow({
  transaction,
  onEdit,
}: {
  transaction: Transaction;
  onEdit: (transaction: Transaction) => void;
}) {
  return (
    <tr className="border-b border-white/5">
      <td className="px-3 py-3 text-white/70">{formatDateWithYear(transaction.date)}</td>
      <td className="px-3 py-3">
        {transaction.accountName}
        {transaction.transferToAccountName ? ` -> ${transaction.transferToAccountName}` : ""}
      </td>
      <td className="px-3 py-3">{transactionTypeLabels[transaction.type]}</td>
      <td className="px-3 py-3">{transaction.description}</td>
      <td className="px-3 py-3">{formatCurrency(transaction.amount)}</td>
      <td className="px-3 py-3">
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => onEdit(transaction)}>
            編集
          </Button>
        </div>
      </td>
    </tr>
  );
}
