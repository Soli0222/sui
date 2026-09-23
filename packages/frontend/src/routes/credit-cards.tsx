import {
  INT4_MAX,
  getBillingMonthOffset,
  hasOverlappingAssumptions,
  isValidYearMonth,
  resolveBillingAmount,
  type BillingAssumption,
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
import { useAssumptionSuggestion } from "../hooks/use-assumption-suggestion";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { formatCurrency, normalizeCurrencyInputValue } from "../lib/format";
import { getCurrentYearMonth } from "../lib/utils";
import { addMonthsToYearMonth } from "../lib/dates";
import { Pencil, Trash2 } from "lucide-react";

type CreditCardForm = {
  name: string;
  settlementDay: number | null;
  dateShiftPolicy: DateShiftPolicy;
  accountId: string;
  assumptions: BillingAssumption[];
  sortOrder: number;
};

const emptyCard: CreditCardForm = {
  name: "",
  settlementDay: 27,
  dateShiftPolicy: "none",
  accountId: "",
  assumptions: [{ amount: 0, startMonth: null, endMonth: null }],
  sortOrder: 0,
};

type BillingRow = {
  card: CreditCard;
  inputAmount: number;
  actualAmount: number | null;
  resolvedAmount: ReturnType<typeof resolveBillingAmount>;
  error: string | null;
};

type BillingTotals = {
  assumptionTotal: number;
  actualTotal: number;
  appliedTotal: number;
};

function hasAmount(record: Record<string, number>, cardId: string) {
  return Object.prototype.hasOwnProperty.call(record, cardId);
}

function validAssumptionPeriods(form: CreditCardForm) {
  return !hasOverlappingAssumptions(form.assumptions) && form.assumptions.every((period) =>
    Number.isInteger(period.amount) && period.amount >= 0 && period.amount <= INT4_MAX
    && (period.startMonth === null || isValidYearMonth(period.startMonth))
    && (period.endMonth === null || isValidYearMonth(period.endMonth))
    && (period.startMonth === null || period.endMonth === null || period.startMonth <= period.endMonth));
}

function assumptionPeriod(period: BillingAssumption) {
  return `${period.startMonth ?? "制限なし"} 〜 ${period.endMonth ?? "制限なし"}`;
}

function AssumptionList({ card }: { card: CreditCard }) {
  return card.assumptions.length === 0 ? <span className="text-ink-3">設定なし</span> : (
    <div className="grid gap-1">
      {card.assumptions.map((period, index) => (
        <div key={index}><span className="font-data">{formatCurrency(period.amount)}</span> <span className="text-xs text-ink-3">{assumptionPeriod(period)}</span></div>
      ))}
    </div>
  );
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
  const [editSection, setEditSection] = useState<"prices" | "details">("prices");
  const [addingAssumption, setAddingAssumption] = useState(false);
  const [editingAssumptionIndex, setEditingAssumptionIndex] = useState<number | null>(null);
  const [deletingAssumptionIndex, setDeletingAssumptionIndex] = useState<number | null>(null);
  const [assumptionDraft, setAssumptionDraft] = useState<BillingAssumption>({ amount: 0, startMonth: null, endMonth: null });
  const [savingAssumption, setSavingAssumption] = useState(false);
  const [deletingCard, setDeletingCard] = useState<CreditCard | null>(null);
  const suggestionRequest = useAssumptionSuggestion();
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
  const monthOffset = getBillingMonthOffset(getCurrentYearMonth(), yearMonth);
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
        const resolvedAmount = resolveBillingAmount({
          actualAmount,
          assumptions: card.assumptions,
          yearMonth,
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
      assumptionTotal: totals.assumptionTotal + row.resolvedAmount.appliedAssumptionAmount,
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
    validAssumptionPeriods(cardForm) &&
    (cardForm.settlementDay === null || (cardForm.settlementDay >= 1 && cardForm.settlementDay <= 31));
  const canSaveEdit =
    editForm.name.trim().length > 0 &&
    editForm.accountId !== "" &&
    validAssumptionPeriods(editForm) &&
    (editForm.settlementDay === null || (editForm.settlementDay >= 1 && editForm.settlementDay <= 31));
  const draftAssumptions = editingCard ? (editingAssumptionIndex === null
    ? [...editingCard.assumptions, assumptionDraft]
    : editingCard.assumptions.map((period, index) => index === editingAssumptionIndex ? assumptionDraft : period)) : [];
  const canSaveAssumption = validAssumptionPeriods({ ...editForm, assumptions: draftAssumptions });

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
        assumptionAmount: card.assumptions[0]?.amount ?? 0,
        assumptions: card.assumptions,
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
          items: (data?.cards ?? []).filter((card) => hasAmount(amounts, card.id)).map((card) => ({
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

  const goToPreviousMonth = () => {
    changeYearMonth(addMonthsToYearMonth(yearMonth, -1));
  };

  const goToNextMonth = () => {
    changeYearMonth(addMonthsToYearMonth(yearMonth, 1));
  };

  const openEdit = (card: CreditCard) => {
    setEditingCard(card);
    setEditSection("prices");
    setAddingAssumption(false);
    setEditingAssumptionIndex(null);
    setDeletingAssumptionIndex(null);
    suggestionRequest.reset();
    setEditForm({
      name: card.name,
      settlementDay: card.settlementDay,
      dateShiftPolicy: card.dateShiftPolicy,
      accountId: card.accountId ?? "",
      assumptions: card.assumptions.map(({ amount, startMonth, endMonth }) => ({ amount, startMonth, endMonth })),
      sortOrder: card.sortOrder,
    });
  };

  const closeEdit = () => {
    setEditingCard(null);
    setEditForm(emptyCard);
    setAddingAssumption(false);
    setEditingAssumptionIndex(null);
    setDeletingAssumptionIndex(null);
    suggestionRequest.reset();
  };

  const startAddingAssumption = () => {
    setEditingAssumptionIndex(null);
    setAssumptionDraft({ amount: editingCard?.assumptions.at(-1)?.amount ?? 0, startMonth: null, endMonth: null });
    setAddingAssumption(true);
  };

  const startEditingAssumption = (index: number) => {
    const period = editingCard?.assumptions[index];
    if (!period) return;
    setAddingAssumption(false);
    setEditingAssumptionIndex(index);
    setAssumptionDraft({ amount: period.amount, startMonth: period.startMonth, endMonth: period.endMonth });
  };

  const applySuggestion = (amount: number) => {
    const lastIndex = (editingCard?.assumptions.length ?? 0) - 1;
    if (lastIndex < 0) {
      setAddingAssumption(true);
      setEditingAssumptionIndex(null);
      setAssumptionDraft({ amount, startMonth: null, endMonth: null });
    } else {
      startEditingAssumption(lastIndex);
      setAssumptionDraft((editingCard?.assumptions[lastIndex]) ? { ...editingCard.assumptions[lastIndex], amount } : { amount, startMonth: null, endMonth: null });
    }
  };

  const persistAssumptions = async (assumptions: BillingAssumption[], successTitle: string) => {
    if (!editingCard) return false;
    setSavingAssumption(true);
    try {
      const updatedCard = { ...editingCard, assumptions, assumptionAmount: assumptions[0]?.amount ?? 0 };
      await updateCard(updatedCard);
      setEditingCard(updatedCard);
      setEditForm((current) => ({ ...current, assumptions }));
      toast({ title: successTitle });
      return true;
    } catch (updateError) {
      toast({ title: "仮定額の保存に失敗しました", description: describeError(updateError), variant: "error" });
      return false;
    } finally {
      setSavingAssumption(false);
    }
  };

  const saveAssumption = async () => {
    if (!editingCard) return;
    const assumptions = editingAssumptionIndex === null
      ? [...editingCard.assumptions, assumptionDraft]
      : editingCard.assumptions.map((period, index) => index === editingAssumptionIndex ? assumptionDraft : period);
    if (!validAssumptionPeriods({ ...editForm, assumptions })) return;
    if (await persistAssumptions(assumptions, editingAssumptionIndex === null ? "仮定額の期間を追加しました" : "仮定額の期間を訂正しました")) {
      setAddingAssumption(false);
      setEditingAssumptionIndex(null);
    }
  };

  const deleteAssumption = async () => {
    if (!editingCard || deletingAssumptionIndex === null) return;
    const assumptions = editingCard.assumptions.filter((_, index) => index !== deletingAssumptionIndex);
    if (await persistAssumptions(assumptions, "仮定額の期間を削除しました")) {
      setDeletingAssumptionIndex(null);
      setAddingAssumption(false);
      setEditingAssumptionIndex(null);
    }
  };

  const saveEdit = async () => {
    if (!editingCard) {
      return;
    }

    try {
      await updateCard({
        ...editingCard,
        ...editForm,
        assumptionAmount: editForm.assumptions[0]?.amount ?? 0,
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
    { key: "assumptions", header: "仮定額と適用請求月", render: (card) => <AssumptionList card={card} /> },
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
        <div className="flex items-center gap-2">
          <Button variant="secondary" aria-label="前月" onClick={goToPreviousMonth}>
            前月
          </Button>
          <Input className="max-w-44" type="month" value={yearMonth} onChange={(event) => changeYearMonth(event.target.value)} />
          <Button variant="secondary" aria-label="次月" onClick={goToNextMonth}>
            次月
          </Button>
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
                    <th scope="col" className="px-3 py-3">この月の仮定額</th>
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
                    <AssumptionList card={card} />
                  </div>
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
          <div className="mt-5 flex gap-2 border-b border-line pb-3" aria-label="編集項目">
            <Button type="button" variant={editSection === "prices" ? "secondary" : "ghost"} onClick={() => setEditSection("prices")}>仮定額と適用請求月</Button>
            <Button type="button" variant={editSection === "details" ? "secondary" : "ghost"} onClick={() => setEditSection("details")}>基本情報</Button>
          </div>
          {editSection === "details" ? (
            <CreditCardEditModal
              accounts={accounts}
              form={editForm}
              onChange={setEditForm}
              canSave={canSaveEdit}
              showAssumptions={false}
              onCancel={closeEdit}
              onSave={saveEdit}
            />
          ) : editingCard ? (
            <section className="mt-4 grid gap-3" aria-label="仮定額と適用請求月">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-medium">仮定額の期間</div>
                <Button type="button" variant="secondary" className="shrink-0 whitespace-nowrap" onClick={startAddingAssumption}>期間を追加</Button>
              </div>
              <p className="text-xs text-ink-2">請求月で判定します。期間のない月でも登録済みの実額は残ります。</p>
              {editingCard.assumptions.length === 0 ? <p className="text-sm text-ink-3">仮定額の期間はありません。</p> : null}
              {editingCard.assumptions.map((period, index) => (
                <div key={index} className="rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-data font-medium">{formatCurrency(period.amount)}</div>
                      <div className="text-xs text-ink-3">{assumptionPeriod(period)}</div>
                    </div>
                    <div className="flex gap-1">
                      <IconButton aria-label={`仮定額 ${index + 1} の期間を訂正`} onClick={() => startEditingAssumption(index)}><Pencil aria-hidden="true" className="h-4 w-4" /></IconButton>
                      <IconButton aria-label={`仮定額 ${index + 1} の期間を削除`} variant="danger" onClick={() => setDeletingAssumptionIndex(index)}><Trash2 aria-hidden="true" className="h-4 w-4" /></IconButton>
                    </div>
                  </div>
                  {editingAssumptionIndex === index ? (
                    <div className="mt-3 grid gap-3 border-t border-line pt-3">
                      <AssumptionPeriodFields draft={assumptionDraft} onChange={setAssumptionDraft} />
                      <p className="text-xs text-ink-3">期間の訂正は過去の未確定予測も変える可能性があります。</p>
                      {!canSaveAssumption ? <p role="alert" className="text-xs text-critical">開始月・終了月と他の期間との重複を確認してください。</p> : null}
                      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setEditingAssumptionIndex(null)}>キャンセル</Button><Button type="button" disabled={!canSaveAssumption || savingAssumption} onClick={saveAssumption}>訂正を保存</Button></div>
                    </div>
                  ) : null}
                </div>
              ))}
              {addingAssumption ? (
                <div className="rounded-xl border border-line p-3">
                  <div className="font-medium">新しい仮定額</div>
                  <div className="mt-3 grid gap-3">
                    <AssumptionPeriodFields draft={assumptionDraft} onChange={setAssumptionDraft} />
                    {!canSaveAssumption ? <p role="alert" className="text-xs text-critical">開始月・終了月と他の期間との重複を確認してください。</p> : null}
                    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setAddingAssumption(false)}>キャンセル</Button><Button type="button" disabled={!canSaveAssumption || savingAssumption} onClick={saveAssumption}>追加を保存</Button></div>
                  </div>
                </div>
              ) : null}
              <AssumptionSuggestionPanel
                suggestion={suggestionRequest.suggestion}
                loading={suggestionRequest.loading}
                error={suggestionRequest.error}
                onRequest={() => suggestionRequest.load(editingCard.id)}
                onApply={applySuggestion}
              />
              <div className="flex justify-end border-t border-line pt-3"><Button type="button" variant="ghost" onClick={closeEdit}>閉じる</Button></div>
            </section>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deletingAssumptionIndex !== null}
        onOpenChange={(open) => !open && setDeletingAssumptionIndex(null)}
        title="仮定額の期間を削除しますか？"
        description={deletingAssumptionIndex !== null && editingCard ? `${assumptionPeriod(editingCard.assumptions[deletingAssumptionIndex])} の仮定額を削除します。過去の未確定予測も変える可能性があります。` : undefined}
        onConfirm={deleteAssumption}
      />

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
        type="text"
        inputMode="numeric"
        data-1p-ignore="true"
        value={row.inputAmount}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key !== "Enter") {
            return;
          }

          event.preventDefault();
          focusNextBillingInput(event.currentTarget);
        }}
        onChange={(event) => {
          const normalized = normalizeCurrencyInputValue(event.target.value, "JPY");
          if (normalized.valid) {
            onAmountChange(row.card.id, Number(normalized.value));
          }
        }}
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
  if (row.resolvedAmount.sourceType === "none") {
    return <Badge tone="warning">適用なし</Badge>;
  }
  return (
    <Badge tone={row.resolvedAmount.sourceType === "actual" ? "success" : "warning"}>
      {row.resolvedAmount.sourceType === "actual" ? "実額を使用" : "仮定値を使用"}
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
      <td className="font-data px-3 py-3 align-top">{formatCurrency(row.resolvedAmount.appliedAssumptionAmount)}</td>
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
          <span className="font-data text-sm text-ink">{formatCurrency(row.resolvedAmount.appliedAssumptionAmount)}</span>
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
  showAssumptions = true,
  onCancel,
  onSave,
  actionLabel = "保存",
}: {
  accounts: Account[];
  form: CreditCardForm;
  onChange: (next: CreditCardForm) => void;
  canSave: boolean;
  showAssumptions?: boolean;
  onCancel: () => void;
  onSave: () => void;
  actionLabel?: string;
}) {
  const nameId = useId();
  const periodId = useId();
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

      {showAssumptions ? <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="font-medium">仮定額の期間</div>
          <Button type="button" variant="secondary" className="shrink-0 whitespace-nowrap" onClick={() => onChange({ ...form, assumptions: [...form.assumptions, { amount: 0, startMonth: null, endMonth: null }] })}>期間を追加</Button>
        </div>
        <p className="text-xs text-ink-2">請求月で判定します。空欄は制限なし。設定のない月でも登録済みの実額は残ります。</p>
        {form.assumptions.map((period, index) => {
          const updatePeriod = (patch: Partial<BillingAssumption>) => onChange({
            ...form,
            assumptions: form.assumptions.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
          });
          return (
            <div key={index} className="grid gap-3 rounded-xl border border-line p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">仮定額 {index + 1}</span>
                <Button type="button" variant="ghost" onClick={() => onChange({ ...form, assumptions: form.assumptions.filter((_, itemIndex) => itemIndex !== index) })}>削除</Button>
              </div>
              <FormField label={`金額 ${index + 1}`} htmlFor={`${periodId}-${index}-amount`} required>
                <MoneyInput id={`${periodId}-${index}-amount`} currencyCode="JPY" value={period.amount} onChange={(amount) => updatePeriod({ amount })} />
              </FormField>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label={`開始月 ${index + 1}`} htmlFor={`${periodId}-${index}-start`}>
                  <Input id={`${periodId}-${index}-start`} type="month" value={period.startMonth ?? ""} onChange={(event) => updatePeriod({ startMonth: event.target.value || null })} />
                </FormField>
                <FormField label={`終了月 ${index + 1}`} htmlFor={`${periodId}-${index}-end`}>
                  <Input id={`${periodId}-${index}-end`} type="month" value={period.endMonth ?? ""} onChange={(event) => updatePeriod({ endMonth: event.target.value || null })} />
                </FormField>
              </div>
            </div>
          );
        })}
        {!validAssumptionPeriods(form) ? <div role="alert" className="text-xs text-critical">各期間の開始月・終了月と重複を確認してください。</div> : null}
      </div> : null}

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

function AssumptionPeriodFields({ draft, onChange }: { draft: BillingAssumption; onChange: (draft: BillingAssumption) => void }) {
  const amountId = useId();
  const startId = useId();
  const endId = useId();

  return (
    <>
      <FormField label="仮定額" htmlFor={amountId} required>
        <MoneyInput id={amountId} currencyCode="JPY" value={draft.amount} onChange={(amount) => onChange({ ...draft, amount })} />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="開始月" htmlFor={startId}>
          <Input id={startId} type="month" value={draft.startMonth ?? ""} onChange={(event) => onChange({ ...draft, startMonth: event.target.value || null })} />
        </FormField>
        <FormField label="終了月" htmlFor={endId}>
          <Input id={endId} type="month" value={draft.endMonth ?? ""} onChange={(event) => onChange({ ...draft, endMonth: event.target.value || null })} />
        </FormField>
      </div>
      <p className="text-xs text-ink-3">月が空欄ならその方向に制限はありません。期間を空けることもできます。</p>
    </>
  );
}

function AssumptionSuggestionPanel({
  suggestion,
  loading,
  error,
  onRequest,
  onApply,
}: {
  suggestion: CreditCardAssumptionSuggestionResponse | null;
  loading: boolean;
  error: string | null;
  onRequest: () => void;
  onApply: (amount: number) => void;
}) {
  return (
    <div className="grid gap-2 rounded-xl border border-line bg-surface-2 p-3 text-xs text-ink-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-ink-2">過去実績の提案</span>
        <Button type="button" variant="ghost" className="min-h-9 px-3 py-1.5 text-xs" disabled={loading} onClick={onRequest}>
          {loading ? "取得中..." : "過去実績から提案"}
        </Button>
      </div>
      {loading ? <div>読み込み中...</div> : null}
      {error ? <div role="alert" className="break-words font-medium text-critical">{error}</div> : null}
      {suggestion ? (
        suggestion.suggestedAmount === null ? (
          <div className="break-words">提案できる過去実額がありません。</div>
        ) : (
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">平均値</Badge>
              <span className="font-data font-medium text-ink">提案額 {formatCurrency(suggestion.suggestedAmount)}</span>
              <span>{suggestion.sampleCount} 件</span>
            </div>
            <div className="break-words">対象月: {suggestion.sourceYearMonths.join(", ")}</div>
            <div className="flex justify-end">
              <Button type="button" variant="ghost" className="min-h-9 px-3 py-1.5 text-xs" onClick={() => onApply(suggestion.suggestedAmount ?? 0)}>
                最後の期間に反映
              </Button>
            </div>
          </div>
        )
      ) : null}
    </div>
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
