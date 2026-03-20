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
import { getTodayDate } from "../lib/utils";

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

type TransactionPeriodPreset =
  | "thisMonth"
  | "lastMonth"
  | "last3Months"
  | "last6Months"
  | "last1Year"
  | "all"
  | "custom";

const DEFAULT_LIMIT = 20;
const DEFAULT_PERIOD_PRESET: TransactionPeriodPreset = "last3Months";

const periodPresetOptions: Array<{ value: TransactionPeriodPreset; label: string }> = [
  { value: "thisMonth", label: "当月" },
  { value: "lastMonth", label: "先月" },
  { value: "last3Months", label: "過去3ヶ月" },
  { value: "last6Months", label: "過去6ヶ月" },
  { value: "last1Year", label: "過去1年" },
  { value: "all", label: "全期間" },
  { value: "custom", label: "カスタム期間" },
];

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getStartOfMonth(value: string) {
  const date = parseDateOnly(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(value: string, offset: number) {
  const date = parseDateOnly(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, date.getUTCDate()));
}

function resolveDateRange(preset: TransactionPeriodPreset, today: string) {
  if (preset === "all") {
    return { startDate: "", endDate: "" };
  }

  if (preset === "thisMonth") {
    return {
      startDate: formatDateOnly(getStartOfMonth(today)),
      endDate: today,
    };
  }

  if (preset === "lastMonth") {
    const start = addMonths(formatDateOnly(getStartOfMonth(today)), -1);
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    return {
      startDate: formatDateOnly(start),
      endDate: formatDateOnly(end),
    };
  }

  if (preset === "last3Months") {
    return {
      startDate: formatDateOnly(addMonths(formatDateOnly(getStartOfMonth(today)), -2)),
      endDate: today,
    };
  }

  if (preset === "last6Months") {
    return {
      startDate: formatDateOnly(addMonths(formatDateOnly(getStartOfMonth(today)), -5)),
      endDate: today,
    };
  }

  return {
    startDate: formatDateOnly(addMonths(formatDateOnly(getStartOfMonth(today)), -11)),
    endDate: today,
  };
}

function buildTransactionsPath(params: {
  page: number;
  limit: number;
  accountFilter: string;
  periodPreset: TransactionPeriodPreset;
  customStartDate: string;
  customEndDate: string;
  today: string;
}) {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });

  if (params.accountFilter) {
    searchParams.set("accountId", params.accountFilter);
  }

  const range =
    params.periodPreset === "custom"
      ? { startDate: params.customStartDate, endDate: params.customEndDate }
      : resolveDateRange(params.periodPreset, params.today);

  if (range.startDate) {
    searchParams.set("startDate", range.startDate);
  }
  if (range.endDate) {
    searchParams.set("endDate", range.endDate);
  }

  return `/api/transactions?${searchParams.toString()}`;
}

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
  const today = getTodayDate();
  const defaultRange = resolveDateRange(DEFAULT_PERIOD_PRESET, today);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [accountFilter, setAccountFilter] = useState("");
  const [periodPreset, setPeriodPreset] = useState<TransactionPeriodPreset>(DEFAULT_PERIOD_PRESET);
  const [customStartDate, setCustomStartDate] = useState(defaultRange.startDate);
  const [customEndDate, setCustomEndDate] = useState(defaultRange.endDate);
  const [form, setForm] = useState(emptyForm);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editForm, setEditForm] = useState<TransactionForm>(emptyForm);
  const { data, loading, error } = useResource(
    () =>
      Promise.all([
        apiFetch<Account[]>("/api/accounts"),
        apiFetch<TransactionsResponse>(
          buildTransactionsPath({
            page,
            limit,
            accountFilter,
            periodPreset,
            customStartDate,
            customEndDate,
            today,
          }),
        ),
      ]).then(([accounts, transactions]) => ({ accounts, transactions })),
    [reloadKey, page, limit, accountFilter, periodPreset, customStartDate, customEndDate, today],
  );

  const accounts = data?.accounts ?? [];
  const transactions = data?.transactions;
  const transactionItems = error ? [] : transactions?.items ?? [];

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
          <div className="whitespace-nowrap text-sm text-white/60">{loading ? "読み込み中..." : error ?? `${transactions?.total ?? 0} 件`}</div>
        </div>
        <div className="mb-4">
          <TransactionFilters
            accounts={accounts}
            accountFilter={accountFilter}
            onAccountFilterChange={(value) => {
              setAccountFilter(value);
              setPage(1);
            }}
            periodPreset={periodPreset}
            onPeriodPresetChange={(value) => {
              setPeriodPreset(value);
              setPage(1);
            }}
            customStartDate={customStartDate}
            onCustomStartDateChange={(value) => {
              setCustomStartDate(value);
              setPage(1);
            }}
            customEndDate={customEndDate}
            onCustomEndDateChange={(value) => {
              setCustomEndDate(value);
              setPage(1);
            }}
            limit={limit}
            onLimitChange={(value) => {
              setLimit(value);
              setPage(1);
            }}
          />
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
              {transactionItems.map((transaction) => (
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
            disabled={Boolean(error) || !transactions || page * transactions.limit >= transactions.total}
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
      <Select
        aria-label="取引口座"
        value={form.accountId}
        onChange={(event) => onChange({ ...form, accountId: event.target.value })}
      >
        <option value="">対象口座</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label="取引種別"
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
      <Input
        aria-label="取引日"
        type="date"
        value={form.date}
        onChange={(event) => onChange({ ...form, date: event.target.value })}
      />
      {form.type === "transfer" ? (
        <Select
          aria-label="振替先口座"
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

function TransactionFilters({
  accounts,
  accountFilter,
  onAccountFilterChange,
  periodPreset,
  onPeriodPresetChange,
  customStartDate,
  onCustomStartDateChange,
  customEndDate,
  onCustomEndDateChange,
  limit,
  onLimitChange,
}: {
  accounts: Account[];
  accountFilter: string;
  onAccountFilterChange: (value: string) => void;
  periodPreset: TransactionPeriodPreset;
  onPeriodPresetChange: (value: TransactionPeriodPreset) => void;
  customStartDate: string;
  onCustomStartDateChange: (value: string) => void;
  customEndDate: string;
  onCustomEndDateChange: (value: string) => void;
  limit: number;
  onLimitChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        aria-label="口座フィルター"
        className="min-w-[11rem] md:w-auto"
        value={accountFilter}
        onChange={(event) => onAccountFilterChange(event.target.value)}
      >
        <option value="">全口座</option>
        {accounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label="期間プリセット"
        className="min-w-[11rem] md:w-auto"
        value={periodPreset}
        onChange={(event) => onPeriodPresetChange(event.target.value as TransactionPeriodPreset)}
      >
        {periodPresetOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
      {periodPreset === "custom" ? (
        <>
          <Input
            aria-label="開始日"
            className="md:w-auto"
            type="date"
            value={customStartDate}
            onChange={(event) => onCustomStartDateChange(event.target.value)}
          />
          <Input
            aria-label="終了日"
            className="md:w-auto"
            type="date"
            value={customEndDate}
            onChange={(event) => onCustomEndDateChange(event.target.value)}
          />
        </>
      ) : null}
      <Select
        aria-label="表示件数"
        className="min-w-[8rem] md:w-auto"
        value={String(limit)}
        onChange={(event) => onLimitChange(Number(event.target.value))}
      >
        <option value="20">20件</option>
        <option value="50">50件</option>
        <option value="100">100件</option>
      </Select>
    </div>
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
