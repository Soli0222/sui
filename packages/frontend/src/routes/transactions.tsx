import { useSearchParams } from "react-router-dom";
import { SpendingBacklinks } from "../components/spending-backlink";
import { INT4_MAX } from "@sui/shared";
import type {
  Account,
  BalanceHistoryResponse,
  SupportedCurrencyCode,
  Transaction,
  TransactionDefaultPeriodPreset,
  TransactionsResponse,
  UiSettingsResponse,
} from "@sui/shared";
import { useEffect, useId, useRef, useState, startTransition } from "react";
import { AccountSelect } from "../components/form-fields";
import { EditModal, type EditChange } from "../components/editing/edit-surface";
import { AccountSelector } from "../components/account-selector";
import { BalanceChart } from "../components/balance-chart";
import { OffsetToggle } from "../components/offset-toggle";
import { PeriodSelector } from "../components/period-selector";
import { Badge } from "../components/ui/badge";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { useEditSession, type EditErrors } from "../hooks/use-edit-session";
import { useFieldValidation } from "../hooks/use-field-validation";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { MoneyInput, readMoneyDraft } from "../components/ui/money-input";
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
  formatCurrencyInputValue,
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
  amountRaw: string;
};

type TransactionPeriodPreset = TransactionDefaultPeriodPreset | "custom";

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
  amountRaw: "",
};

function transactionCurrency(form: TransactionForm, accounts: Account[]): SupportedCurrencyCode {
  return accounts.find((account) => account.id === form.accountId)?.currencyCode
    ?? accounts.find((account) => account.id === form.transferToAccountId)?.currencyCode
    ?? "JPY";
}

function validateTransaction(form: TransactionForm, accounts: Account[]): EditErrors {
  const errors: EditErrors = {};
  if (!form.description.trim()) errors.description = "内容を入力してください。";
  const amount = readMoneyDraft(form.amountRaw, transactionCurrency(form, accounts));
  if (amount.kind !== "valid" || amount.minorUnits === null || amount.minorUnits <= 0 || amount.minorUnits > INT4_MAX) {
    errors.amount = `0より大きく${INT4_MAX}以下の金額を入力してください。`;
  }
  if (!form.date) errors.date = "取引日を入力してください。";
  if (form.type !== "transfer" && !form.accountId) errors.accountId = "対象口座を選択してください。";
  if (form.accountId && !accounts.some((account) => account.id === form.accountId)) errors.accountId = "利用できる口座を選択してください。";
  if (form.transferToAccountId && !accounts.some((account) => account.id === form.transferToAccountId)) errors.transferToAccountId = "利用できる振替先を選択してください。";
  if (form.type === "transfer" && !form.accountId && !form.transferToAccountId) {
    errors.accountId = "送金元か振替先の少なくとも一方を選択してください。";
  }
  if (form.accountId && form.accountId === form.transferToAccountId) {
    errors.transferToAccountId = "同じ口座には振り替えられません。";
  }
  const source = accounts.find((account) => account.id === form.accountId);
  const destination = accounts.find((account) => account.id === form.transferToAccountId);
  if (form.type === "transfer" && source && destination && source.currencyCode !== destination.currencyCode) {
    errors.transferToAccountId = "異なる通貨の口座には振り替えられません。";
  }
  return errors;
}

function toTransactionPayload(form: TransactionForm, accounts: Account[]) {
  const amount = readMoneyDraft(form.amountRaw, transactionCurrency(form, accounts)).minorUnits;
  if (amount === null) throw new Error("金額を確認してください。");
  return {
    accountId: form.accountId || undefined,
    transferToAccountId: form.type === "transfer" ? form.transferToAccountId || undefined : undefined,
    date: form.date,
    type: form.type,
    description: form.description,
    amount,
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
  const [search, setSearch] = useSearchParams();
  const targetId = search.get("transaction");

  const today = getTodayDate();
  const defaultRange = resolveDateRange(DEFAULT_PERIOD_PRESET, today);
  const [reloadKey, setReloadKey] = useState(0);
  const target = useResource(() => targetId
    ? apiFetch<TransactionsResponse>(`/api/transactions?id=${encodeURIComponent(targetId)}`)
    : Promise.resolve(null), [targetId, reloadKey]);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [selectedAccountId, setSelectedAccountId] = useState<string | "total">("total");
  const [periodPreset, setPeriodPreset] = useState<TransactionPeriodPreset>(DEFAULT_PERIOD_PRESET);
  const periodChangedByUser = useRef(false);
  const [applyOffset, setApplyOffset] = useState(true);
  const [customStartDate, setCustomStartDate] = useState(defaultRange.startDate);
  const [customEndDate, setCustomEndDate] = useState(defaultRange.endDate);
  const [form, setForm] = useState(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [deletingTransaction, setDeletingTransaction] = useState<Transaction | null>(null);
  const { toast } = useToast();
  const range =
    periodPreset === "custom"
      ? { startDate: customStartDate, endDate: customEndDate }
      : resolveDateRange(periodPreset, today);

  useEffect(() => {
    let cancelled = false;

    void apiFetch<UiSettingsResponse>("/api/settings")
      .then((settings) => {
        if (!cancelled && !periodChangedByUser.current) {
          setPeriodPreset(settings.transactionsDefaultPeriod);
        }
      })
      .catch(() => {
        // 設定を取得できない場合はビルトイン既定値を維持する。
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const { data, loading, error, setData } = useResource(
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
  const refreshTransactionData = async () => {
    const [freshAccounts, freshTransactions, freshHistory, freshTarget] = await Promise.all([
      apiFetch<Account[]>("/api/accounts"),
      apiFetch<TransactionsResponse>(buildTransactionsPath({ page, limit, selectedAccountId, startDate: range.startDate, endDate: range.endDate })),
      apiFetch<BalanceHistoryResponse>(buildBalanceHistoryPath({ selectedAccountId, startDate: range.startDate, endDate: range.endDate, applyOffset })),
      targetId ? apiFetch<TransactionsResponse>(`/api/transactions?id=${encodeURIComponent(targetId)}`) : Promise.resolve(null),
    ]);
    setData({ accounts: freshAccounts, transactions: freshTransactions, balanceHistory: freshHistory });
    target.setData(freshTarget);
  };

  const openEdit = (transaction: Transaction) => {
    if (transaction.type === "adjustment") {
      return;
    }

    setEditingTransaction(transaction);
    setForm({
      accountId: transaction.accountId ?? "",
      transferToAccountId: transaction.transferToAccountId ?? "",
      date: transaction.date,
      type: transaction.type,
      description: transaction.description,
      amountRaw: formatCurrencyInputValue(transaction.amount, transaction.currencyCode),
    });
  };

  const closeEdit = () => {
    setEditingTransaction(null);
    setForm(emptyForm);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setForm(emptyForm);
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
    {
      key: "description",
      header: "内容",
      render: (transaction) => (
        <div className="flex flex-wrap items-center gap-2">
          <span>{transaction.description}</span>
          {transaction.settlementLinked ? <Badge tone="success">精算</Badge> : null}
        </div>
      ),
    },
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
      <SpendingBacklinks kind="transaction" reloadKey={reloadKey} />
      {targetId && (
        <Card>
          <h3 className="font-semibold">関連する確定取引</h3>
          {target.loading ? <p>読み込み中…</p> : target.error ? <ErrorBlock message={target.error} onRetry={reload} /> : (
            <ResponsiveTable columns={columns} rows={target.data?.items ?? []} rowKey={item => item.id}
              emptyMessage="この取引は削除済み、または見つかりません。"
              mobileRow={item => <p>{item.description} · {formatDateWithYear(item.date)} · {formatTransactionAmount(item)} · {formatTransactionAccounts(item)}</p>} />
          )}
          <Button variant="ghost" onClick={() => setSearch({})}>関連取引の表示を閉じる</Button>
        </Card>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">取引履歴</h2>
          <p className="mt-2 text-sm text-ink-2">手動取引の記録と履歴の確認を行います。</p>
        </div>
        <Button className="min-h-10 gap-2" onClick={() => {
          setForm({ ...emptyForm, date: getTodayDate(), accountId: selectedAccount?.id ?? "" });
          setCreateOpen(true);
        }}>
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
            {(balanceHistory?.bucketDays ?? 1) > 1 ? (
              <p className="mb-2 text-xs text-ink-2">長期間の履歴は{balanceHistory?.bucketDays}日単位の期末残高で表示しています。</p>
            ) : null}
            <BalanceChart
              data={chartData}
              currentBalance={currentBalance}
              label={selectedAccount?.name ?? "全体"}
              currencyCode={currentBalanceCurrencyCode}
              exchangeRateToJpy={selectedAccount?.exchangeRateToJpy ?? 1}
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
                periodChangedByUser.current = true;
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
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate font-medium">{transaction.description}</div>
                      {transaction.settlementLinked ? <Badge tone="success">精算</Badge> : null}
                    </div>
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

      {createOpen && <TransactionEditModal
        key="create" accounts={accounts} initial={form} onClose={closeCreate}
        onMutate={(draft) => apiFetch("/api/transactions", { method: "POST", body: JSON.stringify(toTransactionPayload(draft, accounts)) })}
        onRefresh={refreshTransactionData}
        onSaved={() => toast({ title: "取引を記録しました" })}
      />}
      {editingTransaction && <TransactionEditModal
        key={editingTransaction.id} accounts={accounts} initial={form} transaction={editingTransaction} onClose={closeEdit}
        onMutate={(draft) => apiFetch(`/api/transactions/${editingTransaction.id}`, { method: "PUT", body: JSON.stringify(toTransactionPayload(draft, accounts)) })}
        onRefresh={refreshTransactionData}
        onSaved={() => toast({ title: "取引を更新しました" })}
      />}

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
  initial,
  transaction,
  onClose,
  onMutate,
  onRefresh,
  onSaved,
}: {
  accounts: Account[];
  initial: TransactionForm;
  transaction?: Transaction;
  onClose: () => void;
  onMutate: (draft: TransactionForm) => Promise<unknown>;
  onRefresh: () => Promise<void>;
  onSaved: () => void;
}) {
  const descriptionId = useId();
  const amountId = useId();
  const dateId = useId();
  const sourceId = useId();
  const destinationId = useId();
  const fieldIds = { description: descriptionId, amount: amountId, date: dateId, accountId: sourceId, transferToAccountId: destinationId };
  const validate = (draft: TransactionForm) => validateTransaction(draft, accounts);
  const equal = (left: TransactionForm, right: TransactionForm) => {
    const leftMoney = readMoneyDraft(left.amountRaw, transactionCurrency(left, accounts));
    const rightMoney = readMoneyDraft(right.amountRaw, transactionCurrency(right, accounts));
    const sameAmount = leftMoney.kind === "valid" && rightMoney.kind === "valid"
      ? leftMoney.minorUnits === rightMoney.minorUnits : left.amountRaw === right.amountRaw;
    return sameAmount && left.accountId === right.accountId && left.transferToAccountId === right.transferToAccountId
      && left.date === right.date && left.type === right.type && left.description === right.description;
  };
  const session = useEditSession({ identity: transaction?.id ?? "new", initial, validate, fieldIds, equal });
  const { draft, setDraft } = session;
  const fields = useFieldValidation(draft, validate, fieldIds);
  const sourceAccount = accounts.find((account) => account.id === draft.accountId) ?? null;
  const destinationAccount = accounts.find((account) => account.id === draft.transferToAccountId) ?? null;
  const currencyCode = transactionCurrency(draft, accounts);
  const transferDestinationAccounts = accounts.filter(
    (account) => account.id !== draft.accountId && (!sourceAccount || account.currencyCode === sourceAccount.currencyCode),
  );
  const requestClose = () => session.requestClose(onClose);
  const refresh = async () => { await onRefresh(); return draft; };
  const save = async () => {
    fields.showAll();
    const succeeded = await session.save(onMutate, refresh);
    if (succeeded) { onSaved(); onClose(); }
  };
  const changes: EditChange[] = [];
  const addChange = (label: string, before: string, after: string) => {
    if (before !== after) changes.push({ label, before: before || "—", after: after || "—" });
  };
  const accountName = (id: string) => accounts.find((account) => account.id === id)?.name ?? "未指定";
  addChange("内容", initial.description, draft.description);
  addChange("種別", transactionTypeLabels[initial.type], transactionTypeLabels[draft.type]);
  addChange("金額", initial.amountRaw, draft.amountRaw);
  addChange("取引日", initial.date, draft.date);
  addChange("対象口座", accountName(initial.accountId), accountName(draft.accountId));
  if (draft.type === "transfer" || initial.type === "transfer") {
    addChange("振替先", accountName(initial.transferToAccountId), accountName(draft.transferToAccountId));
  }
  const switchAmountCurrency = (next: TransactionForm) => {
    const beforeCurrency = transactionCurrency(draft, accounts);
    const afterCurrency = transactionCurrency(next, accounts);
    const parsed = readMoneyDraft(draft.amountRaw, beforeCurrency);
    setDraft({ ...next, amountRaw: beforeCurrency !== afterCurrency && parsed.minorUnits !== null
      ? formatCurrencyInputValue(parsed.minorUnits, afterCurrency) : draft.amountRaw });
  };

  return <EditModal
    open subjectType="取引" subjectName={transaction?.description ?? "取引"}
    title={transaction ? `${transaction.description}を編集` : "取引を追加"}
    mode={transaction ? "edit" : "create"}
    status={session.status} changes={changes}
    impact="保存すると取引と対象口座の残高に反映されます。"
    error={session.error} saveLabel={transaction ? "変更を保存" : "取引を追加"}
    onRequestClose={requestClose} onSave={() => void save()}
    onRetryRefresh={() => void session.retryRefresh().then((succeeded) => { if (succeeded) { onSaved(); onClose(); } })}
  >
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <FormField label="内容" htmlFor={descriptionId} required error={fields.visibleErrors.description}>
        <Input id={descriptionId} value={draft.description} onBlur={() => fields.touch("description")}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
      </FormField>
      <FormField label="取引種別" htmlFor="transaction-type">
        <SegmentedControl aria-label="取引種別" value={draft.type} options={transactionTypeOptions}
          onChange={(type) => setDraft({ ...draft, type, transferToAccountId: type === "transfer" ? draft.transferToAccountId : "" })} />
      </FormField>
      <FormField label="金額" htmlFor={amountId} required error={fields.visibleErrors.amount}>
        <MoneyInput id={amountId} currencyCode={currencyCode} value={readMoneyDraft(draft.amountRaw, currencyCode).minorUnits}
          draftValue={draft.amountRaw} draftKey={transaction?.id ?? "new"} onChange={() => {}}
          onDraftChange={(next) => setDraft({ ...draft, amountRaw: next.raw })} onBlur={() => fields.touch("amount")} />
      </FormField>
      <FormField label="取引日" htmlFor={dateId} required error={fields.visibleErrors.date}>
        <Input id={dateId} type="date" value={draft.date} onBlur={() => fields.touch("date")}
          onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
      </FormField>
      <AccountSelect id={sourceId} label={draft.type === "transfer" ? "送金元口座" : "対象口座"}
        accounts={accounts} value={draft.accountId} required={draft.type !== "transfer"}
        placeholder={draft.type === "transfer" ? "送金元口座なし" : "対象口座を選択"}
        error={fields.visibleErrors.accountId}
        help={initial.accountId && draft.accountId === initial.accountId && !transaction ? "選択中の口座を引き継いでいます。" : undefined}
        onChange={(accountId) => switchAmountCurrency({ ...draft, accountId,
          transferToAccountId: accountId && destinationAccount?.currencyCode !== accounts.find((account) => account.id === accountId)?.currencyCode ? "" : draft.transferToAccountId })} />
      {draft.type === "transfer" && <AccountSelect id={destinationId} label="振替先口座"
        accounts={transferDestinationAccounts} value={draft.transferToAccountId} required={false}
        placeholder="振替先口座なし" error={fields.visibleErrors.transferToAccountId}
        help="送金元と振替先の少なくとも一方を選びます。同じ口座・異なる通貨の口座間では振り替えられません。"
        onChange={(transferToAccountId) => switchAmountCurrency({ ...draft, transferToAccountId })} />}
      <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>保存</button>
    </form>
  </EditModal>;
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
