import type { Account, DateShiftPolicy, Loan, LoanPaymentMethod } from "@sui/shared";
import { useEffect, useId, useRef, useState, startTransition } from "react";
import { AccountSelect, DateShiftField } from "../components/form-fields";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConditionalField } from "../components/ui/conditional-field";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { MoneyInput } from "../components/ui/money-input";
import { SegmentedControl } from "../components/ui/segmented-control";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { formatCurrency, formatDateWithYear } from "../lib/format";
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

const emptyForm: LoanForm = {
  name: "",
  totalAmount: 0,
  startDate: "",
  paymentCount: 1,
  dateShiftPolicy: "none",
  paymentMethod: "account_withdrawal",
  accountId: "",
};

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

function buildLoanPayload(form: LoanForm, totalAmount: number) {
  return {
    ...form,
    totalAmount,
    accountId: form.paymentMethod === "credit_card" ? null : form.accountId,
  };
}

function getEffectiveTotalAmount(totalAmount: number, remainingBalance: number, midwayMode: boolean) {
  return midwayMode ? remainingBalance : totalAmount;
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

export function LoansPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState<LoanForm>(emptyForm);
  const [midwayMode, setMidwayMode] = useState(false);
  const [remainingBalance, setRemainingBalance] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
  const [editForm, setEditForm] = useState<LoanForm>(emptyForm);
  const [editMidwayMode, setEditMidwayMode] = useState(false);
  const [editRemainingBalance, setEditRemainingBalance] = useState(0);
  const [deletingLoan, setDeletingLoan] = useState<Loan | null>(null);
  const { toast } = useToast();

  const { data, loading, error } = useResource(
    () =>
      Promise.all([apiFetch<Loan[]>("/api/loans"), apiFetch<Account[]>("/api/accounts")]).then(([loans, accounts]) => ({
        loans,
        accounts,
      })),
    [reloadKey],
  );

  const loans = data?.loans ?? [];
  const accounts = data?.accounts ?? [];
  const canCreate =
    form.name.trim().length > 0 &&
    form.startDate !== "" &&
    (form.paymentMethod === "credit_card" || form.accountId !== "") &&
    form.paymentCount >= 1 &&
    getEffectiveTotalAmount(form.totalAmount, remainingBalance, midwayMode) > 0;
  const canSaveEdit =
    editForm.name.trim().length > 0 &&
    editForm.startDate !== "" &&
    (editForm.paymentMethod === "credit_card" || editForm.accountId !== "") &&
    editForm.paymentCount >= 1 &&
    getEffectiveTotalAmount(editForm.totalAmount, editRemainingBalance, editMidwayMode) > 0;

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));

  const createLoan = async () => {
    try {
      await apiFetch("/api/loans", {
        method: "POST",
        body: JSON.stringify(buildLoanPayload(form, getEffectiveTotalAmount(form.totalAmount, remainingBalance, midwayMode))),
      });
      const name = form.name;
      setForm({ ...emptyForm, accountId: accounts[0]?.id ?? "" });
      setMidwayMode(false);
      setRemainingBalance(0);
      setCreateOpen(false);
      reload();
      toast({ title: `${name} を追加しました` });
    } catch (createError) {
      toast({ title: "ローンの追加に失敗しました", description: describeError(createError), variant: "error" });
    }
  };

  const updateLoan = async (loanId: string, nextForm: LoanForm, nextRemainingBalance: number, nextMidwayMode: boolean) => {
    await apiFetch(`/api/loans/${loanId}`, {
      method: "PUT",
      body: JSON.stringify(
        buildLoanPayload(nextForm, getEffectiveTotalAmount(nextForm.totalAmount, nextRemainingBalance, nextMidwayMode)),
      ),
    });
    reload();
  };

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

  const openEdit = (loan: Loan) => {
    setEditingLoan(loan);
    setEditForm({
      name: loan.name,
      totalAmount: loan.totalAmount,
      startDate: loan.startDate.slice(0, 10),
      paymentCount: loan.paymentCount,
      dateShiftPolicy: loan.dateShiftPolicy,
      paymentMethod: loan.paymentMethod,
      accountId: loan.accountId ?? "",
    });
    setEditMidwayMode(false);
    setEditRemainingBalance(loan.remainingBalance);
  };

  const closeEdit = () => {
    setEditingLoan(null);
    setEditForm(emptyForm);
    setEditMidwayMode(false);
    setEditRemainingBalance(0);
  };

  const saveEdit = async () => {
    if (!editingLoan) {
      return;
    }

    try {
      await updateLoan(editingLoan.id, editForm, editRemainingBalance, editMidwayMode);
      closeEdit();
      toast({ title: `${editForm.name} を更新しました` });
    } catch (updateError) {
      toast({ title: "更新に失敗しました", description: describeError(updateError), variant: "error" });
    }
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setForm({ ...emptyForm, accountId: accounts[0]?.id ?? "" });
    setMidwayMode(false);
    setRemainingBalance(0);
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
          <p className="text-sm text-ink-3">ローンが登録されていません。</p>
        ) : (
          loans.map((loan) => (
            <LoanRow key={loan.id} loan={loan} accounts={accounts} onEdit={openEdit} onDelete={requestDelete} />
          ))
        )}
      </Card>

      <Dialog open={Boolean(editingLoan)} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">ローンを編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">
            途中参入モードを含めてローン情報を更新します。
          </DialogDescription>
          <LoanEditModal
            accounts={accounts}
            form={editForm}
            midwayMode={editMidwayMode}
            remainingBalance={editRemainingBalance}
            canSave={canSaveEdit}
            onFormChange={setEditForm}
            onRemainingBalanceChange={setEditRemainingBalance}
            onMidwayModeChange={setEditMidwayMode}
            onCancel={closeEdit}
            onSave={saveEdit}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : closeCreate())}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">ローンを追加</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">
            途中参入モードを含めてローン情報を登録します。
          </DialogDescription>
          <LoanEditModal
            accounts={accounts}
            form={form}
            midwayMode={midwayMode}
            remainingBalance={remainingBalance}
            canSave={canCreate}
            actionLabel="追加"
            helperText="クレカ分割は取引予測には反映されません。"
            onFormChange={setForm}
            onRemainingBalanceChange={setRemainingBalance}
            onMidwayModeChange={setMidwayMode}
            onCancel={closeCreate}
            onSave={createLoan}
          />
        </DialogContent>
      </Dialog>

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
    <div className="grid min-w-0 gap-4 rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="break-words text-base font-semibold">{loan.name}</div>
          <div className="break-words text-sm text-ink-3">
            現在の残り残高 {formatCurrency(loan.remainingBalance)} / 残り {loan.remainingPayments} 回 / 次回 {formatCurrency(loan.nextPaymentAmount)}
          </div>
          <div className="mt-2 break-words text-sm text-ink-3">
            {loan.paymentMethod === "credit_card"
              ? "支払方法 クレカ分割"
              : `引き落とし口座 ${accounts.find((account) => account.id === loan.accountId)?.name ?? "未設定"}`}{" "}
            / 初回引落日 {formatDateWithYear(loan.startDate.slice(0, 10))}
          </div>
        </div>
        <div className="flex justify-end gap-1">
          <IconButton aria-label="編集" onClick={() => onEdit(loan)}>
            <Pencil aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <IconButton aria-label="削除" variant="danger" onClick={() => onDelete(loan)}>
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      <div className="break-words text-sm text-ink-2">
        {loan.paymentMethod === "credit_card"
          ? "クレカ分割のため、取引予測には反映しません。"
          : "予測ベースの次回支払額と残り回数を一覧表示しています。"}
      </div>
    </div>
  );
}

function LoanEditModal({
  accounts,
  form,
  midwayMode,
  remainingBalance,
  canSave,
  onFormChange,
  onRemainingBalanceChange,
  onMidwayModeChange,
  onCancel,
  onSave,
  actionLabel = "保存",
  helperText,
}: {
  accounts: Account[];
  form: LoanForm;
  midwayMode: boolean;
  remainingBalance: number;
  canSave: boolean;
  onFormChange: (next: LoanForm) => void;
  onRemainingBalanceChange: (value: number) => void;
  onMidwayModeChange: (value: boolean) => void;
  onCancel: () => void;
  onSave: () => void;
  actionLabel?: string;
  helperText?: string;
}) {
  const nameId = useId();
  const amountId = useId();
  const dateId = useId();
  const countId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const effectiveAmount = getEffectiveTotalAmount(form.totalAmount, remainingBalance, midwayMode);
  const missing: string[] = [];
  if (form.name.trim().length === 0) missing.push("商品名");
  if (form.startDate === "") missing.push(midwayMode ? "次回引落日" : "初回引落日");
  if (form.paymentMethod !== "credit_card" && form.accountId === "") missing.push("引き落とし口座");
  if (effectiveAmount <= 0) missing.push(midwayMode ? "残り残高" : "総支払額");

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
      <FormField label="商品名" htmlFor={nameId} required>
        <Input id={nameId} ref={firstFieldRef} value={form.name} onChange={(event) => onFormChange({ ...form, name: event.target.value })} />
      </FormField>

      <FormField label="支払方法" htmlFor="loan-payment-method">
        <SegmentedControl
          aria-label="支払方法"
          value={form.paymentMethod}
          options={paymentMethodOptions}
          onChange={(paymentMethod) => onFormChange({ ...form, paymentMethod, accountId: paymentMethod === "credit_card" ? "" : form.accountId })}
        />
      </FormField>

      <FormField label="入力起点" htmlFor="loan-entry-mode">
        <SegmentedControl
          aria-label="入力起点"
          value={midwayMode ? "midway" : "normal"}
          options={entryModeOptions}
          onChange={(mode) => onMidwayModeChange(mode === "midway")}
        />
      </FormField>

      <FormField label={midwayMode ? "残り残高" : "総支払額"} htmlFor={amountId} required>
        <MoneyInput
          id={amountId}
          currencyCode="JPY"
          value={midwayMode ? remainingBalance : form.totalAmount}
          onChange={(value) => (midwayMode ? onRemainingBalanceChange(value) : onFormChange({ ...form, totalAmount: value }))}
        />
      </FormField>

      <FormField label={midwayMode ? "次回引落日" : "初回引落日"} htmlFor={dateId} required>
        <Input id={dateId} type="date" value={form.startDate} onChange={(event) => onFormChange({ ...form, startDate: event.target.value })} />
      </FormField>

      <FormField label={midwayMode ? "残り回数" : "支払回数"} htmlFor={countId} required>
        <Input
          id={countId}
          type="number"
          min={1}
          inputMode="numeric"
          value={form.paymentCount}
          onChange={(event) => onFormChange({ ...form, paymentCount: parseNumber(event.target.value) })}
        />
      </FormField>

      <ConditionalField show={form.paymentMethod === "account_withdrawal"}>
        <AccountSelect
          id="loan-account"
          label="引き落とし口座"
          accounts={accounts}
          value={form.accountId}
          onChange={(accountId) => onFormChange({ ...form, accountId })}
        />
      </ConditionalField>

      <DateShiftField id="loan-date-shift" value={form.dateShiftPolicy} onChange={(dateShiftPolicy) => onFormChange({ ...form, dateShiftPolicy })} />

      <div className="grid gap-2 border-l-2 border-line-strong pl-3 text-sm text-ink-2">
        <div className="text-xs font-medium text-ink-3">プレビュー</div>
        <div>
          月々の支払額プレビュー: <span className="font-data font-semibold text-ink">{formatCurrency(getPreviewAmount(effectiveAmount, form.paymentCount))}</span>
        </div>
        {helperText ? <div className="text-xs text-ink-3">{helperText}</div> : null}
      </div>

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
