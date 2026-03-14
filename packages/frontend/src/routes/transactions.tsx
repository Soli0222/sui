import type { Account, Transaction, TransactionsResponse } from "@sui/shared";
import { useState, startTransition } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
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

export function TransactionsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(1);
  const [accountFilter, setAccountFilter] = useState("");
  const [form, setForm] = useState(emptyForm);
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

  const submitTransaction = async () => {
    await apiFetch("/api/transactions", {
      method: "POST",
      body: JSON.stringify({
        accountId: form.accountId || accounts[0]?.id,
        transferToAccountId: form.transferToAccountId || undefined,
        date: form.date,
        type: form.type,
        description: form.description,
        amount: form.amount,
      }),
    });
    setForm(emptyForm);
    reload();
  };

  return (
    <div className="grid gap-6">
      <Card className="grid gap-4 md:grid-cols-3">
        <h2 className="md:col-span-3 text-xl font-semibold">手動取引を追加</h2>
        <Select value={form.accountId} onChange={(event) => setForm({ ...form, accountId: event.target.value })}>
          <option value="">対象口座</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
        <Select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as "income" | "expense" | "transfer" })}>
          <option value="income">収入</option>
          <option value="expense">支出</option>
          <option value="transfer">振替</option>
        </Select>
        <Input type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
        {form.type === "transfer" ? (
          <Select value={form.transferToAccountId} onChange={(event) => setForm({ ...form, transferToAccountId: event.target.value })}>
            <option value="">振替先口座</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Input className={form.type === "transfer" ? undefined : "md:col-span-2"} placeholder="内容" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        <Input type="number" placeholder="金額" value={form.amount} onChange={(event) => setForm({ ...form, amount: Number(event.target.value) })} />
        <div className="md:col-span-3 flex justify-end">
          <Button onClick={submitTransaction}>
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
              </tr>
            </thead>
            <tbody>
              {(transactions?.items ?? []).map((transaction) => (
                <TransactionRow key={transaction.id} transaction={transaction} />
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
    </div>
  );
}

function TransactionRow({ transaction }: { transaction: Transaction }) {
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
    </tr>
  );
}
