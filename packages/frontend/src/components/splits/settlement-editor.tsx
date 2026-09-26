import { INT4_MAX, type Person, type PersonSummaryResponse, type SettlementKind, type SettlementsResponse, type SplitShareItem, type Transaction, type TransactionsResponse } from "@sui/shared";
import { useId } from "react";
import { EditModal, type EditChange } from "../editing/edit-surface";
import { Button } from "../ui/button";
import { FormField } from "../ui/form-field";
import { Input } from "../ui/input";
import { readMoneyDraft } from "../ui/money-input";
import { Select } from "../ui/select";
import { useResource } from "../../hooks/use-resource";
import { useEditSession, type EditErrors } from "../../hooks/use-edit-session";
import { useFieldValidation } from "../../hooks/use-field-validation";
import { useToast } from "../../hooks/use-toast";
import { apiFetch } from "../../lib/api";
import { normalizeCurrencyInputValue } from "../../lib/format";
import { getTodayDate } from "../../lib/utils";
import { formatTransferOptionLabel, getTransactionSettlementRemaining, isSettlementCandidate } from "./split-helpers";
import { distributeSettlement, validateSettlementDraft, type SettlementDraft } from "./settlement-form";
export function SettlementTransferDetailPanel({ transaction }: { transaction: Transaction }) {
  const remaining = getTransactionSettlementRemaining(transaction);
  const allocated = transaction.settlementAllocatedAmount ?? 0;
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 p-3 text-sm">
      <div className="grid gap-1">
        <div className="break-words font-medium">{transaction.description}</div>
        <div className="text-ink-2">
          <span className="font-data">{transaction.date}</span>
          {" / 総額 "}
          <span className="font-data">{transaction.amount.toLocaleString("ja-JP")}</span> 円
        </div>
        <div className="text-ink-2">
          精算済み <span className="font-data">{allocated.toLocaleString("ja-JP")}</span> 円
          {" / 残額 "}
          <span className="font-data">{remaining.toLocaleString("ja-JP")}</span> 円
        </div>
        <div className="text-ink-2">
          振替元: <span className="break-words">{transaction.accountName ?? "未設定"}</span>
        </div>
        <div className="text-ink-2">
          振替先: <span className="break-words">{transaction.transferToAccountName ?? "未設定"}</span>
        </div>
      </div>
    </div>
  );
}

export function CreateSettlementDialog({
  open,
  people,
  onClose,
  onSaved,
  onRefreshed,
}: {
  open: boolean;
  people: Person[];
  onClose: () => void;
  onSaved: () => void;
  onRefreshed?: (settlements: SettlementsResponse) => void;
}) {
  const personFieldId = useId(); const dateFieldId = useId(); const transactionFieldId = useId();
  const validate = (draft: SettlementDraft): EditErrors =>
    validateSettlementDraft(draft, activeSummary, selectedTransaction);
  const fieldIds = { personId: personFieldId, date: dateFieldId, transactionId: transactionFieldId, allocations: "settlement-shares" };
  const session = useEditSession<SettlementDraft>({ identity: "new-settlement", initial: { personId: "", kind: "offset", transactionId: "", date: getTodayDate(), offsetTotal: "", note: "", allocations: {} }, validate, fieldIds });
  const draft = session.draft;
  const { personId, kind, transactionId, date, offsetTotal, note, allocations } = draft;
  const { data: summary, loading: summaryLoading } = useResource(
    () => personId ? apiFetch<PersonSummaryResponse>(`/api/people/${personId}/summary`) : Promise.resolve(null), [personId],
  );
  const { data: transactionsResponse } = useResource(
    () => kind === "transaction" ? apiFetch<TransactionsResponse>("/api/transactions?type=transfer&limit=100") : Promise.resolve(null), [kind],
  );
  const activeSummary = !summaryLoading && summary?.person.id === personId ? summary : null;
  const transferOptions = transactionsResponse?.items.filter(isSettlementCandidate) ?? [];
  const selectedTransaction = transferOptions.find((transaction) => transaction.id === transactionId);
  const fields = useFieldValidation(draft, validate, fieldIds);
  const set = (patch: Partial<SettlementDraft>) => session.setDraft({ ...draft, ...patch });
  const { toast } = useToast();

  const handleSave = async () => {
    fields.showAll();
    const ok = await session.save((value) => {
      const selectedAllocations = Object.entries(value.allocations)
        .map(([shareId, raw]) => ({ shareId, amount: readMoneyDraft(raw, "JPY").minorUnits ?? 0 }))
        .filter(({ amount }) => amount > 0);
      return apiFetch("/api/settlements", {
        method: "POST",
        body: JSON.stringify({
          kind: value.kind,
          personId: value.personId,
          transactionId: value.kind === "transaction" ? value.transactionId : null,
          date: value.kind === "offset" ? value.date : undefined,
          note: value.note.trim() || null,
          allocations: selectedAllocations,
        }),
      });
    }, async () => {
      const settlements = await apiFetch<SettlementsResponse>("/api/settlements");
      onRefreshed?.(settlements);
      return draft;
    });
    if (ok) { toast({ title: "精算を記録しました" }); onSaved(); }
  };

  const distribute = (totalAmount: number) => {
    const unsettledShares = (activeSummary?.shares ?? []).filter((share) => share.remainingAmount > 0);
    if (unsettledShares.length === 0 || totalAmount <= 0) {
      return;
    }
    const { allocations, remaining } = distributeSettlement(totalAmount, unsettledShares);
    set({ allocations });
    if (remaining > 0) {
      toast({
        title: "未回収総額を超えた分は按分できません",
        description: `${remaining.toLocaleString("ja-JP")} 円が余りました`,
        variant: "error",
      });
    }
  };

  const autoAllocate = () => {
    if (kind === "transaction") {
      if (!selectedTransaction) {
        toast({ title: "振替取引を選択してください", variant: "error" });
        return;
      }
      distribute(getTransactionSettlementRemaining(selectedTransaction));
    } else {
      const parsed = readMoneyDraft(offsetTotal, "JPY");
      const parsedTotal = parsed.minorUnits;
      if (parsed.kind !== "valid" || parsedTotal === null || parsedTotal <= 0 || parsedTotal > INT4_MAX) {
        toast({ title: "精算総額を1円以上、上限以内で入力してください", variant: "error" });
        return;
      }
      distribute(parsedTotal);
    }
  };

  const changes: EditChange[] = [];
  if (personId) changes.push({ label: "メンバー", before: "未選択", after: people.find((person) => person.id === personId)?.name ?? personId });
  if (kind !== session.snapshot.kind) changes.push({ label: "精算方法", before: "相殺・現金精算", after: "振替取引で精算" });
  if (kind === "offset" && date !== session.snapshot.date) changes.push({ label: "精算日", before: session.snapshot.date, after: date || "未入力" });
  if (kind === "transaction" && transactionId) changes.push({ label: "振替取引", before: "未選択", after: selectedTransaction ? formatTransferOptionLabel(selectedTransaction) : transactionId });
  if (Object.values(allocations).some(Boolean)) changes.push({ label: "精算額", before: "未入力", after: `${Object.values(allocations).reduce((sum, value) => sum + (Number(value) || 0), 0).toLocaleString("ja-JP")} 円` });
  if (note !== session.snapshot.note) changes.push({ label: "メモ", before: "未入力", after: note || "未入力" });
  return (
    <EditModal open={open} subjectType="割り勘の精算" subjectName="精算" mode="record" status={session.status}
      error={session.error} changes={changes} saveLabel="精算を記録"
      impact={kind === "transaction" ? "選んだ振替取引を未回収持分に割り当てます。振替取引の口座反映を重複させません。" : "未回収持分の精算履歴を記録します。口座残高には直接反映しません。"}
      onRequestClose={() => session.requestClose(onClose)} onSave={() => void handleSave()}
      onRetryRefresh={() => void session.retryRefresh().then((ok) => { if (ok) onSaved(); })}>
        <form className="grid min-w-0 gap-4" onSubmit={(event) => { event.preventDefault(); void handleSave(); }}>
          <FormField label="メンバー" htmlFor={personFieldId} required error={fields.visibleErrors.personId}>
            <Select
              id={personFieldId}
              value={personId}
              onChange={(event) => {
                set({ personId: event.target.value, allocations: {}, offsetTotal: "" });
              }}
            >
              <option value="">選択してください</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>{person.name}</option>
              ))}
            </Select>
          </FormField>

          <FormField label="種別">
            <Select
              aria-label="種別"
              value={kind}
              onChange={(event) => set({ kind: event.target.value as SettlementKind })}
            >
              <option value="offset">相殺・現金精算</option>
              <option value="transaction">振替取引で精算</option>
            </Select>
          </FormField>

          {kind === "offset" ? (
            <FormField label="日付" htmlFor={dateFieldId} required error={fields.visibleErrors.date}>
              <Input id={dateFieldId} type="date" value={date} onChange={(event) => set({ date: event.target.value })} />
            </FormField>
          ) : (
            <FormField label="振替取引" htmlFor={transactionFieldId} required error={fields.visibleErrors.transactionId} className="min-w-0">
              <Select
                id={transactionFieldId}
                value={transactionId}
                onChange={(event) => set({ transactionId: event.target.value })}
                className="w-full min-w-0 truncate"
              >
                <option value="">選択してください</option>
                {transferOptions.map((transaction) => (
                  <option key={transaction.id} value={transaction.id}>
                    {formatTransferOptionLabel(transaction)}
                  </option>
                ))}
              </Select>
              {selectedTransaction ? (
                <div className="mt-2 min-w-0">
                  <SettlementTransferDetailPanel transaction={selectedTransaction} />
                </div>
              ) : null}
            </FormField>
          )}

          {kind === "offset" ? (
            <div className="flex items-end gap-3">
              <FormField label="精算総額" className="flex-1">
                <Input
                  type="text"
                  inputMode="numeric"
                  data-1p-ignore="true"
                  placeholder="円"
                  value={offsetTotal}
                  onChange={(event) => {
                    const normalized = normalizeCurrencyInputValue(event.target.value, "JPY");
                    if (normalized.valid) set({ offsetTotal: normalized.value });
                  }}
                />
              </FormField>
              <Button type="button" onClick={autoAllocate}>
                自動按分
              </Button>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button type="button" disabled={!selectedTransaction} onClick={autoAllocate}>
                振替金額で自動按分
              </Button>
            </div>
          )}

          <FormField label="メモ">
            <Input value={note} onChange={(event) => set({ note: event.target.value })} />
          </FormField>

          {activeSummary ? (
            <div id="settlement-shares" className="grid min-w-0 gap-2">
              <p className="text-sm font-medium">未精算持分</p>
              {fields.visibleErrors.allocations ? <p role="alert" className="text-sm text-critical">{fields.visibleErrors.allocations}</p> : null}
              {activeSummary.shares.filter((share) => share.remainingAmount > 0).length === 0 ? (
                <p className="text-sm text-ink-2">未精算の持分はありません。</p>
              ) : (
                activeSummary.shares
                  .filter((share) => share.remainingAmount > 0)
                  .map((share) => (
                    <SettlementShareAllocationRow
                      key={share.id}
                      share={share}
                      value={allocations[share.id] ?? ""}
                      error={fields.visibleErrors[`allocation-${share.id}`]}
                      onBlur={() => fields.touch(`allocation-${share.id}`)}
                      onChange={(value) =>
                        set({ allocations: { ...allocations, [share.id]: value } })
                      }
                    />
                  ))
              )}
            </div>
          ) : null}

          <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>保存</button>
        </form>
    </EditModal>
  );
}

/**
 * 未精算持分の 1 行。
 * 割り勘タイトルが長くても按分金額の入力欄が押し出されないよう、
 * 情報側を可変幅（minmax(0,1fr)）、入力欄を固定幅の列として分離する。
 */
export function SettlementShareAllocationRow({
  share,
  value,
  error,
  onBlur,
  onChange,
}: {
  share: SplitShareItem;
  value: string;
  error?: string;
  onBlur?: () => void;
  onChange: (next: string) => void;
}) {
  const fullTitle = `${share.splitDate} ${share.splitDescription}`;

  return (
    <div className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,1fr)_7rem] sm:items-center sm:gap-3">
      <div className="min-w-0">
        <p className="line-clamp-2 break-words text-sm" title={fullTitle}>
          <span className="font-data">{share.splitDate}</span> {share.splitDescription}
        </p>
        <p className="text-xs text-ink-2">
          残額 <span className="font-data">{share.remainingAmount.toLocaleString("ja-JP")}</span> 円
        </p>
      </div>
      <div className="w-full min-w-0 sm:w-28">
        <Input
          id={`allocation-${share.id}`}
          type="text"
          inputMode="numeric"
          data-1p-ignore="true"
          max={share.remainingAmount}
          className="w-full"
          placeholder="金額"
          aria-label={`${share.splitDescription} の按分金額`}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `allocation-error-${share.id}` : undefined}
          value={value}
          onBlur={onBlur}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {error ? <p id={`allocation-error-${share.id}`} role="alert" className="text-sm text-critical sm:col-span-2">{error}</p> : null}
    </div>
  );
}
