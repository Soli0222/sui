import { INT4_MAX, getBillingMonthOffset, resolveBillingAmount, type Account, type BillingResponse, type CreditCard } from "@sui/shared";
import { startTransition, useEffect, useId, useMemo, useRef, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Input } from "../components/ui/input";
import { ResponsiveTable, type ResponsiveTableColumn } from "../components/ui/responsive-table";
import { Table, TableWrapper } from "../components/ui/table";
import { useEditingNavigation } from "../components/editing/editing-navigation";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { formatCurrency, formatCurrencyInputValue } from "../lib/format";
import { getCurrentYearMonth } from "../lib/utils";
import { addMonthsToYearMonth } from "../lib/dates";
import { readMoneyDraft } from "../components/ui/money-input";
import { Pencil, Trash2 } from "lucide-react";
import { CreditCardCreateModal, CreditCardEditorLayout, type CardSelection } from "./credit-card-editor";

type BillingRow = { card: CreditCard; inputAmount: string; actualAmount: number | null; resolvedAmount: ReturnType<typeof resolveBillingAmount>; error: string | null };
type BillingTotals = { assumptionTotal: number; actualTotal: number; appliedTotal: number };
function hasAmount(record: Record<string, string>, cardId: string) { return Object.prototype.hasOwnProperty.call(record, cardId); }
function assumptionPeriod(period: CreditCard["assumptions"][number]) { return `${period.startMonth ?? "制限なし"} 〜 ${period.endMonth ?? "制限なし"}`; }
function AssumptionList({ card }: { card: CreditCard }) { return card.assumptions.length === 0 ? <span className="text-ink-3">設定なし</span> : <div className="grid gap-1">{card.assumptions.map((period, i) => <div key={i}><span className="font-data">{formatCurrency(period.amount)}</span> <span className="text-xs text-ink-3">{assumptionPeriod(period)}</span></div>)}</div>; }
function amountError(raw: string) {
  if (raw === "") return null;
  const parsed = readMoneyDraft(raw, "JPY");
  if (parsed.kind !== "valid" || parsed.minorUnits === null) return "整数で入力してください";
  if (parsed.minorUnits < 0) return "0円以上で入力してください";
  if (parsed.minorUnits > INT4_MAX) return `${INT4_MAX.toLocaleString("ja-JP")}円以下で入力してください`;
  return null;
}
function focusNextBillingInput(currentInput: HTMLInputElement) {
  const visible = Array.from(document.querySelectorAll<HTMLInputElement>("[data-billing-amount-input='true']")).filter((input) => input.offsetParent !== null);
  const next = visible[visible.indexOf(currentInput) + 1]; next?.focus(); next?.select();
}
function describeError(error: unknown) { return error instanceof Error ? error.message : "不明なエラーが発生しました。"; }

export function CreditCardsPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth);
  const [createOpen, setCreateOpen] = useState(false);
  const [selection, setSelection] = useState<CardSelection | null>(null);
  const [selectionKey, setSelectionKey] = useState(0);
  const transitionRef = useRef<((action: () => void) => void) | null>(null);
  const [deletingCard, setDeletingCard] = useState<CreditCard | null>(null);
  const [editedAmounts, setEditedAmounts] = useState<Record<string, string>>({});
  const [editedYearMonth, setEditedYearMonth] = useState<string | null>(null);
  const [billingSaving, setBillingSaving] = useState(false);
  const billingSavingRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshRequestRef = useRef(0);
  const currentMonthRef = useRef(yearMonth);
  useEffect(() => { currentMonthRef.current = yearMonth; }, [yearMonth]);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingRefreshError, setBillingRefreshError] = useState<string | null>(null);
  const [pendingYearMonth, setPendingYearMonth] = useState<string | null>(null);
  const { toast } = useToast();
  const navigation = useEditingNavigation();
  const billingGuardId = useId();
  const { data, loading, error, setData } = useResource(() => Promise.all([
    apiFetch<CreditCard[]>("/api/credit-cards"), apiFetch<Account[]>("/api/accounts"), apiFetch<BillingResponse>(`/api/billings?month=${yearMonth}`),
  ]).then(([cards, accounts, billing]) => ({ cards, accounts, billing })), [reloadKey, yearMonth]);
  const reload = () => startTransition(() => setReloadKey((value) => value + 1));
  const refresh = async () => {
    const requestedMonth = yearMonth;
    const request = ++refreshRequestRef.current;
    setRefreshing(true);
    try {
      const [cards, accounts, billing] = await Promise.all([
        apiFetch<CreditCard[]>("/api/credit-cards"), apiFetch<Account[]>("/api/accounts"), apiFetch<BillingResponse>(`/api/billings?month=${requestedMonth}`),
      ]);
      if (request === refreshRequestRef.current && requestedMonth === currentMonthRef.current) {
        setData({ cards, accounts, billing }); setBillingRefreshError(null);
      }
      return cards;
    } finally {
      if (request === refreshRequestRef.current) setRefreshing(false);
    }
  };
  const accounts = data?.accounts ?? [];
  const billingReady = data?.billing.yearMonth === yearMonth && !loading;
  const baseline = useMemo<Record<string, string>>(() => Object.fromEntries((billingReady ? data?.billing.items ?? [] : []).map((item) => [item.creditCardId, formatCurrencyInputValue(item.amount, "JPY")])), [data?.billing, billingReady]);
  const monthOffset = getBillingMonthOffset(getCurrentYearMonth(), yearMonth);
  const billingRows = useMemo(() => (billingReady ? data?.cards ?? [] : []).map((card): BillingRow => {
    const isEdited = editedYearMonth === yearMonth && hasAmount(editedAmounts, card.id);
    const raw = isEdited ? editedAmounts[card.id] : baseline[card.id] ?? "";
    const parsed = readMoneyDraft(raw, "JPY");
    const actualAmount = raw !== "" && parsed.kind === "valid" ? parsed.minorUnits : null;
    return { card, inputAmount: raw, actualAmount, resolvedAmount: resolveBillingAmount({ actualAmount, assumptions: card.assumptions, yearMonth, monthOffset }), error: amountError(raw) };
  }), [data?.cards, editedAmounts, editedYearMonth, baseline, yearMonth, monthOffset, billingReady]);
  const changedRows = billingRows.filter(({ card, inputAmount }) => {
    if (editedYearMonth !== yearMonth || !hasAmount(editedAmounts, card.id)) return false;
    if (inputAmount === "") return hasAmount(baseline, card.id);
    const parsed = readMoneyDraft(inputAmount, "JPY");
    const saved = readMoneyDraft(baseline[card.id] ?? "", "JPY");
    return parsed.kind !== "valid" || saved.kind !== "valid" || parsed.minorUnits !== saved.minorUnits;
  });
  const isBillingDirty = changedRows.length > 0;
  const hasBillingErrors = billingRows.some((row) => row.error !== null);
  const totals = billingRows.reduce<BillingTotals>((sum, row) => ({ assumptionTotal: sum.assumptionTotal + row.resolvedAmount.appliedAssumptionAmount,
    actualTotal: sum.actualTotal + (row.actualAmount ?? 0), appliedTotal: sum.appliedTotal + row.resolvedAmount.amount }), { assumptionTotal: 0, actualTotal: 0, appliedTotal: 0 });
  const discardBilling = () => { setEditedAmounts({}); setEditedYearMonth(null); setBillingError(null); };
  useEffect(() => navigation.register(billingGuardId, { dirty: false, saving: false, discard: discardBilling }), [navigation, billingGuardId]);
  useEffect(() => navigation.update(billingGuardId, { dirty: isBillingDirty, saving: billingSaving, discard: discardBilling }), [navigation, billingGuardId, isBillingDirty, billingSaving]);
  const saveBilling = async () => {
    if (!billingReady || !isBillingDirty || hasBillingErrors || billingSavingRef.current || billingRefreshError) return;
    billingSavingRef.current = true; setBillingSaving(true); setBillingError(null);
    try {
      const response = await apiFetch<BillingResponse>(`/api/billings/${yearMonth}`, { method: "PUT", body: JSON.stringify({ ...(data?.billing.settlementDate ? { settlementDate: data.billing.settlementDate } : {}), items: billingRows.filter((row) => row.actualAmount !== null).map((row) => ({ creditCardId: row.card.id, amount: row.actualAmount! })) }) });
      setData((current) => current ? { ...current, billing: response } : current);
      discardBilling();
      toast({ title: "請求額を保存しました" });
      try { await refresh(); } catch (refreshError) { setBillingRefreshError(describeError(refreshError)); }
    } catch (saveError) { setBillingError(describeError(saveError)); }
    finally { billingSavingRef.current = false; setBillingSaving(false); }
  };
  const changeYearMonth = (next: string) => {
    if (billingSavingRef.current || refreshing) return;
    if (isBillingDirty) { setPendingYearMonth(next); return; }
    setYearMonth(next); discardBilling(); setBillingRefreshError(null);
  };
  const requestSelect = (card: CreditCard, mode: CardSelection["mode"]) => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const action = () => { setSelectionKey((value) => value + 1); setSelection({ card, mode, key: selectionKey + 1, origin }); };
    if (transitionRef.current) transitionRef.current(action); else action();
  };
  const requestDelete = (card: CreditCard) => navigation.request(() => setDeletingCard(card));
  const confirmDelete = async () => {
    if (!deletingCard || billingSavingRef.current || refreshing) return;
    try { await apiFetch(`/api/credit-cards/${deletingCard.id}`, { method: "DELETE" }); toast({ title: `${deletingCard.name} を削除しました` }); setDeletingCard(null); await refresh(); }
    catch (deleteError) { toast({ title: "削除に失敗しました", description: describeError(deleteError), variant: "error" }); }
  };
  const cardColumns: ResponsiveTableColumn<CreditCard>[] = [
    { key: "name", header: "カード名", render: (card) => <button className="text-left font-medium text-brand hover:underline" onClick={() => requestSelect(card, "detail")}>{card.name}</button> },
    { key: "day", header: "引落日", render: (card) => card.settlementDay ?? "-" },
    { key: "account", header: "引き落とし口座", render: (card) => card.account?.name ?? "未設定" },
    { key: "assumptions", header: "仮定額と適用請求月", render: (card) => <AssumptionList card={card} /> },
    { key: "sortOrder", header: "表示順", mono: true, render: (card) => card.sortOrder },
    { key: "actions", header: "", render: (card) => <div className="flex justify-end gap-1">
      <IconButton aria-label="編集" onClick={() => requestSelect(card, "basic")}><Pencil aria-hidden="true" className="h-4 w-4" /></IconButton>
      <IconButton aria-label="削除" variant="danger" onClick={() => requestDelete(card)}><Trash2 aria-hidden="true" className="h-4 w-4" /></IconButton>
    </div> },
  ];
  return <>
    <CreditCardEditorLayout selection={selection} accounts={accounts} onClose={() => setSelection(null)} onSaved={refresh} transitionRef={transitionRef}>
      <div className="grid gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-2xl font-semibold">クレジットカード管理</h2><p className="mt-2 text-sm text-ink-2">カードマスタと月別請求額を管理します。</p></div>
          <Button className="min-h-10 gap-2" onClick={() => setCreateOpen(true)}><span className="text-lg leading-none">+</span>カードを追加</Button></div>
        <Card className="grid gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">月別請求入力</h2>
            <p className="mt-2 text-sm text-ink-2">対象: {yearMonth}・変更 {changedRows.length} 件・入力合計 {formatCurrency(totals.actualTotal)}</p>
            <p className="text-xs text-ink-2">{isBillingDirty ? "未保存の変更あり" : "保存済み"}。表全体の請求実額を一度に保存します。</p></div>
            <Button disabled={!isBillingDirty || hasBillingErrors || billingSaving || refreshing || Boolean(billingRefreshError)} onClick={saveBilling}>請求額を保存</Button></div>
          {hasBillingErrors && <p role="alert" className="text-xs text-critical">入力エラーがあります。各行の金額を確認してください。</p>}
          {billingError && <p role="alert" className="text-xs text-critical">{billingError}</p>}
          {billingRefreshError && <div className="grid gap-2"><p role="alert" className="text-xs text-critical">保存済みですが表示を更新できませんでした: {billingRefreshError}</p><Button variant="secondary" onClick={() => void refresh().catch((refreshError) => setBillingRefreshError(describeError(refreshError)))}>表示を再取得</Button></div>}
          <div className="flex items-center gap-2"><Button variant="secondary" aria-label="前月" disabled={billingSaving || refreshing} onClick={() => changeYearMonth(addMonthsToYearMonth(yearMonth, -1))}>前月</Button>
            <Input className="max-w-44" type="month" aria-label="対象年月" disabled={billingSaving || refreshing} value={yearMonth} onChange={(event) => changeYearMonth(event.target.value)} />
            <Button variant="secondary" aria-label="次月" disabled={billingSaving || refreshing} onClick={() => changeYearMonth(addMonthsToYearMonth(yearMonth, 1))}>次月</Button></div>
          <div className="grid min-w-0 gap-4 self-start"><div className="hidden min-w-0 md:block"><TableWrapper><Table className="w-full"><thead><tr className="border-b border-line text-left text-xs font-medium text-ink-3">
            <th scope="col" className="px-3 py-3">カード名</th><th scope="col" className="px-3 py-3">引き落とし口座</th><th scope="col" className="px-3 py-3">引落日</th><th scope="col" className="px-3 py-3">この月の仮定額</th><th scope="col" className="px-3 py-3">実額入力</th><th scope="col" className="px-3 py-3">適用額</th><th scope="col" className="px-3 py-3">状態</th>
          </tr></thead><tbody>{billingRows.map((row) => <BillingTableRow key={row.card.id} row={row} disabled={billingSaving || refreshing || Boolean(billingRefreshError)} onAmountChange={(id, raw) => { if (billingSavingRef.current || refreshing || billingRefreshError) return; setEditedYearMonth(yearMonth); setEditedAmounts((current) => ({ ...current, [id]: raw })); }} />)}</tbody><tfoot><BillingTotalsRow totals={totals} /></tfoot></Table></TableWrapper></div>
          <div className="grid gap-3 md:hidden">{billingRows.map((row) => <BillingMobileCard key={row.card.id} row={row} disabled={billingSaving || refreshing || Boolean(billingRefreshError)} onAmountChange={(id, raw) => { if (billingSavingRef.current || refreshing || billingRefreshError) return; setEditedYearMonth(yearMonth); setEditedAmounts((current) => ({ ...current, [id]: raw })); }} />)}<BillingMobileTotals totals={totals} /></div></div>
        </Card>
        <Card className="grid gap-3"><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">カード一覧</h2><div className="text-sm text-ink-2">{loading ? "読み込み中..." : `${data?.cards.length ?? 0} 件`}</div></div>
          {error ? <ErrorBlock message={error} onRetry={reload} /> : <ResponsiveTable columns={cardColumns} rows={data?.cards ?? []} rowKey={(card) => card.id} emptyMessage="カードが登録されていません。上部の「カードを追加」から登録してください。"
            mobileRow={(card) => <><button className="text-left font-medium text-brand" onClick={() => requestSelect(card, "detail")}>{card.name}</button><div className="text-xs text-ink-3">毎月 {card.settlementDay ?? 27} 日・{card.account?.name ?? "未設定"}</div><AssumptionList card={card} />
              <div className="flex justify-between text-xs text-ink-3"><span>表示順 {card.sortOrder}</span><div className="flex gap-1"><IconButton aria-label="編集" onClick={() => requestSelect(card, "basic")}><Pencil className="h-4 w-4" /></IconButton><IconButton aria-label="削除" variant="danger" onClick={() => requestDelete(card)}><Trash2 className="h-4 w-4" /></IconButton></div></div></>} />}
        </Card>
      </div>
    </CreditCardEditorLayout>
    <CreditCardCreateModal open={createOpen} accounts={accounts} onClose={() => setCreateOpen(false)} onSaved={refresh} />
    <ConfirmDialog open={Boolean(deletingCard)} onOpenChange={(open) => !open && setDeletingCard(null)} title="カードを削除しますか？" description={deletingCard ? `「${deletingCard.name}」を削除します。この操作は取り消せません。` : undefined} onConfirm={confirmDelete} />
    <ConfirmDialog open={Boolean(pendingYearMonth)} onOpenChange={(open) => !open && setPendingYearMonth(null)} title="未保存の月次請求があります" description="月を切り替えると入力中の請求額は破棄されます。切り替えますか？" confirmLabel="切り替える" danger={false}
      onConfirm={() => { if (pendingYearMonth) { setYearMonth(pendingYearMonth); discardBilling(); setBillingRefreshError(null); setPendingYearMonth(null); } }} />
  </>;
}

function BillingAmountInput({
  row,
  onAmountChange,
  disabled = false,
}: {
  row: BillingRow;
  onAmountChange: (cardId: string, amount: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <Input
        aria-label={`${row.card.name} 実額`}
        data-billing-amount-input="true"
        disabled={disabled}
        aria-invalid={row.error ? true : undefined}
        aria-describedby={row.error ? `billing-error-${row.card.id}` : undefined}
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
        onChange={(event) => onAmountChange(row.card.id, event.target.value)}
      />
      {row.error ? (
        <div id={`billing-error-${row.card.id}`} role="alert" className="text-xs font-medium text-critical">
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
  disabled,
}: {
  row: BillingRow;
  onAmountChange: (cardId: string, amount: string) => void;
  disabled?: boolean;
}) {
  return (
    <tr className="border-b border-line">
      <td className="px-3 py-3 align-top font-medium">{row.card.name}</td>
      <td className="px-3 py-3 align-top text-ink-2">{row.card.account?.name ?? "未設定"}</td>
      <td className="px-3 py-3 align-top text-ink-2">毎月 {row.card.settlementDay ?? 27} 日</td>
      <td className="font-data px-3 py-3 align-top">{formatCurrency(row.resolvedAmount.appliedAssumptionAmount)}</td>
      <td className="px-3 py-3 align-top">
        <BillingAmountInput row={row} onAmountChange={onAmountChange} disabled={disabled} />
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
  disabled,
}: {
  row: BillingRow;
  onAmountChange: (cardId: string, amount: string) => void;
  disabled?: boolean;
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
        <BillingAmountInput row={row} onAmountChange={onAmountChange} disabled={disabled} />
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

function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="grid gap-3 rounded-xl border border-critical/40 bg-critical/10 p-4 text-sm text-ink"><p role="alert">{message}</p><Button className="justify-self-start" variant="secondary" onClick={onRetry}>再試行</Button></div>;
}
