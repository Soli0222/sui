import type { Account, PersonalDebt, PersonalDebtsResponse, SplitBill, SplitBillsResponse } from "@sui/shared";
import { useMemo, useState, startTransition } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { Table, TableWrapper } from "../components/ui/table";
import { useResource } from "../hooks/use-resource";
import { apiFetch } from "../lib/api";
import { formatCurrency, formatDateWithYear } from "../lib/format";
import { getTodayDate } from "../lib/utils";

type Tab = "debts" | "splitBills";
type StatusFilter = "all" | "open" | "settled" | "canceled";

const statusLabels = {
  open: "未精算",
  settled: "完済",
  canceled: "取消",
} as const;

const directionLabels = {
  lent: "貸した",
  borrowed: "借りた",
} as const;

type DebtForm = {
  direction: "lent" | "borrowed";
  counterpartyName: string;
  title: string;
  principalAmount: number;
  openedDate: string;
  dueDate: string;
  accountId: string;
  memo: string;
};

type SplitBillForm = {
  title: string;
  totalAmount: number;
  paidDate: string;
  payerType: "self" | "other";
  payerName: string;
  accountId: string;
  dueDate: string;
  participantsText: string;
  memo: string;
};

function emptyDebtForm(today: string): DebtForm {
  return {
    direction: "lent",
    counterpartyName: "",
    title: "",
    principalAmount: 0,
    openedDate: today,
    dueDate: "",
    accountId: "",
    memo: "",
  };
}

function emptySplitBillForm(today: string): SplitBillForm {
  return {
    title: "",
    totalAmount: 0,
    paidDate: today,
    payerType: "self",
    payerName: "",
    accountId: "",
    dueDate: "",
    participantsText: "Aさん, Bさん",
    memo: "",
  };
}

function parseParticipants(text: string) {
  const names = text
    .split(/\r?\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);

  return [
    { name: "自分", isSelf: true, sortOrder: 0 },
    ...names.map((name, index) => ({ name, isSelf: false, sortOrder: index + 1 })),
  ];
}

function previewShares(totalAmount: number, text: string) {
  const participants = parseParticipants(text);
  if (participants.length === 0) {
    return [];
  }

  const base = Math.floor(totalAmount / participants.length);
  let remainder = totalAmount % participants.length;
  return participants.map((participant) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { ...participant, shareAmount: base + extra };
  });
}

export function PersonalDebtsPage() {
  const today = getTodayDate();
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<Tab>("debts");
  const [status, setStatus] = useState<StatusFilter>("open");
  const [debtForm, setDebtForm] = useState<DebtForm>(() => emptyDebtForm(today));
  const [splitBillForm, setSplitBillForm] = useState<SplitBillForm>(() => emptySplitBillForm(today));
  const [settlingDebt, setSettlingDebt] = useState<PersonalDebt | null>(null);
  const [settlementAmount, setSettlementAmount] = useState(0);
  const [settlementDate, setSettlementDate] = useState(today);
  const [settlementAccountId, setSettlementAccountId] = useState("");

  const { data, loading, error } = useResource(
    () =>
      Promise.all([
        apiFetch<Account[]>("/api/accounts"),
        apiFetch<PersonalDebtsResponse>(`/api/personal-debts?status=${status}`),
        apiFetch<SplitBillsResponse>(`/api/split-bills?status=${status}`),
      ]).then(([accounts, debts, splitBills]) => ({ accounts, debts, splitBills })),
    [reloadKey, status],
  );

  const accounts = data?.accounts ?? [];
  const debts = data?.debts ?? [];
  const splitBills = data?.splitBills ?? [];
  const sharePreview = useMemo(
    () => previewShares(splitBillForm.totalAmount, splitBillForm.participantsText),
    [splitBillForm.totalAmount, splitBillForm.participantsText],
  );

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));

  const createDebt = async () => {
    await apiFetch("/api/personal-debts", {
      method: "POST",
      body: JSON.stringify({
        ...debtForm,
        dueDate: debtForm.dueDate || null,
        memo: debtForm.memo || null,
      }),
    });
    setDebtForm(emptyDebtForm(today));
    reload();
  };

  const createSplitBill = async () => {
    await apiFetch("/api/split-bills", {
      method: "POST",
      body: JSON.stringify({
        title: splitBillForm.title,
        totalAmount: splitBillForm.totalAmount,
        paidDate: splitBillForm.paidDate,
        payerType: splitBillForm.payerType,
        payerName: splitBillForm.payerType === "other" ? splitBillForm.payerName : null,
        accountId: splitBillForm.accountId,
        splitMethod: "equal",
        dueDate: splitBillForm.dueDate || null,
        memo: splitBillForm.memo || null,
        participants: parseParticipants(splitBillForm.participantsText),
      }),
    });
    setSplitBillForm(emptySplitBillForm(today));
    reload();
  };

  const openSettlement = (debt: PersonalDebt) => {
    setSettlingDebt(debt);
    setSettlementAmount(debt.remainingAmount);
    setSettlementDate(today);
    setSettlementAccountId(debt.accountId);
  };

  const closeSettlement = () => {
    setSettlingDebt(null);
    setSettlementAmount(0);
    setSettlementDate(today);
    setSettlementAccountId("");
  };

  const saveSettlement = async () => {
    if (!settlingDebt) {
      return;
    }

    await apiFetch(`/api/personal-debts/${settlingDebt.id}/settlements`, {
      method: "POST",
      body: JSON.stringify({
        amount: settlementAmount,
        date: settlementDate,
        accountId: settlementAccountId || undefined,
      }),
    });
    closeSettlement();
    reload();
  };

  const canCreateDebt =
    debtForm.counterpartyName.trim() &&
    debtForm.title.trim() &&
    debtForm.principalAmount > 0 &&
    debtForm.accountId &&
    debtForm.openedDate;
  const canCreateSplitBill =
    splitBillForm.title.trim() &&
    splitBillForm.totalAmount > 0 &&
    splitBillForm.accountId &&
    splitBillForm.paidDate &&
    sharePreview.length >= 2 &&
    (splitBillForm.payerType === "self" || splitBillForm.payerName.trim());

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">貸し借り</h2>
          <p className="mt-2 text-sm text-white/60">個人間の貸し借りと割り勘精算を管理します。</p>
        </div>
        <Select
          aria-label="ステータス"
          className="w-auto min-w-36"
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
        >
          <option value="open">未精算</option>
          <option value="settled">完済</option>
          <option value="canceled">取消</option>
          <option value="all">すべて</option>
        </Select>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={tab === "debts" ? "primary" : "ghost"} onClick={() => setTab("debts")}>
          貸し借り
        </Button>
        <Button variant={tab === "splitBills" ? "primary" : "ghost"} onClick={() => setTab("splitBills")}>
          割り勘
        </Button>
      </div>

      {tab === "debts" ? (
        <>
          <Card>
            <h3 className="text-lg font-semibold">1 対 1 の貸し借りを追加</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Select
                aria-label="貸し借り種別"
                value={debtForm.direction}
                onChange={(event) => setDebtForm({ ...debtForm, direction: event.target.value as "lent" | "borrowed" })}
              >
                <option value="lent">貸した</option>
                <option value="borrowed">借りた</option>
              </Select>
              <Input
                aria-label="相手"
                placeholder="相手"
                value={debtForm.counterpartyName}
                onChange={(event) => setDebtForm({ ...debtForm, counterpartyName: event.target.value })}
              />
              <Input
                aria-label="タイトル"
                placeholder="タイトル"
                value={debtForm.title}
                onChange={(event) => setDebtForm({ ...debtForm, title: event.target.value })}
              />
              <Input
                aria-label="元金"
                type="number"
                inputMode="numeric"
                value={debtForm.principalAmount}
                onChange={(event) => setDebtForm({ ...debtForm, principalAmount: Number(event.target.value) })}
              />
              <Input
                aria-label="発生日"
                type="date"
                value={debtForm.openedDate}
                onChange={(event) => setDebtForm({ ...debtForm, openedDate: event.target.value })}
              />
              <Input
                aria-label="返済予定日"
                type="date"
                value={debtForm.dueDate}
                onChange={(event) => setDebtForm({ ...debtForm, dueDate: event.target.value })}
              />
              <Select
                aria-label="入出金口座"
                value={debtForm.accountId}
                onChange={(event) => setDebtForm({ ...debtForm, accountId: event.target.value })}
              >
                <option value="">入出金口座</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
              <Button disabled={!canCreateDebt} onClick={createDebt}>
                追加
              </Button>
            </div>
          </Card>

          <Card>
            <ListHeader loading={loading} error={error} count={debts.length} />
            <DebtTable debts={debts} onSettle={openSettlement} />
          </Card>
        </>
      ) : (
        <>
          <Card>
            <h3 className="text-lg font-semibold">割り勘を追加</h3>
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Input
                aria-label="割り勘タイトル"
                placeholder="タイトル"
                value={splitBillForm.title}
                onChange={(event) => setSplitBillForm({ ...splitBillForm, title: event.target.value })}
              />
              <Input
                aria-label="総額"
                type="number"
                inputMode="numeric"
                value={splitBillForm.totalAmount}
                onChange={(event) => setSplitBillForm({ ...splitBillForm, totalAmount: Number(event.target.value) })}
              />
              <Input
                aria-label="支払日"
                type="date"
                value={splitBillForm.paidDate}
                onChange={(event) => setSplitBillForm({ ...splitBillForm, paidDate: event.target.value })}
              />
              <Select
                aria-label="支払者"
                value={splitBillForm.payerType}
                onChange={(event) => setSplitBillForm({ ...splitBillForm, payerType: event.target.value as "self" | "other" })}
              >
                <option value="self">自分が支払った</option>
                <option value="other">他人が支払った</option>
              </Select>
              {splitBillForm.payerType === "other" ? (
                <Input
                  aria-label="立替者"
                  placeholder="立替者"
                  value={splitBillForm.payerName}
                  onChange={(event) => setSplitBillForm({ ...splitBillForm, payerName: event.target.value })}
                />
              ) : null}
              <Select
                aria-label="精算口座"
                value={splitBillForm.accountId}
                onChange={(event) => setSplitBillForm({ ...splitBillForm, accountId: event.target.value })}
              >
                <option value="">精算口座</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
              <Input
                aria-label="割り勘返済予定日"
                type="date"
                value={splitBillForm.dueDate}
                onChange={(event) => setSplitBillForm({ ...splitBillForm, dueDate: event.target.value })}
              />
              <Input
                aria-label="参加者"
                placeholder="Aさん, Bさん"
                value={splitBillForm.participantsText}
                onChange={(event) => setSplitBillForm({ ...splitBillForm, participantsText: event.target.value })}
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {sharePreview.map((participant) => (
                <span key={`${participant.sortOrder}:${participant.name}`} className="rounded-full bg-white/10 px-3 py-1 text-sm">
                  {participant.name}: {formatCurrency(participant.shareAmount)}
                </span>
              ))}
              <Button disabled={!canCreateSplitBill} onClick={createSplitBill}>
                追加
              </Button>
            </div>
          </Card>

          <Card>
            <ListHeader loading={loading} error={error} count={splitBills.length} />
            <SplitBillTable splitBills={splitBills} onSettle={openSettlement} />
          </Card>
        </>
      )}

      <Dialog open={Boolean(settlingDebt)} onOpenChange={(open) => !open && closeSettlement()}>
        <DialogContent className="w-[min(92vw,32rem)]">
          <DialogTitle className="text-lg font-semibold">返済・精算を登録</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-white/60">
            精算額に応じて取引履歴と口座残高を更新します。
          </DialogDescription>
          {settlingDebt ? (
            <div className="mt-6 grid gap-4">
              <div className="rounded-2xl bg-white/5 p-4 text-sm">
                <div>{settlingDebt.title}</div>
                <div className="mt-1 text-white/60">残額 {formatCurrency(settlingDebt.remainingAmount)}</div>
              </div>
              <Input
                aria-label="精算額"
                type="number"
                inputMode="numeric"
                value={settlementAmount}
                onChange={(event) => setSettlementAmount(Number(event.target.value))}
              />
              <Input
                aria-label="精算日"
                type="date"
                value={settlementDate}
                onChange={(event) => setSettlementDate(event.target.value)}
              />
              <Select
                aria-label="精算入出金口座"
                value={settlementAccountId}
                onChange={(event) => setSettlementAccountId(event.target.value)}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </Select>
              <div className="flex justify-end gap-3">
                <Button variant="ghost" onClick={closeSettlement}>
                  キャンセル
                </Button>
                <Button disabled={settlementAmount <= 0} onClick={saveSettlement}>
                  登録
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ListHeader({ loading, error, count }: { loading: boolean; error: string | null; count: number }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h3 className="text-lg font-semibold">一覧</h3>
      <div className="text-sm text-white/60">{loading ? "読み込み中..." : error ?? `${count} 件`}</div>
    </div>
  );
}

function DebtTable({ debts, onSettle }: { debts: PersonalDebt[]; onSettle: (debt: PersonalDebt) => void }) {
  return (
    <TableWrapper>
      <Table className="min-w-[72rem]">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.18em] text-white/45">
            <th className="px-3 py-3">種別</th>
            <th className="px-3 py-3">相手</th>
            <th className="px-3 py-3">タイトル</th>
            <th className="px-3 py-3">元金</th>
            <th className="px-3 py-3">返済済み</th>
            <th className="px-3 py-3">残額</th>
            <th className="px-3 py-3">期限</th>
            <th className="px-3 py-3">ステータス</th>
            <th className="px-3 py-3" />
          </tr>
        </thead>
        <tbody>
          {debts.map((debt) => (
            <tr key={debt.id} className="border-b border-white/5">
              <td className="px-3 py-3">{directionLabels[debt.direction]}</td>
              <td className="px-3 py-3">{debt.counterpartyName}</td>
              <td className="px-3 py-3">{debt.title}</td>
              <td className="px-3 py-3">{formatCurrency(debt.principalAmount)}</td>
              <td className="px-3 py-3">{formatCurrency(debt.settledAmount)}</td>
              <td className="px-3 py-3">{formatCurrency(debt.remainingAmount)}</td>
              <td className="px-3 py-3">{debt.dueDate ? formatDateWithYear(debt.dueDate) : "-"}</td>
              <td className="px-3 py-3">{statusLabels[debt.status]}</td>
              <td className="px-3 py-3 text-right">
                <Button disabled={debt.remainingAmount <= 0 || debt.status !== "open"} variant="ghost" onClick={() => onSettle(debt)}>
                  返済登録
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrapper>
  );
}

function SplitBillTable({
  splitBills,
  onSettle,
}: {
  splitBills: SplitBill[];
  onSettle: (debt: PersonalDebt) => void;
}) {
  return (
    <div className="grid gap-4">
      {splitBills.map((splitBill) => (
        <div key={splitBill.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">{splitBill.title}</div>
              <div className="mt-1 text-sm text-white/60">
                総額 {formatCurrency(splitBill.totalAmount)} / 自分の負担 {formatCurrency(splitBill.selfShareAmount)} / 未精算{" "}
                {formatCurrency(splitBill.outstandingAmount)}
              </div>
            </div>
            <div className="text-sm text-white/60">
              {splitBill.payerType === "self" ? "自分が支払った" : `${splitBill.payerName} が支払った`} / {statusLabels[splitBill.status]}
            </div>
          </div>
          <TableWrapper className="mt-4">
            <Table className="min-w-[48rem]">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-[0.18em] text-white/45">
                  <th className="px-3 py-3">参加者</th>
                  <th className="px-3 py-3">負担額</th>
                  <th className="px-3 py-3">残額</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {splitBill.participants.map((participant) => (
                  <tr key={participant.id} className="border-b border-white/5">
                    <td className="px-3 py-3">{participant.name}</td>
                    <td className="px-3 py-3">{formatCurrency(participant.shareAmount)}</td>
                    <td className="px-3 py-3">{formatCurrency(participant.personalDebt?.remainingAmount ?? 0)}</td>
                    <td className="px-3 py-3 text-right">
                      {participant.personalDebt ? (
                        <Button
                          disabled={participant.personalDebt.remainingAmount <= 0}
                          variant="ghost"
                          onClick={() => onSettle(participant.personalDebt!)}
                        >
                          返済登録
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrapper>
        </div>
      ))}
    </div>
  );
}
