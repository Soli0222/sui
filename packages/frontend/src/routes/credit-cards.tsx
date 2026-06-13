import {
  INT4_MAX,
  type Account,
  type BillingResponse,
  type CreditCard,
  type CreditCardAssumptionSuggestionResponse,
  type DateShiftPolicy,
} from "@sui/shared";
import { useMemo, useState, startTransition } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Table, TableWrapper } from "../components/ui/table";
import { useResource } from "../hooks/use-resource";
import { apiFetch } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { getCurrentYearMonth } from "../lib/utils";

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

export function CreditCardsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth());
  const [cardForm, setCardForm] = useState(emptyCard);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<CreditCard | null>(null);
  const [editForm, setEditForm] = useState<CreditCardForm>(emptyCard);
  const [assumptionSuggestion, setAssumptionSuggestion] = useState<CreditCardAssumptionSuggestionResponse | null>(null);
  const [assumptionSuggestionLoading, setAssumptionSuggestionLoading] = useState(false);
  const [assumptionSuggestionError, setAssumptionSuggestionError] = useState<string | null>(null);
  const [editedAmounts, setEditedAmounts] = useState<Record<string, number>>({});
  const [editedYearMonth, setEditedYearMonth] = useState<string | null>(null);

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
    await apiFetch("/api/credit-cards", {
      method: "POST",
      body: JSON.stringify(cardForm),
    });
    setCardForm({ ...emptyCard, accountId: accounts[0]?.id ?? "" });
    setCreateOpen(false);
    reload();
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

  const deleteCard = async (id: string) => {
    if (!window.confirm("このカードを削除します。よろしいですか？")) {
      return;
    }

    await apiFetch(`/api/credit-cards/${id}`, { method: "DELETE" });
    reload();
  };

  const saveBilling = async () => {
    if (!canSaveBilling) {
      return;
    }

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
  };

  const updateBillingAmount = (cardId: string, amount: number) => {
    setEditedYearMonth(yearMonth);
    setEditedAmounts((current) => ({
      ...current,
      [cardId]: amount,
    }));
  };

  const changeYearMonth = (nextYearMonth: string) => {
    if (isBillingDirty && !window.confirm("未保存の月次請求があります。月を切り替えますか？")) {
      return;
    }

    setYearMonth(nextYearMonth);
    setEditedAmounts({});
    setEditedYearMonth(null);
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
    } catch (error) {
      setAssumptionSuggestion(null);
      setAssumptionSuggestionError(error instanceof Error ? error.message : "提案を取得できませんでした");
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

    await updateCard({
      ...editingCard,
      ...editForm,
      accountId: editForm.accountId,
      account: accounts.find((account) => account.id === editForm.accountId) ?? null,
    });
    closeEdit();
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setCardForm({ ...emptyCard, accountId: accounts[0]?.id ?? "" });
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">クレジットカード管理</h2>
          <p className="mt-2 text-sm text-white/60">カードマスタと月別請求額を管理します。</p>
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
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-white/60">
              <span>{isBillingDirty ? "未保存の変更あり" : "保存済み"}</span>
              {hasBillingErrors ? <span className="text-pink-300">入力エラーがあります</span> : null}
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
              <Table className="min-w-[60rem]">
                <thead>
                  <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.18em] text-white/45">
                    <th className="px-3 py-3">カード名</th>
                    <th className="px-3 py-3">引き落とし口座</th>
                    <th className="px-3 py-3">引落日</th>
                    <th className="px-3 py-3">仮定額</th>
                    <th className="px-3 py-3">実額入力</th>
                    <th className="px-3 py-3">適用額</th>
                    <th className="px-3 py-3">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {billingRows.map((row) => (
                    <BillingTableRow
                      key={row.card.id}
                      row={row}
                      onAmountChange={updateBillingAmount}
                    />
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
          <div className="text-sm text-white/60">{loading ? "読み込み中..." : error ?? `${data?.cards.length ?? 0} 件`}</div>
        </div>
        <TableWrapper>
          <Table className="min-w-[56rem]">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.18em] text-white/45">
                <th className="px-3 py-3">カード名</th>
                <th className="px-3 py-3">引落日</th>
                <th className="px-3 py-3">引き落とし口座</th>
                <th className="px-3 py-3">月間仮定額</th>
                <th className="px-3 py-3">表示順</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {(data?.cards ?? []).map((card) => (
                <CardRow key={card.id} card={card} onEdit={openEdit} onDelete={deleteCard} />
              ))}
            </tbody>
          </Table>
        </TableWrapper>
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : closeCreate())}>
        <DialogContent className="w-[min(94vw,36rem)]">
          <DialogTitle className="text-lg font-semibold">カードを追加</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-white/60">
            カード情報を登録します。
          </DialogDescription>
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
        <DialogContent className="w-[min(94vw,36rem)]">
          <DialogTitle className="text-lg font-semibold">カードを編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-white/60">
            カード情報を更新します。
          </DialogDescription>
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
      {row.error ? <div className="text-xs text-pink-300">{row.error}</div> : null}
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
    <tr className="border-b border-white/5">
      <td className="px-3 py-3 align-top font-medium">{row.card.name}</td>
      <td className="px-3 py-3 align-top text-white/70">{row.card.account?.name ?? "未設定"}</td>
      <td className="px-3 py-3 align-top text-white/70">毎月 {row.card.settlementDay ?? 27} 日</td>
      <td className="px-3 py-3 align-top">{formatCurrency(row.card.assumptionAmount)}</td>
      <td className="px-3 py-3 align-top">
        <BillingAmountInput row={row} onAmountChange={onAmountChange} />
      </td>
      <td className="px-3 py-3 align-top">{formatCurrency(row.resolvedAmount.amount)}</td>
      <td className="px-3 py-3 align-top">
        <BillingStatusBadge row={row} />
      </td>
    </tr>
  );
}

function BillingTotalsRow({ totals }: { totals: BillingTotals }) {
  return (
    <tr className="border-t border-dashed border-white/30 bg-white/[0.03] font-semibold">
      <td className="px-3 py-4 text-white">合計</td>
      <td className="px-3 py-4 text-white/30">---------</td>
      <td className="px-3 py-4 text-white/30">---------</td>
      <td className="px-3 py-4">{formatCurrency(totals.assumptionTotal)}</td>
      <td className="px-3 py-4">{formatCurrency(totals.actualTotal)}</td>
      <td className="px-3 py-4">{formatCurrency(totals.appliedTotal)}</td>
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
    <div className="grid gap-3 rounded-2xl border border-white/10 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="min-w-0 break-words font-medium">{row.card.name}</span>
        <BillingStatusBadge row={row} />
      </div>
      <div className="grid gap-2 text-xs text-white/60">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2">
          <span className="text-white/45">口座</span>
          <span className="min-w-0 break-words text-right text-sm text-white">{row.card.account?.name ?? "未設定"}</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2">
          <span className="text-white/45">引落日</span>
          <span className="text-sm text-white">毎月 {row.card.settlementDay ?? 27} 日</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2">
          <span className="text-white/45">仮定額</span>
          <span className="text-sm text-white">{formatCurrency(row.card.assumptionAmount)}</span>
        </div>
      </div>
      <label className="grid gap-2">
        <span className="text-xs text-white/45">実額入力</span>
        <BillingAmountInput row={row} onAmountChange={onAmountChange} />
      </label>
      <div className="flex items-center justify-between gap-3 text-white/70">
        <span>適用額</span>
        <span>{formatCurrency(row.resolvedAmount.amount)}</span>
      </div>
    </div>
  );
}

function BillingMobileTotals({ totals }: { totals: BillingTotals }) {
  return (
    <div className="grid gap-3 border-t border-dashed border-white/30 pt-4 text-sm">
      <div className="font-semibold">合計</div>
      <div className="grid gap-2 text-xs text-white/60">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2">
          <span className="text-white/45">仮定値合計</span>
          <span className="text-sm font-semibold text-white">{formatCurrency(totals.assumptionTotal)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2">
          <span className="text-white/45">実績入力合計</span>
          <span className="text-sm font-semibold text-white">{formatCurrency(totals.actualTotal)}</span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2">
          <span className="text-white/45">適用額合計</span>
          <span className="text-sm font-semibold text-white">{formatCurrency(totals.appliedTotal)}</span>
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
  return (
    <div className="mt-6 grid gap-5">
      <section className="grid gap-4">
        <div className="text-xs uppercase tracking-[0.18em] text-white/45">基本情報</div>
        <div className="grid gap-4 md:grid-cols-2">
          <CreditCardFormFields
            accounts={accounts}
            form={form}
            onChange={onChange}
            suggestion={suggestion}
            suggestionLoading={suggestionLoading}
            suggestionError={suggestionError}
            onRequestSuggestion={onRequestSuggestion}
            onApplySuggestion={onApplySuggestion}
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

function CreditCardFormFields({
  accounts,
  form,
  onChange,
  suggestion,
  suggestionLoading = false,
  suggestionError,
  onRequestSuggestion,
  onApplySuggestion,
}: {
  accounts: Account[];
  form: CreditCardForm;
  onChange: (next: CreditCardForm) => void;
  suggestion?: CreditCardAssumptionSuggestionResponse | null;
  suggestionLoading?: boolean;
  suggestionError?: string | null;
  onRequestSuggestion?: () => void;
  onApplySuggestion?: (amount: number) => void;
}) {
  return (
    <>
      <label className="grid gap-2 text-sm">
        <span>カード名 *</span>
        <Input required value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} />
      </label>
      <label className="grid gap-2 text-sm">
        <span>引落日 (1-31)</span>
        <Input type="number" min={1} max={31} value={form.settlementDay ?? ""} onChange={(event) => onChange({ ...form, settlementDay: event.target.value === "" ? null : Number(event.target.value) })} />
      </label>
      <label className="grid gap-2 text-sm">
        <span>引き落とし口座 *</span>
        <Select value={form.accountId} onChange={(event) => onChange({ ...form, accountId: event.target.value })}>
          <option value="">口座を選択</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="grid gap-2 text-sm">
        <span>土日祝の扱い</span>
        <DateShiftSelect value={form.dateShiftPolicy} onChange={(dateShiftPolicy) => onChange({ ...form, dateShiftPolicy })} />
      </label>
      <div className="grid gap-2 text-sm">
        <label className="grid gap-2">
          <span>月間仮定額 *</span>
          <Input type="number" min={0} max={INT4_MAX} value={form.assumptionAmount} onChange={(event) => onChange({ ...form, assumptionAmount: Number(event.target.value) })} />
        </label>
        {onRequestSuggestion ? (
          <div className="grid gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/60">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-white/75">過去実績の提案</span>
              <Button type="button" variant="ghost" className="min-h-9 px-3 py-1.5 text-xs" disabled={suggestionLoading} onClick={onRequestSuggestion}>
                {suggestionLoading ? "取得中..." : "過去実績から提案"}
              </Button>
            </div>
            {suggestionError ? <div className="break-words text-pink-300">{suggestionError}</div> : null}
            {suggestion ? (
              suggestion.suggestedAmount === null ? (
                <div className="break-words">提案できる過去実額がありません。</div>
              ) : (
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="success">中央値</Badge>
                    <span className="font-medium text-white">提案額 {formatCurrency(suggestion.suggestedAmount)}</span>
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
      </div>
      <label className="grid gap-2 text-sm md:col-span-2">
        <span>表示順</span>
        <Input type="number" value={form.sortOrder} onChange={(event) => onChange({ ...form, sortOrder: Number(event.target.value) })} />
      </label>
    </>
  );
}

function DateShiftSelect({
  value,
  onChange,
}: {
  value: DateShiftPolicy;
  onChange: (value: DateShiftPolicy) => void;
}) {
  return (
    <Select value={value} onChange={(event) => onChange(event.target.value as DateShiftPolicy)}>
      <option value="none">シフトなし</option>
      <option value="previous">前営業日</option>
      <option value="next">後営業日</option>
    </Select>
  );
}

function CardRow({
  card,
  onEdit,
  onDelete,
}: {
  card: CreditCard;
  onEdit: (card: CreditCard) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <tr className="border-b border-white/5">
      <td className="px-3 py-3">{card.name}</td>
      <td className="px-3 py-3">{card.settlementDay ?? "-"}</td>
      <td className="px-3 py-3">{card.account?.name ?? "未設定"}</td>
      <td className="px-3 py-3">{formatCurrency(card.assumptionAmount)}</td>
      <td className="px-3 py-3">{card.sortOrder}</td>
      <td className="px-3 py-3">
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onEdit(card)}>
            編集
          </Button>
          <Button variant="danger" onClick={() => onDelete(card.id)}>
            削除
          </Button>
        </div>
      </td>
    </tr>
  );
}
