import type {
  Account,
  BalanceHistoryResponse,
  SupportedCurrencyCode,
  Transaction,
  TransactionsResponse,
} from "@sui/shared";
import { useEffect, useId, useRef, useState, startTransition } from "react";
import { AccountSelect } from "../components/form-fields";
import { AccountSelector } from "../components/account-selector";
import { BalanceChart } from "../components/balance-chart";
import { OffsetToggle } from "../components/offset-toggle";
import { PeriodSelector } from "../components/period-selector";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConditionalField } from "../components/ui/conditional-field";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { MoneyInput } from "../components/ui/money-input";
import { ResponsiveTable, MoneyCell, type ResponsiveTableColumn } from "../components/ui/responsive-table";
import { SegmentedControl } from "../components/ui/segmented-control";
import { Select } from "../components/ui/select";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import {
  convertCurrencyInputToJpy,
  formatCurrency,
  formatDateWithYear,
  formatTypedAmount,
  formatTypedAmountParts,
} from "../lib/format";
import { getTodayDate } from "../lib/utils";
import { Pencil, Trash2 } from "lucide-react";

const transactionTypeLabels = {
  income: "収入",
  expense: "支出",
  transfer: "振替",
  adjustment: "調整",
} as const;

const transactionTypeOptions = [
  { value: "income", label: "収入" },
  { value: "expense", label: "支出" },
  { value: "transfer", label: "振替" },
] as const;

const unspecifiedAccountLabel = "未指定";

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
  const hasAccount = form.accountId !== "";
  const hasTransferToAccount = form.transferToAccountId !== "";

  return !(
    form.date === "" ||
    form.description.trim() === "" ||
    form.amount <= 0 ||
    (form.type !== "transfer" && !hasAccount) ||
    (form.type === "transfer" && !hasAccount && !hasTransferToAccount) ||
    (hasAccount && form.accountId === form.transferToAccountId)
  );
}

function getMissingFields(form: TransactionForm) {
  const missing: string[] = [];
  if (form.description.trim() === "") missing.push("内容");
  if (form.amount <= 0) missing.push("金額");
  if (form.date === "") missing.push("取引日");
  if (form.type !== "transfer" && form.accountId === "") missing.push("口座");
  if (form.type === "transfer" && form.accountId === "" && form.transferToAccountId === "") missing.push("口座");
  return missing;
}

function toTransactionPayload(form: TransactionForm) {
  return {
    accountId: form.accountId || undefined,
    transferToAccountId: form.transferToAccountId || undefined,
    date: form.date,
    type: form.type,
    description: form.description,
    amount: form.amount,
  };
}

function getTransactionTypeClassName(type: Transaction["type"]) {
  // 種別色は残高の重大度色（positive/warning/critical）と衝突させない。
  // 色は状態（安全/警告/危険）にのみ使い、種別はグレースケールの階調で区別する。
  if (type === "income") {
    return "text-ink";
  }

  if (type === "expense") {
    return "text-ink-2";
  }

  return "text-ink-3";
}

function formatTransactionAccounts(transaction: Transaction) {
  const sourceName = transaction.accountName ?? unspecifiedAccountLabel;
  const destinationName = transaction.transferToAccountName ?? unspecifiedAccountLabel;

  if (transaction.type === "transfer") {
    return `${sourceName} -> ${destinationName}`;
  }

  return sourceName;
}

// 符号規約（B-7）: 収入は+、支出は-、振替は符号なし。調整取引だけに「+」が付いていた
// 現状をやめ、formatTypedAmount/formatTypedAmountParts（lib/format.ts）へ一本化する。
function formatTransactionAmount(transaction: Transaction) {
  if (transaction.currencyCode === "JPY") {
    return formatTypedAmount(transaction.type, transaction.amount, transaction.currencyCode);
  }

  return `${formatTypedAmount(transaction.type, transaction.amount, transaction.currencyCode)} / ${formatTypedAmount(transaction.type, transaction.amountJpy, "JPY")}`;
}

function getTransactionAmountParts(transaction: Transaction) {
  return formatTypedAmountParts(transaction.type, transaction.amount, transaction.currencyCode, transaction.amountJpy);
}

function getAccountBalanceJpy(account: Account, applyOffset: boolean) {
  return convertCurrencyInputToJpy(
    account.balance - (applyOffset ? account.balanceOffset : 0),
    account.currencyCode,
    account.exchangeRateToJpy,
  );
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
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
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [editForm, setEditForm] = useState<TransactionForm>(emptyForm);
  const [deletingTransaction, setDeletingTransaction] = useState<Transaction | null>(null);
  const { toast } = useToast();
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
    : accounts.reduce((sum, account) => sum + getAccountBalanceJpy(account, applyOffset), 0);
  const currentBalanceCurrencyCode: SupportedCurrencyCode = selectedAccount?.currencyCode ?? "JPY";
  const effectiveEndDate = range.endDate || today;
  const chartPoints = balanceHistory?.points ?? [];
  const chartData =
    effectiveEndDate === today && chartPoints.length > 0 && chartPoints[chartPoints.length - 1]?.date !== today
      ? [
          ...chartPoints,
          {
            date: today,
            balance: currentBalance,
            description: selectedAccount ? `${selectedAccount.name} 現在残高` : "全体 現在残高",
          },
        ]
      : chartPoints;

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));
  const canCreate = canSubmitTransaction(form);
  const canSaveEdit = canSubmitTransaction(editForm);

  const submitTransaction = async () => {
    try {
      await apiFetch("/api/transactions", {
        method: "POST",
        body: JSON.stringify(toTransactionPayload(form)),
      });
      setForm(emptyForm);
      setCreateOpen(false);
      reload();
      toast({ title: "取引を記録しました" });
    } catch (createError) {
      toast({ title: "取引の記録に失敗しました", description: describeError(createError), variant: "error" });
    }
  };

  const openEdit = (transaction: Transaction) => {
    if (transaction.type === "adjustment") {
      return;
    }

    setEditingTransaction(transaction);
    setEditForm({
      accountId: transaction.accountId ?? "",
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

  const closeCreate = () => {
    setCreateOpen(false);
    setForm(emptyForm);
  };

  const saveEdit = async () => {
    if (!editingTransaction) {
      return;
    }

    try {
      await apiFetch(`/api/transactions/${editingTransaction.id}`, {
        method: "PUT",
        body: JSON.stringify(toTransactionPayload(editForm)),
      });
      closeEdit();
      reload();
      toast({ title: "取引を更新しました" });
    } catch (updateError) {
      toast({ title: "更新に失敗しました", description: describeError(updateError), variant: "error" });
    }
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

    try {
      await apiFetch(`/api/transactions/${deletingTransaction.id}`, {
        method: "DELETE",
      });
      closeDelete();
      if (transactionItems.length === 1 && page > 1) {
        setPage((value) => value - 1);
      }
      reload();
      toast({ title: "取引を削除しました" });
    } catch (deleteError) {
      toast({ title: "削除に失敗しました", description: describeError(deleteError), variant: "error" });
    }
  };

  const columns: ResponsiveTableColumn<Transaction>[] = [
    { key: "date", header: "日付", mono: true, render: (transaction) => <span className="text-ink-2">{formatDateWithYear(transaction.date)}</span> },
    {
      key: "type",
      header: "種別",
      render: (transaction) => (
        <span className={getTransactionTypeClassName(transaction.type)}>{transactionTypeLabels[transaction.type]}</span>
      ),
    },
    { key: "description", header: "内容", render: (transaction) => transaction.description },
    {
      key: "amount",
      header: "金額",
      align: "right",
      render: (transaction) => {
        const parts = getTransactionAmountParts(transaction);
        return <MoneyCell primary={parts.primary} secondary={parts.secondary} />;
      },
    },
    { key: "account", header: "対象口座", render: (transaction) => formatTransactionAccounts(transaction) },
    {
      key: "actions",
      header: "",
      render: (transaction) => (
        <div className="flex justify-end gap-1">
          {transaction.type !== "adjustment" ? (
            <IconButton aria-label="編集" onClick={() => openEdit(transaction)}>
              <Pencil aria-hidden="true" className="h-4 w-4" />
            </IconButton>
          ) : null}
          <IconButton
            aria-label="削除"
            variant="danger"
            disabled={transaction.forecastEventId !== null}
            onClick={() => openDelete(transaction)}
          >
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
          <h2 className="text-2xl font-semibold">取引履歴</h2>
          <p className="mt-2 text-sm text-ink-2">手動取引の記録と履歴の確認を行います。</p>
        </div>
        <Button className="min-h-10 gap-2" onClick={() => setCreateOpen(true)}>
          <span className="text-lg leading-none">+</span>
          取引を追加
        </Button>
      </div>

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
        <div className="ml-auto min-w-0 shrink">
          <OffsetToggle checked={applyOffset} onChange={setApplyOffset} />
        </div>
      </div>

      <Card className="flex h-[360px] flex-col overflow-hidden px-4 pt-4 pb-2 sm:h-[450px] sm:px-5 sm:pt-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="break-words text-xl font-semibold">
              {selectedAccount ? `${selectedAccount.name} の残高推移` : "残高推移"}
            </h2>
            <p className="text-sm text-ink-2">
              {selectedAccount ? "選択した口座に関係する確定取引から過去残高を復元します。" : "全口座合算の過去実績を表示します。"}
            </p>
          </div>
          <div className="min-w-0 text-right">
            <div className="text-xs font-medium text-ink-3">現在残高</div>
            <div className="font-data mt-1 overflow-x-auto whitespace-nowrap text-lg font-semibold">
              {formatCurrency(currentBalance, currentBalanceCurrencyCode)}
            </div>
          </div>
        </div>
        {loading ? (
          <StateMessage message="読み込み中..." />
        ) : error ? (
          <StateMessage message={error} tone="danger" />
        ) : (
          <div className="min-h-0 min-w-0 flex-1">
            <BalanceChart
              data={chartData}
              currentBalance={currentBalance}
              label={selectedAccount?.name ?? "全体"}
              currencyCode={currentBalanceCurrencyCode}
            />
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">取引一覧</h2>
            <p className="mt-1 text-sm text-ink-2">{loading ? "読み込み中..." : `${transactions?.total ?? 0} 件`}</p>
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
        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : (
          <ResponsiveTable
            columns={columns}
            rows={transactionItems}
            rowKey={(transaction) => transaction.id}
            emptyMessage="該当する取引はありません。"
            mobileRow={(transaction) => (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{transaction.description}</div>
                    <div className="text-xs text-ink-3">
                      <span className={getTransactionTypeClassName(transaction.type)}>{transactionTypeLabels[transaction.type]}</span>
                    </div>
                  </div>
                  <div className="font-data text-base font-semibold">{formatTransactionAmount(transaction)}</div>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-ink-3">
                  <span>{formatDateWithYear(transaction.date)}・{formatTransactionAccounts(transaction)}</span>
                  <div className="flex gap-1">
                    {transaction.type !== "adjustment" ? (
                      <IconButton aria-label="編集" onClick={() => openEdit(transaction)}>
                        <Pencil aria-hidden="true" className="h-4 w-4" />
                      </IconButton>
                    ) : null}
                    <IconButton
                      aria-label="削除"
                      variant="danger"
                      disabled={transaction.forecastEventId !== null}
                      onClick={() => openDelete(transaction)}
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </IconButton>
                  </div>
                </div>
              </>
            )}
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button className="border border-line" variant="ghost" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            前へ
          </Button>
          <Button
            className="border border-line"
            variant="ghost"
            disabled={Boolean(error) || !transactions || page * transactions.limit >= transactions.total}
            onClick={() => setPage((value) => value + 1)}
          >
            次へ
          </Button>
        </div>
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : closeCreate())}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">取引を追加</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">手動取引を記録します。</DialogDescription>
          <TransactionEditModal
            accounts={accounts}
            form={form}
            onChange={setForm}
            canSave={canCreate}
            actionLabel="取引を記録"
            onCancel={closeCreate}
            onSave={submitTransaction}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingTransaction)} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">取引を編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">取引内容を更新します。</DialogDescription>
          <TransactionEditModal
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
        open={Boolean(deletingTransaction)}
        onOpenChange={(open) => !open && closeDelete()}
        title="取引を削除しますか？"
        description={
          deletingTransaction
            ? `「${deletingTransaction.description}」（${formatTransactionAmount(deletingTransaction)}）を削除します。残高が元に戻ります。この操作は取り消せません。`
            : undefined
        }
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function TransactionEditModal({
  accounts,
  form,
  onChange,
  canSave,
  onCancel,
  onSave,
  actionLabel = "保存",
}: {
  accounts: Account[];
  form: TransactionForm;
  onChange: (next: TransactionForm) => void;
  canSave: boolean;
  onCancel: () => void;
  onSave: () => void;
  actionLabel?: string;
}) {
  const sourceAccount = accounts.find((account) => account.id === form.accountId) ?? null;
  const destinationAccount = accounts.find((account) => account.id === form.transferToAccountId) ?? null;
  const currencyCode: SupportedCurrencyCode = sourceAccount?.currencyCode ?? destinationAccount?.currencyCode ?? "JPY";
  const transferDestinationAccounts = accounts.filter(
    (account) => account.id !== form.accountId && (!sourceAccount || account.currencyCode === sourceAccount.currencyCode),
  );
  const descriptionId = useId();
  const amountId = useId();
  const dateId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const missing = getMissingFields(form);

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
      <FormField label="内容" htmlFor={descriptionId} required>
        <Input
          id={descriptionId}
          ref={firstFieldRef}
          placeholder="内容"
          value={form.description}
          onChange={(event) => onChange({ ...form, description: event.target.value })}
        />
      </FormField>

      <FormField label="取引種別" htmlFor="transaction-type">
        <SegmentedControl
          aria-label="取引種別"
          value={form.type}
          options={transactionTypeOptions}
          onChange={(type) =>
            onChange({
              ...form,
              type,
              transferToAccountId: type === "transfer" ? form.transferToAccountId : "",
            })}
        />
      </FormField>

      <FormField label="金額" htmlFor={amountId} required>
        <MoneyInput id={amountId} currencyCode={currencyCode} value={form.amount} onChange={(value) => onChange({ ...form, amount: value })} />
      </FormField>

      <FormField label="取引日" htmlFor={dateId} required>
        <Input id={dateId} type="date" value={form.date} onChange={(event) => onChange({ ...form, date: event.target.value })} />
      </FormField>

      <AccountSelect
        id="transaction-account"
        label={form.type === "transfer" ? "送金元口座" : "対象口座"}
        accounts={accounts}
        value={form.accountId}
        required={false}
        placeholder={form.type === "transfer" ? "送金元口座なし" : "対象口座を選択"}
        onChange={(accountId) => {
          const nextAccount = accounts.find((account) => account.id === accountId) ?? null;
          onChange({
            ...form,
            accountId,
            transferToAccountId:
              nextAccount && destinationAccount?.currencyCode !== nextAccount.currencyCode ? "" : form.transferToAccountId,
          });
        }}
      />

      <ConditionalField show={form.type === "transfer"}>
        <AccountSelect
          id="transaction-transfer-account"
          label="振替先口座"
          accounts={transferDestinationAccounts}
          value={form.transferToAccountId}
          required={false}
          placeholder="振替先口座なし"
          onChange={(accountId) => onChange({ ...form, transferToAccountId: accountId })}
        />
      </ConditionalField>

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

function StateMessage({ message, tone = "default" }: { message: string; tone?: "default" | "danger" }) {
  return <div className={tone === "danger" ? "text-critical" : "text-ink-2"}>{message}</div>;
}
