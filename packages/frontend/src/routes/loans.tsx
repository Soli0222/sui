import { INT4_MAX, type Account, type DateShiftPolicy, type Loan, type LoanPaymentMethod } from "@sui/shared";
import { useId, useState, startTransition } from "react";
import { EditModal, type EditChange } from "../components/editing/edit-surface";
import { AccountSelect, DateShiftField } from "../components/form-fields";
import { ArchivedSection } from "../components/ArchivedSection";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { RecordCardLayout } from "../components/ui/card-list";
import { ConditionalField } from "../components/ui/conditional-field";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { MoneyInput, readMoneyDraft } from "../components/ui/money-input";
import { SegmentedControl } from "../components/ui/segmented-control";
import { useResource } from "../hooks/use-resource";
import { useEditSession, type EditErrors } from "../hooks/use-edit-session";
import { useFieldValidation } from "../hooks/use-field-validation";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { formatCurrency, formatDateWithYear } from "../lib/format";
import { getTodayDate } from "../lib/utils";
import { Pencil, Trash2 } from "lucide-react";

type LoanForm = {
  name: string;
  totalAmount: number;
  startDate: string;
  paymentCount: number;
  dateShiftPolicy: DateShiftPolicy;
  paymentMethod: LoanPaymentMethod;
  accountId: string;
};

type LoanDraft = Omit<LoanForm, "totalAmount"> & { amountRaw: string; midwayMode: boolean };

const emptyForm: LoanForm = {
  name: "",
  totalAmount: 0,
  startDate: "",
  paymentCount: 1,
  dateShiftPolicy: "none",
  paymentMethod: "account_withdrawal",
  accountId: "",
};

function createDraft(): LoanDraft {
  return { ...emptyForm, startDate: getTodayDate(), amountRaw: "", midwayMode: false };
}

function draftFromLoan(loan: Loan): LoanDraft {
  return { name: loan.name, amountRaw: String(loan.totalAmount), startDate: loan.startDate.slice(0, 10),
    paymentCount: loan.paymentCount, dateShiftPolicy: loan.dateShiftPolicy, paymentMethod: loan.paymentMethod,
    accountId: loan.accountId ?? "", midwayMode: false };
}

const paymentMethodOptions = [
  { value: "account_withdrawal", label: "口座引落し" },
  { value: "credit_card", label: "クレカ分割" },
] as const;

const entryModeOptions = [
  { value: "normal", label: "最初から入力する" },
  { value: "midway", label: "途中から入力する" },
] as const;

function parseNumber(value: string) {
  return Number(value === "" ? 0 : value);
}

function getPreviewAmount(totalAmount: number, paymentCount: number) {
  if (paymentCount < 1 || totalAmount < 1) {
    return 0;
  }

  return Math.ceil(totalAmount / paymentCount);
}

function buildLoanPayload(form: LoanDraft) {
  const totalAmount = readMoneyDraft(form.amountRaw, "JPY").minorUnits;
  if (totalAmount === null) throw new Error("金額を確認してください。");
  return {
    name: form.name.trim(), startDate: form.startDate, paymentCount: form.paymentCount,
    dateShiftPolicy: form.dateShiftPolicy, paymentMethod: form.paymentMethod,
    totalAmount,
    accountId: form.paymentMethod === "credit_card" ? null : form.accountId,
  };
}

export function isEndedLoan(loan: Loan): boolean {
  return loan.remainingPayments === 0 || loan.remainingBalance <= 0;
}

export function partitionLoans(loans: Loan[]): { active: Loan[]; archived: Loan[] } {
  const active: Loan[] = [];
  const archived: Loan[] = [];

  for (const loan of loans) {
    if (isEndedLoan(loan)) {
      archived.push(loan);
    } else {
      active.push(loan);
    }
  }

  return { active, archived };
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

export function LoansPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
  const [deletingLoan, setDeletingLoan] = useState<Loan | null>(null);
  const { toast } = useToast();

  const { data, loading, error, setData } = useResource(
    () =>
      Promise.all([apiFetch<Loan[]>("/api/loans"), apiFetch<Account[]>("/api/accounts")]).then(([loans, accounts]) => ({
        loans,
        accounts,
      })),
    [reloadKey],
  );

  const loans = data?.loans ?? [];
  const { active: activeLoans, archived: archivedLoans } = partitionLoans(loans);
  const accounts = data?.accounts ?? [];
  const reload = () => startTransition(() => setReloadKey((value) => value + 1));

  const requestDelete = (loan: Loan) => setDeletingLoan(loan);

  const confirmDelete = async () => {
    if (!deletingLoan) {
      return;
    }

    try {
      await apiFetch(`/api/loans/${deletingLoan.id}`, { method: "DELETE" });
      toast({ title: `${deletingLoan.name} を削除しました` });
      setDeletingLoan(null);
      reload();
    } catch (deleteError) {
      toast({ title: "削除に失敗しました", description: describeError(deleteError), variant: "error" });
    }
  };

  const refreshAfterSave = async () => {
    const refreshed = await apiFetch<Loan[]>("/api/loans");
    setData((current) => ({ loans: refreshed, accounts: current?.accounts ?? accounts }));
  };

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">ローン管理</h2>
          <p className="mt-2 text-sm text-ink-2">登録済みローンの残高や支払予定を管理します。</p>
        </div>
        <Button className="min-h-10 gap-2" onClick={() => setCreateOpen(true)}>
          <span className="text-lg leading-none">+</span>
          ローンを追加
        </Button>
      </div>

      <Card className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">ローン一覧</h2>
          <div className="text-sm text-ink-2">{loading ? "読み込み中..." : `${loans.length} 件`}</div>
        </div>
        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : loans.length === 0 ? (
          <p className="text-sm text-ink-3">ローンが登録されていません。上部の「ローンを追加」から登録してください。</p>
        ) : (
          <>
            {activeLoans.length === 0 && archivedLoans.length > 0 ? (
              <p className="text-sm text-ink-3">現役のローンはありません。</p>
            ) : (
              activeLoans.map((loan) => (
                <LoanRow key={loan.id} loan={loan} accounts={accounts} onEdit={setEditingLoan} onDelete={requestDelete} />
              ))
            )}
            <ArchivedSection title="終了済み" count={archivedLoans.length}>
              <div className="grid gap-3">
                {archivedLoans.map((loan) => (
                  <LoanRow key={loan.id} loan={loan} accounts={accounts} onEdit={setEditingLoan} onDelete={requestDelete} />
                ))}
              </div>
            </ArchivedSection>
          </>
        )}
      </Card>

      {editingLoan && <LoanEditModal key={editingLoan.id} accounts={accounts} loan={editingLoan}
        onClose={() => setEditingLoan(null)} onRefresh={refreshAfterSave}
        onSaved={(name) => { setEditingLoan(null); toast({ title: `${name} を更新しました` }); }} />}
      {createOpen && <LoanEditModal accounts={accounts} onClose={() => setCreateOpen(false)}
        onRefresh={refreshAfterSave} onSaved={(name) => { setCreateOpen(false); toast({ title: `${name} を追加しました` }); }} />}

      <ConfirmDialog
        open={Boolean(deletingLoan)}
        onOpenChange={(open) => !open && setDeletingLoan(null)}
        title="ローンを削除しますか？"
        description={deletingLoan ? `「${deletingLoan.name}」を削除します。この操作は取り消せません。` : undefined}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function LoanRow({
  loan,
  accounts,
  onEdit,
  onDelete,
}: {
  loan: Loan;
  accounts: Account[];
  onEdit: (loan: Loan) => void;
  onDelete: (loan: Loan) => void;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-line p-3">
      <RecordCardLayout
        title={<div>
          <div className="break-words text-base font-semibold">{loan.name}</div>
          <div className="mt-1 break-words text-xs text-ink-3">
            {loan.paymentMethod === "credit_card"
              ? "支払方法 クレカ分割"
              : `引き落とし口座 ${accounts.find((account) => account.id === loan.accountId)?.name ?? "未設定"}`}
          </div>
        </div>}
        value={<div><div className="text-xs text-ink-3">現在の残り残高</div><div className="font-data whitespace-nowrap font-semibold">{formatCurrency(loan.remainingBalance)}</div></div>}
        details={<div className="grid gap-1 text-xs text-ink-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1"><span className="whitespace-nowrap">残り {loan.remainingPayments} 回</span><span className="font-data whitespace-nowrap">次回 {formatCurrency(loan.nextPaymentAmount)}</span><span className="whitespace-nowrap">初回引落日 {formatDateWithYear(loan.startDate.slice(0, 10))}</span></div>
          <div className="break-words">
            {loan.paymentMethod === "credit_card"
              ? "クレカ分割のため、取引予測には反映しません。"
              : "予測ベースの次回支払額と残り回数を一覧表示しています。"}
          </div>
        </div>}
        actions={<>
          <IconButton aria-label={`${loan.name}を編集`} onClick={() => onEdit(loan)}>
            <Pencil aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <IconButton aria-label={`${loan.name}を削除`} variant="danger" onClick={() => onDelete(loan)}>
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </>}
      />
    </div>
  );
}

function LoanEditModal({ accounts, loan, onClose, onRefresh, onSaved }: {
  accounts: Account[]; loan?: Loan; onClose: () => void;
  onRefresh: () => Promise<void>; onSaved: (name: string) => void;
}) {
  const nameId = useId();
  const amountId = useId();
  const dateId = useId();
  const countId = useId();
  const accountId = useId();
  const initial = loan ? draftFromLoan(loan) : createDraft();
  const fieldIds = { name: nameId, amount: amountId, startDate: dateId, paymentCount: countId, accountId };
  const validate = (draft: LoanDraft): EditErrors => {
    const errors: EditErrors = {};
    const amount = readMoneyDraft(draft.amountRaw, "JPY");
    if (!draft.name.trim()) errors.name = "商品名を入力してください。";
    if (amount.kind !== "valid" || amount.minorUnits === null || amount.minorUnits <= 0 || amount.minorUnits > INT4_MAX) errors.amount = "0より大きい金額を入力してください。";
    if (!draft.startDate) errors.startDate = "引落日を入力してください。";
    if (!Number.isInteger(draft.paymentCount) || draft.paymentCount < 1) errors.paymentCount = "支払回数を1以上で入力してください。";
    if (draft.paymentMethod === "account_withdrawal" && !accounts.some((account) => account.id === draft.accountId && account.currencyCode === "JPY")) errors.accountId = "円の引き落とし口座を選択してください。";
    return errors;
  };
  const session = useEditSession({ identity: loan?.id ?? "new-loan", initial, validate, fieldIds });
  const { draft, setDraft } = session;
  const fields = useFieldValidation(draft, validate, fieldIds);
  const amount = readMoneyDraft(draft.amountRaw, "JPY");
  const preview = getPreviewAmount(amount.minorUnits ?? 0, draft.paymentCount);
  const requestClose = () => session.requestClose(onClose);
  const save = async () => {
    fields.showAll();
    const saved = await session.save((next) => apiFetch(loan ? `/api/loans/${loan.id}` : "/api/loans", {
      method: loan ? "PUT" : "POST", body: JSON.stringify(buildLoanPayload(next)),
    }), async () => { await onRefresh(); return draft; });
    if (saved) onSaved(draft.name);
  };
  const changes: EditChange[] = [];
  const base = session.snapshot;
  const paymentLabel = (value: LoanPaymentMethod) => paymentMethodOptions.find((item) => item.value === value)?.label ?? value;
  const shiftLabel: Record<DateShiftPolicy, string> = { none: "シフトなし", previous: "前営業日", next: "後営業日" };
  const accountLabel = (id: string) => accounts.find((account) => account.id === id)?.name ?? "未選択";
  if (base.name !== draft.name) changes.push({ label: "商品名", before: base.name || "未入力", after: draft.name || "未入力" });
  if (base.paymentMethod !== draft.paymentMethod) changes.push({ label: "支払方法", before: paymentLabel(base.paymentMethod), after: paymentLabel(draft.paymentMethod) });
  if (base.midwayMode !== draft.midwayMode) changes.push({ label: "入力起点", before: base.midwayMode ? "途中から" : "最初から", after: draft.midwayMode ? "途中から" : "最初から" });
  if (base.amountRaw !== draft.amountRaw) changes.push({ label: draft.midwayMode ? "残り残高" : "総支払額", before: base.amountRaw ? formatCurrency(Number(base.amountRaw)) : "未入力", after: amount.minorUnits === null ? draft.amountRaw || "未入力" : formatCurrency(amount.minorUnits) });
  if (base.startDate !== draft.startDate) changes.push({ label: "引落日", before: base.startDate || "未入力", after: draft.startDate || "未入力" });
  if (base.paymentCount !== draft.paymentCount) changes.push({ label: "支払回数", before: String(base.paymentCount), after: String(draft.paymentCount) });
  if (base.accountId !== draft.accountId || base.paymentMethod !== draft.paymentMethod) changes.push({ label: "引落口座", before: base.paymentMethod === "credit_card" ? "対象外" : accountLabel(base.accountId), after: draft.paymentMethod === "credit_card" ? "対象外" : accountLabel(draft.accountId) });
  if (base.dateShiftPolicy !== draft.dateShiftPolicy) changes.push({ label: "土日祝の扱い", before: shiftLabel[base.dateShiftPolicy], after: shiftLabel[draft.dateShiftPolicy] });
  return <EditModal open subjectType="ローン" subjectName={loan?.name ?? "ローン"}
    mode={loan ? "edit" : "create"} status={session.status} changes={changes} error={session.error}
    saveLabel={loan ? "変更を保存" : "ローンを追加"}
    impact={draft.paymentMethod === "credit_card" ? "クレカ分割の返済は残高予測に直接加算されません。" : "保存すると未確定の返済予測が更新されます。確定済み取引は変更されません。"}
    onRequestClose={requestClose} onSave={() => void save()}
    onRetryRefresh={() => void session.retryRefresh().then((ok) => { if (ok) onSaved(draft.name); })}>
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="grid gap-3"><h3 className="text-sm font-semibold">内容</h3>
        <FormField label="商品名" htmlFor={nameId} required error={fields.visibleErrors.name}>
          <Input id={nameId} value={draft.name} onBlur={() => fields.touch("name")} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </FormField>
        <FormField label="支払方法" htmlFor="loan-payment-method"><SegmentedControl aria-label="支払方法" value={draft.paymentMethod} options={paymentMethodOptions}
          onChange={(paymentMethod) => setDraft({ ...draft, paymentMethod, accountId: paymentMethod === "credit_card" ? "" : draft.accountId })} /></FormField>
      </div>
      <div className="grid gap-3"><h3 className="text-sm font-semibold">返済条件</h3>
        <FormField label="入力起点" htmlFor="loan-entry-mode"><SegmentedControl aria-label="入力起点" value={draft.midwayMode ? "midway" : "normal"} options={entryModeOptions}
          onChange={(mode) => setDraft({ ...draft, midwayMode: mode === "midway", amountRaw: loan ? String(mode === "midway" ? loan.remainingBalance : loan.totalAmount) : "" })} /></FormField>
        <FormField label={draft.midwayMode ? "残り残高" : "総支払額"} htmlFor={amountId} required error={fields.visibleErrors.amount}>
          <MoneyInput id={amountId} value={amount.minorUnits} draftValue={draft.amountRaw} draftKey={`${loan?.id ?? "new"}:${draft.midwayMode}`} onChange={() => {}}
            onDraftChange={(next) => setDraft({ ...draft, amountRaw: next.raw })} onBlur={() => fields.touch("amount")} />
        </FormField>
        <FormField label={draft.midwayMode ? "残り回数" : "支払回数"} htmlFor={countId} required error={fields.visibleErrors.paymentCount}>
          <Input id={countId} type="number" min={1} inputMode="numeric" value={draft.paymentCount}
            onBlur={() => fields.touch("paymentCount")} onChange={(event) => setDraft({ ...draft, paymentCount: parseNumber(event.target.value) })} />
        </FormField>
        <div className="border-l-2 border-line-strong pl-3 text-sm text-ink-2">月々の支払額プレビュー: <span className="font-data font-semibold text-ink">{formatCurrency(preview)}</span></div>
      </div>
      <div className="grid gap-3"><h3 className="text-sm font-semibold">期間と口座</h3>
        <FormField label={draft.midwayMode ? "次回引落日" : "初回引落日"} htmlFor={dateId} required error={fields.visibleErrors.startDate}>
          <Input id={dateId} type="date" value={draft.startDate} onBlur={() => fields.touch("startDate")} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} />
        </FormField>
        <ConditionalField show={draft.paymentMethod === "account_withdrawal"}>
          <AccountSelect id={accountId} label="引き落とし口座" accounts={accounts} currencyFilter="JPY" value={draft.accountId} error={fields.visibleErrors.accountId}
            onChange={(accountId) => setDraft({ ...draft, accountId })} />
        </ConditionalField>
        <DateShiftField id="loan-date-shift" value={draft.dateShiftPolicy} onChange={(dateShiftPolicy) => setDraft({ ...draft, dateShiftPolicy })} />
      </div>
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
