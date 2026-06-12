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

function getMonthOffset(currentYearMonth: string, targetYearMonth: string) {
  const currentTotalMonths =
    Number(currentYearMonth.slice(0, 4)) * 12 + Number(currentYearMonth.slice(5, 7)) - 1;
  const targetTotalMonths =
    Number(targetYearMonth.slice(0, 4)) * 12 + Number(targetYearMonth.slice(5, 7)) - 1;

  return targetTotalMonths - currentTotalMonths;
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
  const amounts =
    editedYearMonth === yearMonth
      ? {
          ...billingAmounts,
          ...editedAmounts,
        }
      : billingAmounts;
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
        <h2 className="text-xl font-semibold">月別請求入力</h2>
        <div className="flex justify-start">
          <Input className="max-w-44" type="month" value={yearMonth} onChange={(event) => setYearMonth(event.target.value)} />
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="grid gap-4 self-start">
            <div className="grid gap-3">
              {(data?.cards ?? []).map((card) => {
                const actualAmount = data?.billing.items.find((item) => item.creditCardId === card.id)?.amount ?? null;
                const resolvedAmount = resolveAppliedCardAmount({
                  actualAmount,
                  assumptionAmount: card.assumptionAmount,
                  monthOffset,
                });

                return (
                  <div key={card.id} className="grid gap-2 rounded-2xl border border-white/10 p-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span>{card.name}</span>
                      <Badge tone={resolvedAmount.usesActual ? "success" : "danger"}>
                        {resolvedAmount.usesActual ? "実額を使用" : "仮定値を使用"}
                      </Badge>
                    </div>
                    <div className="grid gap-2 text-xs text-white/60 sm:grid-cols-3">
                      <div className="rounded-xl bg-white/5 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">口座</div>
                        <div className="mt-1 text-sm text-white">{card.account?.name ?? "未設定"}</div>
                      </div>
                      <div className="rounded-xl bg-white/5 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">引落日</div>
                        <div className="mt-1 text-sm text-white">毎月 {card.settlementDay ?? 27} 日</div>
                      </div>
                      <div className="rounded-xl bg-white/5 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-white/40">仮定額</div>
                        <div className="mt-1 text-sm text-white">{formatCurrency(card.assumptionAmount)}</div>
                      </div>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      max={INT4_MAX}
                      value={amounts[card.id] ?? 0}
                      onChange={(event) => {
                        setEditedYearMonth(yearMonth);
                        setEditedAmounts((current) => ({
                          ...current,
                          [card.id]: Number(event.target.value),
                        }));
                      }}
                    />
                    <div className="text-white/55">今月予測へ反映される額: {formatCurrency(resolvedAmount.amount)}</div>
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end">
              <Button disabled={(data?.cards ?? []).length === 0} onClick={saveBilling}>月次請求を保存</Button>
            </div>
          </div>
          <div className="grid min-w-0 self-start gap-4 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div>
              <div className="text-sm uppercase tracking-[0.18em] text-white/45">請求月サマリー</div>
              <div className="mt-3 text-3xl font-semibold">{formatCurrency(data?.billing.appliedTotal ?? 0)}</div>
              <div className="mt-1 text-xs text-white/40">実額 + 仮定値の合計</div>
            </div>
            <div className="break-words text-sm text-white/60">実額未入力のカードは仮定額で予測します。</div>
            <div className="break-words text-sm text-white/60">
              {loading ? "読み込み中..." : error ?? "入力済みカードと未入力カードを同じ月内で混在できます。"}
            </div>
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
        <DialogContent className="w-[min(92vw,36rem)]">
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
        <DialogContent className="w-[min(92vw,36rem)]">
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
