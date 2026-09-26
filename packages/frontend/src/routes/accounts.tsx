import { SpendingBacklinks } from "../components/spending-backlink";
import {
  INT4_MAX,
  INT4_MIN,
  SUPPORTED_CURRENCY_CODES,
  type Account,
  type ReconcileAccountPayload,
  type ReconcileAccountResponse,
  type SupportedCurrencyCode,
} from "@sui/shared";
import { useId, useState, startTransition } from "react";
import { EditModal, type EditChange } from "../components/editing/edit-surface";
import { useEditSession, type EditErrors } from "../hooks/use-edit-session";
import { useFieldValidation } from "../hooks/use-field-validation";
import { ConditionalField } from "../components/ui/conditional-field";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { CardList } from "../components/ui/card-list";
import { Disclosure } from "../components/ui/disclosure";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { MoneyInput, readMoneyDraft } from "../components/ui/money-input";
import { Select } from "../components/ui/select";
import { useResource } from "../hooks/use-resource";
import { useIsDesktop } from "../components/ui/responsive-table";
import { Table, TableWrapper } from "../components/ui/table";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import {
  convertCurrencyInputToJpy,
  formatCurrencyInputValue,
  formatCurrencyParts,
  formatCurrencyWithJpy,
} from "../lib/format";
import { cn } from "../lib/utils";
import { Pencil, RefreshCcw, Trash2 } from "lucide-react";

type AccountForm = {
  name: string;
  balanceRaw: string;
  offsetRaw: string;
  supplementalBudgetEnabled: boolean;
  currencyCode: SupportedCurrencyCode;
  exchangeRateRaw: string;
  sortOrder: number;
};

const emptyForm: AccountForm = {
  name: "",
  balanceRaw: "0",
  offsetRaw: "0",
  supplementalBudgetEnabled: false,
  currencyCode: "JPY",
  exchangeRateRaw: "1",
  sortOrder: 0,
};

export function AccountsPage() {
  const desktopList = useIsDesktop(900);
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [reconcilingAccount, setReconcilingAccount] = useState<Account | null>(null);
  const [deletingAccount, setDeletingAccount] = useState<Account | null>(null);
  const { data, loading, error, setData } = useResource(() => apiFetch<Account[]>("/api/accounts"), [reloadKey]);
  const { toast } = useToast();

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));
  const refreshAccounts = async () => setData(await apiFetch<Account[]>("/api/accounts"));

  const requestDelete = (account: Account) => setDeletingAccount(account);

  const confirmDelete = async () => {
    if (!deletingAccount) {
      return;
    }

    try {
      await apiFetch(`/api/accounts/${deletingAccount.id}`, { method: "DELETE" });
      toast({ title: `${deletingAccount.name} を削除しました` });
      setDeletingAccount(null);
      reload();
    } catch (deleteError) {
      toast({ title: "口座の削除に失敗しました", description: describeError(deleteError), variant: "error" });
    }
  };

  const openEdit = (account: Account) => setEditingAccount(account);
  const openReconcile = (account: Account) => setReconcilingAccount(account);

  const accountAmounts = (account: Account) => {
    const balance = formatCurrencyParts(account.balance, account.currencyCode,
      convertCurrencyInputToJpy(account.balance, account.currencyCode, account.exchangeRateToJpy));
    const disposableAmount = account.balance - account.balanceOffset;
    const disposable = formatCurrencyParts(disposableAmount, account.currencyCode,
      convertCurrencyInputToJpy(disposableAmount, account.currencyCode, account.exchangeRateToJpy));
    return { balance, disposable };
  };
  const accountRate = (account: Account) => account.currencyCode === "JPY" ? "1" : `${account.exchangeRateToJpy.toLocaleString("ja-JP", { maximumFractionDigits: 4 })} JPY`;
  const accountActions = (account: Account) => <div className="flex justify-end gap-1">
        <IconButton aria-label={`${account.name}を編集`} onClick={() => openEdit(account)}><Pencil aria-hidden="true" className="h-4 w-4" /></IconButton>
        <IconButton aria-label={`${account.name}の残高照合`} title="残高照合" onClick={() => openReconcile(account)}><RefreshCcw aria-hidden="true" className="h-4 w-4" /></IconButton>
        <IconButton aria-label={`${account.name}を削除`} variant="danger" onClick={() => requestDelete(account)}><Trash2 aria-hidden="true" className="h-4 w-4" /></IconButton>
      </div>;
  const amountCell = (primary: string, secondary: string | null) => <div className="font-data whitespace-nowrap">
    <div className="font-semibold">{primary}</div>
    {secondary && <div className="text-xs text-ink-3">JPY換算 {secondary}</div>}
  </div>;
  const renderAccountCard = (account: Account) => {
    const { balance, disposable } = accountAmounts(account);
    return <div className="grid min-w-0 gap-2">
      <div className="break-words font-medium">{account.name}</div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div><div className="text-xs text-ink-3">残高</div>{amountCell(balance.primary, balance.secondary)}</div>
        <div><div className="text-xs text-ink-3">可処分残高</div>{amountCell(disposable.primary, disposable.secondary)}</div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-2">
        <span>通貨 {account.currencyCode}</span>
        <span>換算レート {accountRate(account)}</span>
        <span className="col-span-2">最終照合 {formatLastReconciledAt(account.lastReconciledAt)}</span>
      </div>
      {accountActions(account)}
    </div>;
  };

  return (
    <div className="grid gap-6">
      <SpendingBacklinks kind="account" reloadKey={reloadKey} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">口座管理</h2>
          <p className="mt-2 text-sm text-ink-2">口座の残高・オフセット・表示順を管理します。</p>
        </div>
        <Button className="min-h-10 gap-2" onClick={() => setCreateOpen(true)}>
          <span className="text-lg leading-none">+</span>
          口座を追加
        </Button>
      </div>

      <Card data-testid="accounts-list-card">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">口座一覧</h2>
          <div className="text-sm text-ink-2">{loading ? "読み込み中..." : `${data?.length ?? 0} 件`}</div>
        </div>
        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : (
          desktopList ? (data?.length ?? 0) === 0 ? <p className="text-sm text-ink-3">口座が登録されていません。上部の「口座を追加」から登録してください。</p> : <TableWrapper><Table className="w-full">
            <thead><tr className="border-b border-line text-left text-xs text-ink-3">
              <th scope="col" className="px-2 py-2">口座</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2">残高</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2">可処分残高</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2">換算レート</th>
              <th scope="col" className="whitespace-nowrap px-2 py-2">最終照合</th>
              <th scope="col" className="px-2 py-2"><span className="sr-only">操作</span></th>
            </tr></thead>
            <tbody>{(data ?? []).map((account) => {
              const { balance, disposable } = accountAmounts(account);
              return <tr key={account.id} className="border-b border-line">
                <td className="min-w-32 break-words px-2 py-3"><div className="font-medium">{account.name}</div><div className="text-xs text-ink-3">{account.currencyCode}</div></td>
                <td className="px-2 py-3">{amountCell(balance.primary, balance.secondary)}</td>
                <td className="px-2 py-3">{amountCell(disposable.primary, disposable.secondary)}</td>
                <td className="whitespace-nowrap px-2 py-3 text-xs">{accountRate(account)}</td>
                <td className="whitespace-nowrap px-2 py-3 text-xs">{formatLastReconciledAt(account.lastReconciledAt)}</td>
                <td className="px-2 py-2">{accountActions(account)}</td>
              </tr>;
            })}</tbody>
          </Table></TableWrapper> : <CardList
            rows={data ?? []}
            rowKey={(account) => account.id}
            emptyMessage="口座が登録されていません。上部の「口座を追加」から登録してください。"
            renderItem={renderAccountCard}
          />
        )}
      </Card>

      {createOpen && <AccountEditModal key="create" onClose={() => setCreateOpen(false)} onRefresh={refreshAccounts}
        onSaved={(name) => toast({ title: `${name} を追加しました` })} />}
      {editingAccount && <AccountEditModal key={editingAccount.id} account={editingAccount}
        onClose={() => setEditingAccount(null)} onRefresh={refreshAccounts}
        onSaved={(name) => toast({ title: `${name} を更新しました` })} />}
      {reconcilingAccount && <BalanceEditModal key={`reconcile:${reconcilingAccount.id}`} account={reconcilingAccount}
        onClose={() => setReconcilingAccount(null)} onRefresh={refreshAccounts}
        onSaved={() => toast({ title: `${reconcilingAccount.name} を照合しました` })} />}

      <ConfirmDialog
        open={Boolean(deletingAccount)}
        onOpenChange={(open) => !open && setDeletingAccount(null)}
        title="口座を削除しますか？"
        description={deletingAccount ? `「${deletingAccount.name}」を削除します。この操作は取り消せません。` : undefined}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function formFromAccount(account: Account): AccountForm {
  return {
    name: account.name,
    balanceRaw: formatCurrencyInputValue(account.balance, account.currencyCode),
    offsetRaw: formatCurrencyInputValue(account.balanceOffset, account.currencyCode),
    supplementalBudgetEnabled: account.supplementalBudgetEnabled ?? false,
    currencyCode: account.currencyCode,
    exchangeRateRaw: String(account.exchangeRateToJpy),
    sortOrder: account.sortOrder,
  };
}

function validAccountMoney(raw: string, currencyCode: SupportedCurrencyCode) {
  const result = readMoneyDraft(raw, currencyCode);
  return result.kind === "valid" && result.minorUnits !== null && result.minorUnits >= INT4_MIN && result.minorUnits <= INT4_MAX;
}

function validateAccount(form: AccountForm, creating: boolean): EditErrors {
  const errors: EditErrors = {};
  if (!form.name.trim()) errors.name = "口座名を入力してください。";
  if (form.name.length > 100) errors.name = "口座名は100文字以下で入力してください。";
  if (form.currencyCode !== "JPY" && (!form.exchangeRateRaw || !Number.isFinite(Number(form.exchangeRateRaw)) || Number(form.exchangeRateRaw) <= 0)) {
    errors.rate = "0より大きいJPY換算レートを入力してください。";
  }
  if (creating && !validAccountMoney(form.balanceRaw, form.currencyCode)) errors.balance = "初期残高を整数の最小通貨単位で入力してください。";
  if (!validAccountMoney(form.offsetRaw, form.currencyCode)) errors.offset = "オフセットを整数の最小通貨単位で入力してください。";
  if (!Number.isInteger(form.sortOrder) || form.sortOrder < INT4_MIN || form.sortOrder > INT4_MAX) errors.sortOrder = "表示順をint32の範囲で入力してください。";
  return errors;
}

function accountPayload(form: AccountForm, creating: boolean) {
  const details = {
    name: form.name.trim(),
    balanceOffset: readMoneyDraft(form.offsetRaw, form.currencyCode).minorUnits!,
    supplementalBudgetEnabled: form.supplementalBudgetEnabled,
    currencyCode: form.currencyCode,
    exchangeRateToJpy: form.currencyCode === "JPY" ? 1 : Number(form.exchangeRateRaw),
    sortOrder: form.sortOrder,
  };
  return creating ? { ...details, balance: readMoneyDraft(form.balanceRaw, form.currencyCode).minorUnits! } : details;
}

function AccountEditModal({ account, onClose, onRefresh, onSaved }: {
  account?: Account;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onSaved: (name: string) => void;
}) {
  const creating = !account;
  const nameId = useId();
  const currencyId = useId();
  const rateId = useId();
  const balanceId = useId();
  const offsetId = useId();
  const sortOrderId = useId();
  const fieldIds = { name: nameId, rate: rateId, balance: balanceId, offset: offsetId, sortOrder: sortOrderId };
  const validate = (draft: AccountForm) => validateAccount(draft, creating);
  const session = useEditSession({ identity: account ? `account:${account.id}:basic` : "account:new", initial: account ? formFromAccount(account) : emptyForm, validate, fieldIds });
  const { draft, setDraft } = session;
  const fields = useFieldValidation(draft, validate, fieldIds);
  const requestClose = () => session.requestClose(onClose);
  const refresh = async () => { await onRefresh(); return draft; };
  const save = async () => {
    fields.showAll();
    const succeeded = await session.save(async (next) => {
      await apiFetch(account ? `/api/accounts/${account.id}` : "/api/accounts", {
        method: account ? "PUT" : "POST", body: JSON.stringify(accountPayload(next, creating)),
      });
    }, refresh);
    if (succeeded) { onSaved(draft.name); onClose(); }
  };
  const changes: EditChange[] = [];
  const changed = (label: string, before: string, after: string) => {
    if (before !== after) changes.push({ label, before: before || "—", after: after || "—" });
  };
  const initial = account ? formFromAccount(account) : emptyForm;
  changed("口座名", initial.name, draft.name);
  changed("通貨", initial.currencyCode, draft.currencyCode);
  changed("換算レート", initial.exchangeRateRaw, draft.exchangeRateRaw);
  changed("オフセット", initial.offsetRaw, draft.offsetRaw);
  changed("補正予算の資金元", initial.supplementalBudgetEnabled ? "利用する" : "利用しない", draft.supplementalBudgetEnabled ? "利用する" : "利用しない");
  changed("表示順", String(initial.sortOrder), String(draft.sortOrder));
  if (creating) changed("初期残高", "—", draft.balanceRaw);
  const setCurrency = (currencyCode: SupportedCurrencyCode) => {
    const preserve = (raw: string) => {
      const amount = readMoneyDraft(raw, draft.currencyCode);
      return amount.minorUnits === null ? raw : formatCurrencyInputValue(amount.minorUnits, currencyCode);
    };
    setDraft({ ...draft, currencyCode, balanceRaw: preserve(draft.balanceRaw), offsetRaw: preserve(draft.offsetRaw),
      exchangeRateRaw: currencyCode === "JPY" ? "1" : draft.exchangeRateRaw });
  };

  return <EditModal open subjectType="口座" subjectName={account?.name ?? "口座"}
    title={account ? `${account.name}の基本情報を編集` : "口座を追加"} mode={account ? "edit" : "create"}
    status={session.status} changes={changes} error={session.error}
    impact={creating ? "初期残高を含む口座を登録します。" : "基本情報と表示設定を更新します。現在残高と照合日時は変更しません。"}
    saveLabel={account ? "変更を保存" : "口座を追加"} onRequestClose={requestClose}
    onSave={() => void save()} onRetryRefresh={() => void session.retryRefresh().then((ok) => { if (ok) { onSaved(draft.name); onClose(); } })}>
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <FormField label="口座名" htmlFor={nameId} required error={fields.visibleErrors.name}>
        <Input id={nameId} value={draft.name} onBlur={() => fields.touch("name")}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </FormField>
      <FormField label="通貨" htmlFor={currencyId}>
        <Select id={currencyId} value={draft.currencyCode} onChange={(event) => setCurrency(event.target.value as SupportedCurrencyCode)}>
          {SUPPORTED_CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
        </Select>
      </FormField>
      <ConditionalField show={draft.currencyCode !== "JPY"}>
        <FormField label="JPY換算レート" htmlFor={rateId} error={fields.visibleErrors.rate}>
          <Input id={rateId} type="number" inputMode="decimal" min="0" step="0.0001"
            value={draft.exchangeRateRaw} onBlur={() => fields.touch("rate")}
            onChange={(event) => setDraft({ ...draft, exchangeRateRaw: event.target.value })} />
        </FormField>
      </ConditionalField>
      {creating ? <FormField label={`初期残高 (${draft.currencyCode})`} htmlFor={balanceId} required error={fields.visibleErrors.balance}>
        <MoneyInput id={balanceId} currencyCode={draft.currencyCode} value={readMoneyDraft(draft.balanceRaw, draft.currencyCode).minorUnits}
          draftValue={draft.balanceRaw} onChange={() => {}} onDraftChange={(next) => setDraft({ ...draft, balanceRaw: next.raw })}
          onBlur={() => fields.touch("balance")} />
      </FormField> : <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm">
        <p className="text-ink-2">現在残高（参考）</p><p className="font-data mt-1">{formatAccountMoney(account!, account!.balance)}</p>
        <p className="mt-1 text-xs text-ink-3">実残高の確認と差額の記録は「残高照合」から行います。</p>
      </div>}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.supplementalBudgetEnabled}
          onChange={(event) => setDraft({ ...draft, supplementalBudgetEnabled: event.target.checked })} />
        補正予算の資金元として利用する
      </label>
      <FormField label={`オフセット (${draft.currencyCode})`} htmlFor={offsetId}
        help="残高から差し引く保護額です。" error={fields.visibleErrors.offset}>
        <MoneyInput id={offsetId} currencyCode={draft.currencyCode} value={readMoneyDraft(draft.offsetRaw, draft.currencyCode).minorUnits}
          draftValue={draft.offsetRaw} onChange={() => {}} onDraftChange={(next) => setDraft({ ...draft, offsetRaw: next.raw })}
          onBlur={() => fields.touch("offset")} />
      </FormField>
      <Disclosure summary="詳細設定">
        <FormField label="表示順" htmlFor={sortOrderId} error={fields.visibleErrors.sortOrder}>
          <Input id={sortOrderId} type="number" inputMode="numeric" value={draft.sortOrder}
            onBlur={() => fields.touch("sortOrder")}
            onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} />
        </FormField>
      </Disclosure>
      <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>保存</button>
    </form>
  </EditModal>;
}

function BalanceEditModal({ account, onClose, onRefresh, onSaved }: {
  account: Account;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onSaved: () => void;
}) {
  const inputId = useId();
  const [confirmed, setConfirmed] = useState<{ balance: number; diff: number } | null>(null);
  const initial = { balanceRaw: formatCurrencyInputValue(account.balance, account.currencyCode) };
  const validate = (draft: typeof initial): EditErrors => {
    const parsed = readMoneyDraft(draft.balanceRaw, account.currencyCode);
    if (parsed.kind !== "valid" || parsed.minorUnits === null || parsed.minorUnits < INT4_MIN || parsed.minorUnits > INT4_MAX) {
      return { balance: "実際の残高を最小通貨単位の整数で入力してください。" };
    }
    const diff = parsed.minorUnits - account.balance;
    return diff < INT4_MIN || diff > INT4_MAX ? { balance: "現在残高との差額がint32の範囲を超えます。" } : {};
  };
  const session = useEditSession({ identity: `account:${account.id}:reconcile`, initial, validate, fieldIds: { balance: inputId } });
  const fields = useFieldValidation(session.draft, validate, { balance: inputId });
  const next = readMoneyDraft(session.draft.balanceRaw, account.currencyCode).minorUnits;
  const diff = next === null ? null : next - account.balance;
  const requestClose = () => session.requestClose(onClose);
  const refresh = async () => { await onRefresh(); return session.draft; };
  const save = async () => {
    fields.showAll();
    const succeeded = await session.save(async (draft) => {
      const balance = readMoneyDraft(draft.balanceRaw, account.currencyCode).minorUnits!;
      const latest = (await apiFetch<Account[]>("/api/accounts")).find((item) => item.id === account.id);
      if (!latest) throw new Error("口座が見つかりません。最新状態を確認してください。");
      if (latest.currencyCode !== account.currencyCode) throw new Error("口座の通貨が変更されました。画面を開き直して残高を確認してください。");
      const payload: ReconcileAccountPayload = { actualBalance: balance };
      const result = await apiFetch<ReconcileAccountResponse>(`/api/accounts/${account.id}/reconcile`, {
        method: "POST", body: JSON.stringify(payload),
      });
      setConfirmed({ balance: result.account.balance, diff: result.diff });
    }, refresh);
    if (succeeded) { onSaved(); onClose(); }
  };
  const changes: EditChange[] = next === null ? [] : [{
    label: "残高", before: formatAccountMoney(account, account.balance), after: formatAccountMoney(account, next),
  }];
  return <EditModal open subjectType="口座残高" subjectName={account.name}
    title={`${account.name}の残高を照合`}
    mode="record" status={session.status}
    changes={changes} error={session.error}
    impact="差額を調整取引として記録し、差額が0でも最終照合日時を更新します。"
    saveLabel="照合を記録"
    onRequestClose={requestClose} onSave={() => void save()}
    onRetryRefresh={() => void session.retryRefresh().then((ok) => { if (ok) { onSaved(); onClose(); } })}>
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <FormField label={`実残高 (${account.currencyCode})`}
        htmlFor={inputId} required error={fields.visibleErrors.balance}>
        <MoneyInput id={inputId} currencyCode={account.currencyCode} value={next} draftValue={session.draft.balanceRaw}
          onChange={() => {}} onDraftChange={(value) => session.setDraft({ balanceRaw: value.raw })}
          onBlur={() => fields.touch("balance")} />
      </FormField>
      <div className="grid gap-3 rounded-xl border border-line bg-surface-2 p-4 text-sm">
        <div className="flex items-center justify-between gap-3"><span>現在の記録残高</span><span className="font-data">{formatAccountMoney(account, account.balance)}</span></div>
        <div className="flex items-center justify-between gap-3"><span>予定差額</span><span className={cn("font-data", diff === null || diff === 0 ? "text-ink" : diff > 0 ? "text-positive" : "text-critical")}>{diff === null ? "—" : formatSignedAccountMoney(account, diff)}</span></div>
        <p className="text-xs text-ink-3">保存時は最新の記録残高との差額で確定します。</p>
      </div>
      {confirmed && <p role="status" className="rounded-lg border border-positive/40 bg-positive/10 p-3 text-sm">
        記録済み残高 {formatAccountMoney(account, confirmed.balance)}・確定差額 {formatSignedAccountMoney(account, confirmed.diff)}
      </p>}
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

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

const lastReconciledAtFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "short",
  day: "numeric",
});

function formatLastReconciledAt(value: string | null) {
  if (!value) {
    return "未照合";
  }

  return lastReconciledAtFormatter.format(new Date(value));
}

function formatAccountMoney(account: Account, amount: number) {
  const amountJpy = convertCurrencyInputToJpy(amount, account.currencyCode, account.exchangeRateToJpy);
  return formatCurrencyWithJpy(amount, account.currencyCode, amountJpy);
}

function formatSignedAccountMoney(account: Account, amount: number) {
  const formatted = formatAccountMoney(account, amount);
  return amount > 0 ? `+${formatted}` : formatted;
}
