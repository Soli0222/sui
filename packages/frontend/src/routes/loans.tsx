import type { Account, Loan } from "@sui/shared";
import { startTransition, useState } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { useResource } from "../hooks/use-resource";
import { apiFetch } from "../lib/api";
import { formatCurrency, formatDateWithYear } from "../lib/format";

type LoanForm = {
  name: string;
  totalAmount: number;
  startDate: string;
  paymentCount: number;
  accountId: string;
};

const emptyForm: LoanForm = {
  name: "",
  totalAmount: 0,
  startDate: "",
  paymentCount: 1,
  accountId: "",
};

function parseNumber(value: string) {
  return Number(value === "" ? 0 : value);
}

function getPreviewAmount(totalAmount: number, paymentCount: number) {
  if (paymentCount < 1 || totalAmount < 1) {
    return 0;
  }

  return Math.ceil(totalAmount / paymentCount);
}

export function LoansPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState<LoanForm>(emptyForm);
  const [midwayMode, setMidwayMode] = useState(false);
  const [remainingBalance, setRemainingBalance] = useState(0);
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
  const [editForm, setEditForm] = useState<LoanForm>(emptyForm);
  const [editMidwayMode, setEditMidwayMode] = useState(false);
  const [editRemainingBalance, setEditRemainingBalance] = useState(0);

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
    form.accountId !== "" &&
    form.paymentCount >= 1 &&
    getEffectiveTotalAmount(form.totalAmount, remainingBalance, midwayMode) > 0;
  const canSaveEdit =
    editForm.name.trim().length > 0 &&
    editForm.startDate !== "" &&
    editForm.accountId !== "" &&
    editForm.paymentCount >= 1 &&
    getEffectiveTotalAmount(editForm.totalAmount, editRemainingBalance, editMidwayMode) > 0;

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));

  const createLoan = async () => {
    await apiFetch("/api/loans", {
      method: "POST",
      body: JSON.stringify({
        ...form,
        totalAmount: getEffectiveTotalAmount(form.totalAmount, remainingBalance, midwayMode),
      }),
    });

    setForm({ ...emptyForm, accountId: accounts[0]?.id ?? "" });
    setMidwayMode(false);
    setRemainingBalance(0);
    reload();
  };

  const updateLoan = async (loanId: string, nextForm: LoanForm, nextRemainingBalance: number, nextMidwayMode: boolean) => {
    await apiFetch(`/api/loans/${loanId}`, {
      method: "PUT",
      body: JSON.stringify({
        ...nextForm,
        totalAmount: getEffectiveTotalAmount(nextForm.totalAmount, nextRemainingBalance, nextMidwayMode),
      }),
    });
    reload();
  };

  const deleteLoan = async (loanId: string) => {
    if (!window.confirm("このローンを削除します。よろしいですか？")) {
      return;
    }

    await apiFetch(`/api/loans/${loanId}`, { method: "DELETE" });
    reload();
  };

  const openEdit = (loan: Loan) => {
    setEditingLoan(loan);
    setEditForm({
      name: loan.name,
      totalAmount: loan.totalAmount,
      startDate: loan.startDate.slice(0, 10),
      paymentCount: loan.paymentCount,
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

    await updateLoan(editingLoan.id, editForm, editRemainingBalance, editMidwayMode);
    closeEdit();
  };

  return (
    <div className="grid gap-6">
      <Card className="grid gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">ローンを追加</h2>
          <MidwayToggle enabled={midwayMode} onChange={setMidwayMode} />
        </div>
        <LoanFormFields
          accounts={accounts}
          form={form}
          midwayMode={midwayMode}
          remainingBalance={remainingBalance}
          onFormChange={setForm}
          onRemainingBalanceChange={setRemainingBalance}
        />
        <LoanPreview
          totalAmount={getEffectiveTotalAmount(form.totalAmount, remainingBalance, midwayMode)}
          paymentCount={form.paymentCount}
        />
        <div className="flex justify-end">
          <Button disabled={!canCreate} onClick={createLoan}>
            追加
          </Button>
        </div>
        <div className="text-sm text-white/60">
          {loading ? "読み込み中..." : error ?? "途中参入モードでは残り残高・次回引落日・残り回数をそのまま保存します。"}
        </div>
      </Card>

      <Card className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">ローン一覧</h2>
          <div className="text-sm text-white/60">{loading ? "読み込み中..." : `${loans.length} 件`}</div>
        </div>
        {loans.map((loan) => (
          <LoanRow key={loan.id} loan={loan} accounts={accounts} onEdit={openEdit} onDelete={deleteLoan} />
        ))}
      </Card>

      <Dialog open={Boolean(editingLoan)} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent className="w-[min(92vw,40rem)]">
          <DialogTitle className="text-lg font-semibold">ローンを編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-white/60">
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
  onDelete: (loanId: string) => Promise<void>;
}) {
  return (
    <div className="grid gap-4 rounded-2xl border border-white/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-base font-semibold">{loan.name}</div>
          <div className="text-sm text-white/55">
            現在の残り残高 {formatCurrency(loan.remainingBalance)} / 残り {loan.remainingPayments} 回 / 次回 {formatCurrency(loan.nextPaymentAmount)}
          </div>
          <div className="mt-2 text-sm text-white/55">
            引き落とし口座 {accounts.find((account) => account.id === loan.accountId)?.name ?? "未設定"} / 初回引落日 {formatDateWithYear(loan.startDate.slice(0, 10))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onEdit(loan)}>
            編集
          </Button>
          <Button variant="danger" onClick={() => onDelete(loan.id)}>
            削除
          </Button>
        </div>
      </div>
      <div className="text-sm text-white/60">
        予測ベースの次回支払額と残り回数を一覧表示しています。
      </div>
    </div>
  );
}

function LoanFormFields({
  accounts,
  form,
  midwayMode,
  remainingBalance,
  onFormChange,
  onRemainingBalanceChange,
}: {
  accounts: Account[];
  form: LoanForm;
  midwayMode: boolean;
  remainingBalance: number;
  onFormChange: (next: LoanForm) => void;
  onRemainingBalanceChange: (value: number) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
      <label className="grid gap-2 text-sm xl:col-span-2">
        <span>商品名 *</span>
        <Input value={form.name} onChange={(event) => onFormChange({ ...form, name: event.target.value })} />
      </label>
      <label className="grid gap-2 text-sm">
        <span>総支払額 *</span>
        <Input
          type="number"
          min={0}
          inputMode="numeric"
          disabled={midwayMode}
          className={midwayMode ? "bg-white/5 text-white/35" : undefined}
          value={form.totalAmount}
          onChange={(event) => onFormChange({ ...form, totalAmount: parseNumber(event.target.value) })}
        />
      </label>
      {midwayMode ? (
        <label className="grid gap-2 text-sm">
          <span>残り残高 *</span>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            value={remainingBalance}
            onChange={(event) => onRemainingBalanceChange(parseNumber(event.target.value))}
          />
        </label>
      ) : null}
      <label className="grid gap-2 text-sm">
        <span>{midwayMode ? "次回引落日 *" : "初回引落日 *"}</span>
        <Input
          type="date"
          value={form.startDate}
          onChange={(event) => onFormChange({ ...form, startDate: event.target.value })}
        />
      </label>
      <label className="grid gap-2 text-sm">
        <span>{midwayMode ? "残り回数 *" : "支払回数 *"}</span>
        <Input
          type="number"
          min={1}
          inputMode="numeric"
          value={form.paymentCount}
          onChange={(event) => onFormChange({ ...form, paymentCount: parseNumber(event.target.value) })}
        />
      </label>
      <label className="grid gap-2 text-sm">
        <span>引き落とし口座 *</span>
        <Select value={form.accountId} onChange={(event) => onFormChange({ ...form, accountId: event.target.value })}>
          <option value="">口座を選択</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </Select>
      </label>
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
}) {
  return (
    <div className="mt-6 grid gap-5">
      <section className="grid gap-4">
        <div className="text-xs uppercase tracking-[0.18em] text-white/45">基本情報</div>
        <label className="grid gap-2 text-sm">
          <span>商品名 *</span>
          <Input value={form.name} onChange={(event) => onFormChange({ ...form, name: event.target.value })} />
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm">
            <span>総支払額 *</span>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              disabled={midwayMode}
              className={midwayMode ? "bg-white/5 text-white/35" : undefined}
              value={form.totalAmount}
              onChange={(event) => onFormChange({ ...form, totalAmount: parseNumber(event.target.value) })}
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span>引き落とし口座 *</span>
            <Select value={form.accountId} onChange={(event) => onFormChange({ ...form, accountId: event.target.value })}>
              <option value="">口座を選択</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </Select>
          </label>
          {!midwayMode ? (
            <>
              <label className="grid gap-2 text-sm">
                <span>初回引落日 *</span>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(event) => onFormChange({ ...form, startDate: event.target.value })}
                />
              </label>
              <label className="grid gap-2 text-sm">
                <span>支払回数 *</span>
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={form.paymentCount}
                  onChange={(event) => onFormChange({ ...form, paymentCount: parseNumber(event.target.value) })}
                />
              </label>
            </>
          ) : null}
        </div>
      </section>

      <section className="grid gap-4 border-t border-white/10 pt-4">
        <div className="text-xs uppercase tracking-[0.18em] text-white/45">途中参入</div>
        <MidwayToggle enabled={midwayMode} onChange={onMidwayModeChange} />
        {midwayMode ? (
          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2 text-sm">
              <span>残り残高 *</span>
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                value={remainingBalance}
                onChange={(event) => onRemainingBalanceChange(parseNumber(event.target.value))}
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span>次回引落日 *</span>
              <Input
                type="date"
                value={form.startDate}
                onChange={(event) => onFormChange({ ...form, startDate: event.target.value })}
              />
            </label>
            <label className="grid gap-2 text-sm">
              <span>残り回数 *</span>
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                value={form.paymentCount}
                onChange={(event) => onFormChange({ ...form, paymentCount: parseNumber(event.target.value) })}
              />
            </label>
          </div>
        ) : null}
      </section>

      <section className="grid gap-3 border-t border-white/10 pt-4">
        <div className="text-xs uppercase tracking-[0.18em] text-white/45">プレビュー</div>
        <LoanPreview
          totalAmount={getEffectiveTotalAmount(form.totalAmount, remainingBalance, midwayMode)}
          paymentCount={form.paymentCount}
        />
      </section>

      <div className="flex justify-end gap-3 border-t border-white/10 pt-4">
        <Button variant="ghost" onClick={onCancel}>
          キャンセル
        </Button>
        <Button disabled={!canSave} onClick={onSave}>
          保存
        </Button>
      </div>
    </div>
  );
}

function MidwayToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-2 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-[var(--color-primary)]" checked={enabled} onChange={(event) => onChange(event.target.checked)} />
      <span>途中から入力する</span>
    </label>
  );
}

function LoanPreview({
  totalAmount,
  paymentCount,
}: {
  totalAmount: number;
  paymentCount: number;
}) {
  return (
    <div className="rounded-r-2xl border-l-2 border-primary bg-white/5 p-4 text-sm text-white/70">
      月々の支払額プレビュー:{" "}
      <span className="font-semibold text-white">{formatCurrency(getPreviewAmount(totalAmount, paymentCount))}</span>
    </div>
  );
}

function getEffectiveTotalAmount(totalAmount: number, remainingBalance: number, midwayMode: boolean) {
  return midwayMode ? remainingBalance : totalAmount;
}
