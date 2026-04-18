import type {
  Account,
  BalanceHistoryResponse,
  Transaction,
  TransactionsResponse,
} from "@sui/shared";
import { useState, startTransition } from "react";
import { AccountSelector } from "../components/account-selector";
import { BalanceChart } from "../components/balance-chart";
import { OffsetToggle } from "../components/offset-toggle";
import { PeriodSelector } from "../components/period-selector";
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
  selectedAccountId: string | "total";
  startDate: string;
  endDate: string;
}) {
  const searchParams = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
  });

  if (params.selectedAccountId !== "total") {
    searchParams.set("accountId", params.selectedAccountId);
  }
  if (params.startDate) {
    searchParams.set("startDate", params.startDate);
  }
  if (params.endDate) {
    searchParams.set("endDate", params.endDate);
  }

  return `/api/transactions?${searchParams.toString()}`;
}

function buildBalanceHistoryPath(params: {
  selectedAccountId: string | "total";
  startDate: string;
  endDate: string;
  applyOffset: boolean;
}) {
  const searchParams = new URLSearchParams();

  if (params.selectedAccountId !== "total") {
    searchParams.set("accountId", params.selectedAccountId);
  }
  if (params.startDate) {
    searchParams.set("startDate", params.startDate);
  }
  if (params.endDate) {
    searchParams.set("endDate", params.endDate);
  }
  searchParams.set("applyOffset", String(params.applyOffset));

  const query = searchParams.toString();
  return query ? `/api/transactions/balance-history?${query}` : "/api/transactions/balance-history";
}

const emptyForm: TransactionForm = {
  accountId: "",
  transferToAccountId: "",
  date: "",
  type: "expense",
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

function getTransactionTypeClassName(type: Transaction["type"]) {
  if (type === "income") {
    return "text-sky-300";
  }

  if (type === "expense") {
    return "text-pink-300";
  }

  return "text-amber-300";
}

export function TransactionsPage() {
  const today = getTodayDate();
  const defaultRange = resolveDateRange(DEFAULT_PERIOD_PRESET, today);
  const [reloadKey, setReloadKey] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [selectedAccountId, setSelectedAccountId] = useState<string | "total">("total");
  const [periodPreset, setPeriodPreset] = useState<TransactionPeriodPreset>(DEFAULT_PERIOD_PRESET);
  const [applyOffset, setApplyOffset] = useState(true);
  const [customStartDate, setCustomStartDate] = useState(defaultRange.startDate);
  const [customEndDate, setCustomEndDate] = useState(defaultRange.endDate);
  const [form, setForm] = useState(emptyForm);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editForm, setEditForm] = useState<TransactionForm>(emptyForm);
  const [deletingTransaction, setDeletingTransaction] = useState<Transaction | null>(null);
  const range =
    periodPreset === "custom"
      ? { startDate: customStartDate, endDate: customEndDate }
      : resolveDateRange(periodPreset, today);
  const { data, loading, error } = useResource(
    () =>
      Promise.all([
        apiFetch<Account[]>("/api/accounts"),
        apiFetch<TransactionsResponse>(
          buildTransactionsPath({
            page,
            limit,
            selectedAccountId,
            startDate: range.startDate,
            endDate: range.endDate,
          }),
        ),
        apiFetch<BalanceHistoryResponse>(
          buildBalanceHistoryPath({
            selectedAccountId,
            startDate: range.startDate,
            endDate: range.endDate,
            applyOffset,
          }),
        ),
      ]).then(([accounts, transactions, balanceHistory]) => ({ accounts, transactions, balanceHistory })),
    [reloadKey, page, limit, selectedAccountId, range.startDate, range.endDate, applyOffset],
  );

  const accounts = data?.accounts ?? [];
  const transactions = data?.transactions;
  const balanceHistory = data?.balanceHistory;
  const transactionItems = error ? [] : transactions?.items ?? [];
  const selectedAccount = selectedAccountId === "total"
    ? null
    : accounts.find((account) => account.id === selectedAccountId) ?? null;
  const currentBalance = selectedAccount
    ? selectedAccount.balance - (applyOffset ? selectedAccount.balanceOffset : 0)
    : accounts.reduce((sum, account) => sum + account.balance - (applyOffset ? account.balanceOffset : 0), 0);
  const effectiveEndDate = range.endDate || today;
  const chartPoints = balanceHistory?.points ?? [];
  const chartData =
    effectiveEndDate === today && chartPoints.length > 0 && chartPoints[chartPoints.length - 1]?.date !== today
      ? [
          ...chartPoints,
          {
            date: today,
            balance: currentBalance,
            description: selectedAccount ? `${selectedAccount.name} 現在残高` : "総所持金",
          },
        ]
      : chartPoints;

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

  const openDelete = (transaction: Transaction) => {
    setDeletingTransaction(transaction);
  };

  const closeDelete = () => {
    setDeletingTransaction(null);
  };

  const confirmDelete = async () => {
    if (!deletingTransaction) {
      return;
    }

    await apiFetch(`/api/transactions/${deletingTransaction.id}`, {
      method: "DELETE",
    });
    closeDelete();
    if (transactionItems.length === 1 && page > 1) {
      setPage((value) => value - 1);
    }
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

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <AccountSelector
            accounts={accounts}
            selected={selectedAccountId}
            onChange={(value) => {
              setSelectedAccountId(value);
              setPage(1);
            }}
          />
        </div>
        <div className="ml-auto shrink-0">
          <OffsetToggle checked={applyOffset} onChange={setApplyOffset} />
        </div>
      </div>

      <Card className="flex h-[450px] flex-col overflow-hidden px-5 pt-5 pb-2">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">
              {selectedAccount ? `${selectedAccount.name} の残高推移` : "所持金推移"}
            </h2>
            <p className="text-sm text-white/60">
              {selectedAccount ? "選択した口座に関係する確定取引から過去残高を復元します。" : "全口座合算の過去実績を表示します。"}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-[0.18em] text-white/45">現在残高</div>
            <div className="mt-1 text-lg font-semibold">{formatCurrency(currentBalance)}</div>
          </div>
        </div>
        {loading ? (
          <StateMessage message="読み込み中..." />
        ) : error ? (
          <StateMessage message={error} tone="danger" />
        ) : (
          <div className="min-h-0 flex-1">
            <BalanceChart
              data={chartData}
              currentBalance={currentBalance}
              label={selectedAccount?.name ?? "総所持金"}
            />
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">取引履歴</h2>
            <p className="mt-1 text-sm text-white/60">
              {loading ? "読み込み中..." : error ?? `${transactions?.total ?? 0} 件`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <PeriodSelector
              ariaLabel="期間プリセット"
              className="w-auto min-w-32"
              presets={periodPresetOptions}
              selected={periodPreset}
              onChange={(value) => {
                setPeriodPreset(value);
                setPage(1);
              }}
            />
            <Select
              aria-label="表示件数"
              className="min-w-[8rem] w-auto"
              value={String(limit)}
              onChange={(event) => {
                setLimit(Number(event.target.value));
                setPage(1);
              }}
            >
              <option value="20">20件</option>
              <option value="50">50件</option>
              <option value="100">100件</option>
            </Select>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {periodPreset === "custom" ? (
            <>
              <Input
                aria-label="開始日"
                className="md:w-auto"
                type="date"
                value={customStartDate}
                onChange={(event) => {
                  setCustomStartDate(event.target.value);
                  setPage(1);
                }}
              />
              <Input
                aria-label="終了日"
                className="md:w-auto"
                type="date"
                value={customEndDate}
                onChange={(event) => {
                  setCustomEndDate(event.target.value);
                  setPage(1);
                }}
              />
            </>
          ) : null}
        </div>
        <TableWrapper>
          <Table>
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.18em] text-white/45">
                <th className="px-3 py-3">日付</th>
                <th className="px-3 py-3">種別</th>
                <th className="px-3 py-3">内容</th>
                <th className="px-3 py-3">金額</th>
                <th className="px-3 py-3">対象口座</th>
                <th className="px-3 py-3 text-right" />
              </tr>
            </thead>
            <tbody>
              {transactionItems.map((transaction) => (
                <TransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  onEdit={openEdit}
                  onDelete={openDelete}
                />
              ))}
            </tbody>
          </Table>
        </TableWrapper>
        {!loading && !error && transactionItems.length === 0 ? (
          <div className="mt-4 text-white/60">該当する取引はありません。</div>
        ) : null}
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

      <Dialog open={Boolean(deletingTransaction)} onOpenChange={(open) => !open && closeDelete()}>
        <DialogContent className="w-[min(92vw,32rem)]">
          <DialogTitle className="text-lg font-semibold">取引を削除</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-white/60">
            この操作は取り消せません。削除すると口座残高が元に戻ります。
          </DialogDescription>
          {deletingTransaction ? (
            <div className="mt-6 grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/60">日付</span>
                <span>{formatDateWithYear(deletingTransaction.date)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/60">内容</span>
                <span>{deletingTransaction.description}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/60">金額</span>
                <span>{formatCurrency(deletingTransaction.amount)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-white/60">対象口座</span>
                <span>
                  {deletingTransaction.accountName}
                  {deletingTransaction.transferToAccountName
                    ? ` -> ${deletingTransaction.transferToAccountName}`
                    : ""}
                </span>
              </div>
            </div>
          ) : null}
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="ghost" onClick={closeDelete}>
              キャンセル
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              削除
            </Button>
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

function TransactionRow({
  transaction,
  onEdit,
  onDelete,
}: {
  transaction: Transaction;
  onEdit: (transaction: Transaction) => void;
  onDelete: (transaction: Transaction) => void;
}) {
  return (
    <tr className="border-b border-white/5">
      <td className="px-3 py-3 text-white/70">{formatDateWithYear(transaction.date)}</td>
      <td className="px-3 py-3">
        <span className={getTransactionTypeClassName(transaction.type)}>
          {transactionTypeLabels[transaction.type]}
        </span>
      </td>
      <td className="px-3 py-3">{transaction.description}</td>
      <td className="px-3 py-3">{formatCurrency(transaction.amount)}</td>
      <td className="px-3 py-3">
        {transaction.accountName}
        {transaction.transferToAccountName ? ` -> ${transaction.transferToAccountName}` : ""}
      </td>
      <td className="px-3 py-3 text-right">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onEdit(transaction)}>
            編集
          </Button>
          <Button
            variant="ghost"
            className="text-pink-300 hover:bg-pink-500/10 disabled:text-white/30 disabled:hover:bg-transparent"
            disabled={transaction.forecastEventId !== null}
            onClick={() => onDelete(transaction)}
          >
            削除
          </Button>
        </div>
      </td>
    </tr>
  );
}

function StateMessage({ message, tone = "default" }: { message: string; tone?: "default" | "danger" }) {
  return <div className={tone === "danger" ? "text-pink-300" : "text-white/60"}>{message}</div>;
}
