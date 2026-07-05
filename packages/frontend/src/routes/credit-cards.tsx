import {
  INT4_MAX,
  type Account,
  type BillingResponse,
  type CreditCard,
  type CreditCardAssumptionSuggestionResponse,
  type DateShiftPolicy,
} from "@sui/shared";
import { useEffect, useId, useMemo, useRef, useState, startTransition } from "react";
import { AccountSelect, DateShiftField, DayOfMonthField } from "../components/form-fields";
import { Badge } from "../components/ui/badge";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { Disclosure } from "../components/ui/disclosure";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { MoneyInput } from "../components/ui/money-input";
import { ResponsiveTable, type ResponsiveTableColumn } from "../components/ui/responsive-table";
import { Table, TableWrapper } from "../components/ui/table";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { getCurrentYearMonth } from "../lib/utils";
import { Pencil, Trash2 } from "lucide-react";

type CreditCardForm = {
  name: string;
  settlementDay: number | null;
  dateShiftPolicy: DateShiftPolicy;
  accountId: string;
  assumptionAmount: number;
  sortOrder: number;
};

const emptyCard: CreditCardForm = {
  name: "",
  settlementDay: 27,
  dateShiftPolicy: "none",
  accountId: "",
  assumptionAmount: 0,
  sortOrder: 0,
};

type BillingRow = {
  card: CreditCard;
  inputAmount: number;
  actualAmount: number | null;
  resolvedAmount: ReturnType<typeof resolveAppliedCardAmount>;
  error: string | null;
};

type BillingTotals = {
  assumptionTotal: number;
  actualTotal: number;
  appliedTotal: number;
};

function getMonthOffset(currentYearMonth: string, targetYearMonth: string) {
  const currentTotalMonths =
    Number(currentYearMonth.slice(0, 4)) * 12 + Number(currentYearMonth.slice(5, 7)) - 1;
  const targetTotalMonths =
    Number(targetYearMonth.slice(0, 4)) * 12 + Number(targetYearMonth.slice(5, 7)) - 1;

  return targetTotalMonths - currentTotalMonths;
}

function hasAmount(record: Record<string, number>, cardId: string) {
  return Object.prototype.hasOwnProperty.call(record, cardId);
}

function getAmountError(amount: number) {
  if (!Number.isInteger(amount)) {
    return "整数で入力してください";
  }

  if (amount < 0) {
    return "0円以上で入力してください";
  }

  if (amount > INT4_MAX) {
    return `${INT4_MAX.toLocaleString("ja-JP")}円以下で入力してください`;
  }

  return null;
}

function focusNextBillingInput(currentInput: HTMLInputElement) {
  const visibleInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>("[data-billing-amount-input='true']"),
  ).filter((input) => input.offsetParent !== null);
  const nextInput = visibleInputs[visibleInputs.indexOf(currentInput) + 1];
  nextInput?.focus();
  nextInput?.select();
}

function resolveAppliedCardAmount({
  actualAmount,
  assumptionAmount,
  monthOffset,
}: {
  actualAmount: number | null;
  assumptionAmount: number;
  monthOffset: number;
}) {
  if (actualAmount === null) {
    return {
      amount: assumptionAmount,
      usesActual: false,
    };
  }

  if (monthOffset >= 1 && actualAmount < assumptionAmount) {
    return {
      amount: assumptionAmount,
      usesActual: false,
    };
  }

  return {
    amount: actualAmount,
    usesActual: true,
  };
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

export function CreditCardsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [cardForm, setCardForm] = useState(emptyCard);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<CreditCard | null>(null);
  const [editForm, setEditForm] = useState<CreditCardForm>(emptyCard);
  const [deletingCard, setDeletingCard] = useState<CreditCard | null>(null);
  const [assumptionSuggestion, setAssumptionSuggestion] = useState<CreditCardAssumptionSuggestionResponse | null>(null);
  const [assumptionSuggestionLoading, setAssumptionSuggestionLoading] = useState(false);
  const [assumptionSuggestionError, setAssumptionSuggestionError] = useState<string | null>(null);
  const [editedAmounts, setEditedAmounts] = useState<Record<string, number>>({});
  const [editedYearMonth, setEditedYearMonth] = useState<string | null>(null);
  const { toast } = useToast();

  const { data, loading, error } = useResource(
    () =>
      Promise.all([
        apiFetch<CreditCard[]>("/api/credit-cards"),
        apiFetch<Account[]>("/api/accounts"),
        apiFetch<BillingResponse>(`/api/billings?month=${yearMonth}`),
      ]).then(([cards, accounts, billing]) => ({ cards, accounts, billing })),
    [reloadKey, yearMonth],
  );

  const accounts = data?.accounts ?? [];
  const monthOffset = getMonthOffset(getCurrentYearMonth(), yearMonth);
  const billingAmounts = useMemo<Record<string, number>>(
    () => Object.fromEntries((data?.billing.items ?? []).map((item) => [item.creditCardId, item.amount])),
    [data?.billing.items],
  );
  const amounts = useMemo(
    () =>
      editedYearMonth === yearMonth
        ? {
            ...billingAmounts,
            ...editedAmounts,
          }
        : billingAmounts,
    [billingAmounts, editedAmounts, editedYearMonth, yearMonth],
  );
  const billingRows = useMemo(
    () =>
      (data?.cards ?? []).map((card) => {
        const savedAmountExists = hasAmount(billingAmounts, card.id);
        const editedAmountExists = editedYearMonth === yearMonth && hasAmount(editedAmounts, card.id);
        const inputAmount = amounts[card.id] ?? 0;
        const actualAmount = savedAmountExists || editedAmountExists ? inputAmount : null;
        const resolvedAmount = resolveAppliedCardAmount({
          actualAmount,
          assumptionAmount: card.assumptionAmount,
          monthOffset,
        });

        return {
          card,
          inputAmount,
          actualAmount,
          resolvedAmount,
          error: getAmountError(inputAmount),
        };
      }),
    [amounts, billingAmounts, data?.cards, editedAmounts, editedYearMonth, monthOffset, yearMonth],
  );
  const isBillingDirty =
    editedYearMonth === yearMonth &&
    billingRows.some(({ card, inputAmount }) => {
      const editedAmountExists = hasAmount(editedAmounts, card.id);
      if (!editedAmountExists) {
        return false;
      }

      const savedAmountExists = hasAmount(billingAmounts, card.id);
      return !savedAmountExists || inputAmount !== billingAmounts[card.id];
    });
  const hasBillingErrors = billingRows.some((row) => row.error !== null);
  const billingTotals = billingRows.reduce<BillingTotals>(
    (totals, row) => ({
      assumptionTotal: totals.assumptionTotal + row.card.assumptionAmount,
      actualTotal: totals.actualTotal + (row.actualAmount ?? 0),
      appliedTotal: totals.appliedTotal + row.resolvedAmount.amount,
    }),
    { assumptionTotal: 0, actualTotal: 0, appliedTotal: 0 },
  );
  const canSaveBilling = billingRows.length > 0 && isBillingDirty && !hasBillingErrors;
  const reload = () => {
    setEditedAmounts({});
    setEditedYearMonth(null);
    startTransition(() => setReloadKey((value) => value + 1));
  };
  const canCreate =
    cardForm.name.trim().length > 0 &&
    cardForm.accountId !== "" &&
    cardForm.assumptionAmount >= 0 &&
    (cardForm.settlementDay === null || (cardForm.settlementDay >= 1 && cardForm.settlementDay <= 31));
  const canSaveEdit =
    editForm.name.trim().length > 0 &&
    editForm.accountId !== "" &&
    editForm.assumptionAmount >= 0 &&
    (editForm.settlementDay === null || (editForm.settlementDay >= 1 && editForm.settlementDay <= 31));

  const createCard = async () => {
    try {
      await apiFetch("/api/credit-cards", {
        method: "POST",
        body: JSON.stringify(cardForm),
      });
      const name = cardForm.name;
      setCardForm({ ...emptyCard, accountId: accounts[0]?.id ?? "" });
      setCreateOpen(false);
      reload();
      toast({ title: `${name} を追加しました` });
    } catch (createError) {
      toast({ title: "カードの追加に失敗しました", description: describeError(createError), variant: "error" });
    }
  };

  const updateCard = async (card: CreditCard) => {
    await apiFetch(`/api/credit-cards/${card.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: card.name,
        settlementDay: card.settlementDay,
        dateShiftPolicy: card.dateShiftPolicy,
        accountId: card.accountId,
        assumptionAmount: card.assumptionAmount,
        sortOrder: card.sortOrder,
      }),
    });
    reload();
  };

  const requestDelete = (card: CreditCard) => setDeletingCard(card);

  const confirmDelete = async () => {
    if (!deletingCard) {
      return;
    }

    try {
      await apiFetch(`/api/credit-cards/${deletingCard.id}`, { method: "DELETE" });
      toast({ title: `${deletingCard.name} を削除しました` });
      setDeletingCard(null);
      reload();
    } catch (deleteError) {
      toast({ title: "削除に失敗しました", description: describeError(deleteError), variant: "error" });
    }
  };

  const saveBilling = async () => {
    if (!canSaveBilling) {
      return;
    }

    try {
      await apiFetch(`/api/billings/${yearMonth}`, {
        method: "PUT",
        body: JSON.stringify({
          items: (data?.cards ?? []).map((card) => ({
            creditCardId: card.id,
            amount: amounts[card.id] ?? 0,
          })),
        }),
      });
      reload();
      toast({ title: "月次請求を保存しました" });
    } catch (billingError) {
      toast({ title: "月次請求の保存に失敗しました", description: describeError(billingError), variant: "error" });
    }
  };

  const updateBillingAmount = (cardId: string, amount: number) => {
    setEditedYearMonth(yearMonth);
    setEditedAmounts((current) => ({
      ...current,
      [cardId]: amount,
    }));
  };

  const [pendingYearMonth, setPendingYearMonth] = useState<string | null>(null);

  const changeYearMonth = (nextYearMonth: string) => {
    if (isBillingDirty) {
      setPendingYearMonth(nextYearMonth);
      return;
    }

    setYearMonth(nextYearMonth);
    setEditedAmounts({});
    setEditedYearMonth(null);
  };

  const confirmChangeYearMonth = () => {
    if (!pendingYearMonth) {
      return;
    }

    setYearMonth(pendingYearMonth);
    setEditedAmounts({});
    setEditedYearMonth(null);
    setPendingYearMonth(null);
  };

  const openEdit = (card: CreditCard) => {
    setEditingCard(card);
    setAssumptionSuggestion(null);
    setAssumptionSuggestionError(null);
    setEditForm({
      name: card.name,
      settlementDay: card.settlementDay,
      dateShiftPolicy: card.dateShiftPolicy,
      accountId: card.accountId ?? "",
      assumptionAmount: card.assumptionAmount,
      sortOrder: card.sortOrder,
    });
  };

  const loadAssumptionSuggestion = async (cardId: string) => {
    setAssumptionSuggestionLoading(true);
    setAssumptionSuggestionError(null);
    try {
      const suggestion = await apiFetch<CreditCardAssumptionSuggestionResponse>(
        `/api/credit-cards/${cardId}/assumption-suggestion?months=6`,
      );
      setAssumptionSuggestion(suggestion);
    } catch (suggestionError) {
      setAssumptionSuggestion(null);
      setAssumptionSuggestionError(suggestionError instanceof Error ? suggestionError.message : "提案を取得できませんでした");
    } finally {
      setAssumptionSuggestionLoading(false);
    }
  };

  const closeEdit = () => {
    setEditingCard(null);
    setEditForm(emptyCard);
    setAssumptionSuggestion(null);
    setAssumptionSuggestionError(null);
  };

  const saveEdit = async () => {
    if (!editingCard) {
      return;
    }

    try {
      await updateCard({
        ...editingCard,
        ...editForm,
        accountId: editForm.accountId,
        account: accounts.find((account) => account.id === editForm.accountId) ?? null,
      });
      closeEdit();
      toast({ title: `${editForm.name} を更新しました` });
    } catch (updateError) {
      toast({ title: "更新に失敗しました", description: describeError(updateError), variant: "error" });
    }
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setCardForm({ ...emptyCard, accountId: accounts[0]?.id ?? "" });
  };

  const cardColumns: ResponsiveTableColumn<CreditCard>[] = [
    { key: "name", header: "カード名", render: (card) => card.name },
    { key: "day", header: "引落日", render: (card) => card.settlementDay ?? "-" },
    { key: "account", header: "引き落とし口座", render: (card) => card.account?.name ?? "未設定" },
    { key: "assumption", header: "月間仮定額", align: "right", mono: true, render: (card) => formatCurrency(card.assumptionAmount) },
    { key: "sortOrder", header: "表示順", mono: true, render: (card) => card.sortOrder },
    {
      key: "actions",
      header: "",
      render: (card) => (
        <div className="flex justify-end gap-1">
          <IconButton aria-label="編集" onClick={() => openEdit(card)}>
            <Pencil aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <IconButton aria-label="削除" variant="danger" onClick={() => requestDelete(card)}>
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
          <h2 className="text-2xl font-semibold">クレジットカード管理</h2>
          <p className="mt-2 text-sm text-ink-2">カードマスタと月別請求額を管理します。</p>
        </div>
        <Button className="min-h-10 gap-2" onClick={() => setCreateOpen(true)}>
          <span className="text-lg leading-none">+</span>
          カードを追加
        </Button>
      </div>

      <Card className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">月別請求入力</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-2">
              <span>{isBillingDirty ? "未保存の変更あり" : "保存済み"}</span>
              {hasBillingErrors ? <span className="text-critical">入力エラーがあります</span> : null}
            </div>
          </div>
          <Button disabled={!canSaveBilling} onClick={saveBilling}>
            月次請求を保存
          </Button>
        </div>
        <div className="flex justify-start">
          <Input className="max-w-44" type="month" value={yearMonth} onChange={(event) => changeYearMonth(event.target.value)} />
        </div>
        <div className="grid min-w-0 gap-4 self-start">
          <div className="hidden min-w-0 md:block">
            <TableWrapper>
              <Table className="w-full">
                <thead>
                  <tr className="border-b border-line text-left text-xs font-medium text-ink-3">
                    <th scope="col" className="px-3 py-3">カード名</th>
                    <th scope="col" className="px-3 py-3">引き落とし口座</th>
                    <th scope="col" className="px-3 py-3">引落日</th>
                    <th scope="col" className="px-3 py-3">仮定額</th>
                    <th scope="col" className="px-3 py-3">実額入力</th>
                    <th scope="col" className="px-3 py-3">適用額</th>
                    <th scope="col" className="px-3 py-3">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {billingRows.map((row) => (
                    <BillingTableRow key={row.card.id} row={row} onAmountChange={updateBillingAmount} />
                  ))}
                </tbody>
                <tfoot>
                  <BillingTotalsRow totals={billingTotals} />
                </tfoot>
              </Table>
            </TableWrapper>
          </div>
          <div className="grid gap-3 md:hidden">
            {billingRows.map((row) => (
              <BillingMobileCard key={row.card.id} row={row} onAmountChange={updateBillingAmount} />
            ))}
            <BillingMobileTotals totals={billingTotals} />
          </div>
        </div>
      </Card>

      <Card className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">カード一覧</h2>
          <div className="text-sm text-ink-2">{loading ? "読み込み中..." : `${data?.cards.length ?? 0} 件`}</div>
        </div>
        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : (
          <ResponsiveTable
            columns={cardColumns}
            rows={data?.cards ?? []}
            rowKey={(card) => card.id}
            emptyMessage="カードが登録されていません。上部の「カードを追加」から登録してください。"
            mobileRow={(card) => (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{card.name}</div>
                    <div className="text-xs text-ink-3">毎月 {card.settlementDay ?? 27} 日・{card.account?.name ?? "未設定"}</div>
                  </div>
                  <div className="font-data text-base font-semibold">{formatCurrency(card.assumptionAmount)}</div>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-ink-3">
                  <span>表示順 {card.sortOrder}</span>
                  <div className="flex gap-1">
                    <IconButton aria-label="編集" onClick={() => openEdit(card)}>
                      <Pencil aria-hidden="true" className="h-4 w-4" />
                    </IconButton>
                    <IconButton aria-label="削除" variant="danger" onClick={() => requestDelete(card)}>
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
          <DialogTitle className="text-lg font-semibold">カードを追加</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">カード情報を登録します。</DialogDescription>
          <CreditCardEditModal
            accounts={accounts}
            form={cardForm}
            onChange={setCardForm}
            canSave={canCreate}
            actionLabel="追加"
            onCancel={closeCreate}
            onSave={createCard}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingCard)} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">カードを編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">カード情報を更新します。</DialogDescription>
          <CreditCardEditModal
            accounts={accounts}
            form={editForm}
            onChange={setEditForm}
            canSave={canSaveEdit}
            suggestion={assumptionSuggestion}
            suggestionLoading={assumptionSuggestionLoading}
            suggestionError={assumptionSuggestionError}
            onRequestSuggestion={() => editingCard && loadAssumptionSuggestion(editingCard.id)}
            onApplySuggestion={(amount) => setEditForm((current) => ({ ...current, assumptionAmount: amount }))}
            onCancel={closeEdit}
            onSave={saveEdit}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deletingCard)}
        onOpenChange={(open) => !open && setDeletingCard(null)}
        title="カードを削除しますか？"
        description={deletingCard ? `「${deletingCard.name}」を削除します。この操作は取り消せません。` : undefined}
        onConfirm={confirmDelete}
      />

      <ConfirmDialog
        open={Boolean(pendingYearMonth)}
        onOpenChange={(open) => !open && setPendingYearMonth(null)}
        title="未保存の月次請求があります"
        description="月を切り替えると入力中の請求額は破棄されます。切り替えますか？"
        confirmLabel="切り替える"
        danger={false}
        onConfirm={confirmChangeYearMonth}
      />
    </div>
  );
}

function BillingAmountInput({
  row,
  onAmountChange,
}: {
  row: BillingRow;
  onAmountChange: (cardId: string, amount: number) => void;
}) {
  return (
    <div className="grid gap-1">
      <Input
        aria-label={`${row.card.name} 実額`}
        data-billing-amount-input="true"
        type="number"
        min={0}
        max={INT4_MAX}
        value={row.inputAmount}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key !== "Enter") {
            return;
          }

          event.preventDefault();
          focusNextBillingInput(event.currentTarget);
        }}
        onChange={(event) => onAmountChange(row.card.id, Number(event.target.value))}
      />
      {row.error ? (
        <div role="alert" className="text-xs font-medium text-critical">
          {row.error}
        </div>
      ) : null}
    </div>
  );
}

function BillingStatusBadge({ row }: { row: BillingRow }) {
  return (
    <Badge tone={row.resolvedAmount.usesActual ? "success" : "warning"}>
      {row.resolvedAmount.usesActual ? "実額を使用" : "仮定値を使用"}
    </Badge>
  );
}

function BillingTableRow({
  row,
  onAmountChange,
}: {
  row: BillingRow;
  onAmountChange: (cardId: string, amount: number) => void;
}) {
  return (
    <tr className="border-b border-line">
      <td className="px-3 py-3 align-top font-medium">{row.card.name}</td>
      <td className="px-3 py-3 align-top text-ink-2">{row.card.account?.name ?? "未設定"}</td>
      <td className="px-3 py-3 align-top text-ink-2">毎月 {row.card.settlementDay ?? 27} 日</td>
      <td className="font-data px-3 py-3 align-top">{formatCurrency(row.card.assumptionAmount)}</td>
      <td className="px-3 py-3 align-top">
        <BillingAmountInput row={row} onAmountChange={onAmountChange} />
      </td>
      <td className="font-data px-3 py-3 align-top">{formatCurrency(row.resolvedAmount.amount)}</td>
      <td className="px-3 py-3 align-top">
        <BillingStatusBadge row={row} />
      </td>
    </tr>
  );
}

function BillingTotalsRow({ totals }: { totals: BillingTotals }) {
  return (
    <tr className="border-t border-dashed border-line-strong bg-surface-2/60 font-semibold">
      <td className="px-3 py-4 text-ink">合計</td>
      <td className="px-3 py-4 text-ink-3">---------</td>
      <td className="px-3 py-4 text-ink-3">---------</td>
      <td className="font-data px-3 py-4">{formatCurrency(totals.assumptionTotal)}</td>
      <td className="font-data px-3 py-4">{formatCurrency(totals.actualTotal)}</td>
      <td className="font-data px-3 py-4">{formatCurrency(totals.appliedTotal)}</td>
      <td className="px-3 py-4" />
    </tr>
  );
}

function BillingMobileCard({
  row,
  onAmountChange,
}: {
  row: BillingRow;
  onAmountChange: (cardId: string, amount: number) => void;
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-line p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 break-words font-medium">{row.card.name}</span>
        <BillingStatusBadge row={row} />
      </div>
      <div className="grid gap-2 text-xs text-ink-2">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
          <span className="text-ink-3">口座</span>
          <span className="min-w-0 break-words text-right text-sm text-ink">{row.card.account?.name ?? "未設定"}</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
          <span className="text-ink-3">引落日</span>
          <span className="text-sm text-ink">毎月 {row.card.settlementDay ?? 27} 日</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
          <span className="text-ink-3">仮定額</span>
          <span className="font-data text-sm text-ink">{formatCurrency(row.card.assumptionAmount)}</span>
        </div>
      </div>
      <label className="grid gap-2">
        <span className="text-xs text-ink-3">実額入力</span>
        <BillingAmountInput row={row} onAmountChange={onAmountChange} />
      </label>
      <div className="flex items-center justify-between gap-3 text-ink-2">
        <span>適用額</span>
        <span className="font-data">{formatCurrency(row.resolvedAmount.amount)}</span>
      </div>
    </div>
  );
}

function BillingMobileTotals({ totals }: { totals: BillingTotals }) {
  return (
    <div className="grid gap-3 border-t border-dashed border-line-strong pt-4 text-sm">
      <div className="font-semibold">合計</div>
      <div className="grid gap-2 text-xs text-ink-2">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
          <span className="text-ink-3">仮定値合計</span>
          <span className="font-data text-sm font-semibold text-ink">{formatCurrency(totals.assumptionTotal)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
          <span className="text-ink-3">実績入力合計</span>
          <span className="font-data text-sm font-semibold text-ink">{formatCurrency(totals.actualTotal)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
          <span className="text-ink-3">適用額合計</span>
          <span className="font-data text-sm font-semibold text-ink">{formatCurrency(totals.appliedTotal)}</span>
        </div>
      </div>
    </div>
  );
}

function CreditCardEditModal({
  accounts,
  form,
  onChange,
  canSave,
  suggestion,
  suggestionLoading = false,
  suggestionError,
  onRequestSuggestion,
  onApplySuggestion,
  onCancel,
  onSave,
  actionLabel = "保存",
}: {
  accounts: Account[];
  form: CreditCardForm;
  onChange: (next: CreditCardForm) => void;
  canSave: boolean;
  suggestion?: CreditCardAssumptionSuggestionResponse | null;
  suggestionLoading?: boolean;
  suggestionError?: string | null;
  onRequestSuggestion?: () => void;
  onApplySuggestion?: (amount: number) => void;
  onCancel: () => void;
  onSave: () => void;
  actionLabel?: string;
}) {
  const nameId = useId();
  const amountId = useId();
  const sortOrderId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const missing: string[] = [];
  if (form.name.trim().length === 0) missing.push("カード名");
  if (form.accountId === "") missing.push("引き落とし口座");

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
      <FormField label="カード名" htmlFor={nameId} required>
        <Input id={nameId} ref={firstFieldRef} value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} />
      </FormField>

      <FormField label="月間仮定額" htmlFor={amountId} required>
        <MoneyInput id={amountId} currencyCode="JPY" value={form.assumptionAmount} onChange={(value) => onChange({ ...form, assumptionAmount: value })} />
      </FormField>

      {onRequestSuggestion ? (
        <div className="grid gap-2 rounded-xl border border-line bg-surface-2 p-3 text-xs text-ink-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-ink-2">過去実績の提案</span>
            <Button type="button" variant="ghost" className="min-h-9 px-3 py-1.5 text-xs" disabled={suggestionLoading} onClick={onRequestSuggestion}>
              {suggestionLoading ? "取得中..." : "過去実績から提案"}
            </Button>
          </div>
          {suggestionLoading ? <div>読み込み中...</div> : null}
          {suggestionError ? (
            <div role="alert" className="break-words font-medium text-critical">
              {suggestionError}
            </div>
          ) : null}
          {suggestion ? (
            suggestion.suggestedAmount === null ? (
              <div className="break-words">提案できる過去実額がありません。</div>
            ) : (
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="success">中央値</Badge>
                  <span className="font-data font-medium text-ink">提案額 {formatCurrency(suggestion.suggestedAmount)}</span>
                  <span>{suggestion.sampleCount} 件</span>
                </div>
                <div className="break-words">対象月: {suggestion.sourceYearMonths.join(", ")}</div>
                <div className="flex justify-end">
                  <Button type="button" variant="ghost" className="min-h-9 px-3 py-1.5 text-xs" onClick={() => onApplySuggestion?.(suggestion.suggestedAmount ?? 0)}>
                    反映
                  </Button>
                </div>
              </div>
            )
          ) : null}
        </div>
      ) : null}

      <DayOfMonthField
        id="credit-card-day"
        required={false}
        value={form.settlementDay}
        onChange={(value) => onChange({ ...form, settlementDay: value })}
      />

      <AccountSelect
        id="credit-card-account"
        label="引き落とし口座"
        accounts={accounts}
        value={form.accountId}
        onChange={(accountId) => onChange({ ...form, accountId })}
      />

      <DateShiftField id="credit-card-date-shift" value={form.dateShiftPolicy} onChange={(dateShiftPolicy) => onChange({ ...form, dateShiftPolicy })} />

      <Disclosure summary="詳細設定">
        <FormField label="表示順" htmlFor={sortOrderId}>
          <Input id={sortOrderId} type="number" value={form.sortOrder} onChange={(event) => onChange({ ...form, sortOrder: Number(event.target.value) })} />
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
