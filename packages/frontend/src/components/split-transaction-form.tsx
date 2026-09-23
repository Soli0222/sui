import { INT4_MAX, type CreateSplitPayload, type Person, type SplitMethod, type SplitResponse, type SplitsResponse } from "@sui/shared";
import { useId } from "react";
import { EditModal, type EditChange } from "./editing/edit-surface";
import { Button } from "./ui/button";
import { FormField } from "./ui/form-field";
import { Input } from "./ui/input";
import { MoneyInput, readMoneyDraft } from "./ui/money-input";
import { Select } from "./ui/select";
import { useEditSession, type EditErrors } from "../hooks/use-edit-session";
import { useFieldValidation } from "../hooks/use-field-validation";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { getTodayDate } from "../lib/utils";

type ShareDraft = { included: boolean; ratio: string; amountRaw: string };
type SplitDraft = { date: string; description: string; memo: string; amountRaw: string;
  method: SplitMethod; ownRatio: string; shares: Record<string, ShareDraft> };

function initialDraft(people: Person[], detail?: SplitResponse): SplitDraft {
  const shares: Record<string, ShareDraft> = {};
  for (const person of people) {
    const share = detail?.shares.find((item) => item.personId === person.id);
    shares[person.id] = { included: Boolean(share), ratio: share?.ratio?.toString() ?? "", amountRaw: share?.amount?.toString() ?? "" };
  }
  return { date: detail?.split.date ?? getTodayDate(), description: detail?.split.description ?? "",
    memo: detail?.split.memo ?? "", amountRaw: detail?.split.amount?.toString() ?? "",
    method: detail?.split.method ?? "equal", ownRatio: detail?.split.ownRatio?.toString() ?? "", shares };
}

function positiveInteger(raw: string) { const value = Number(raw); return Number.isSafeInteger(value) && value > 0 && value <= INT4_MAX ? value : null; }
function validateSplit(draft: SplitDraft): EditErrors {
  const errors: EditErrors = {};
  if (!draft.date) errors.date = "日付を入力してください";
  if (!draft.description.trim()) errors.description = "内容を入力してください";
  const total = readMoneyDraft(draft.amountRaw, "JPY");
  if (total.kind !== "valid" || total.minorUnits === null || total.minorUnits <= 0 || total.minorUnits > INT4_MAX) errors.amountRaw = "1円以上、上限以内の金額を入力してください";
  const selected = Object.entries(draft.shares).filter(([, share]) => share.included);
  if (selected.length === 0) errors.shares = "メンバーを1人以上選択してください";
  if (draft.method === "ratio") {
    if (!positiveInteger(draft.ownRatio)) errors.ownRatio = "自分の重みを入力してください";
    for (const [id, share] of selected) if (!positiveInteger(share.ratio)) errors[`share-${id}`] = "正の重みを入力してください";
  }
  if (draft.method === "amount") {
    let sum = 0;
    for (const [id, share] of selected) {
      const amount = readMoneyDraft(share.amountRaw, "JPY");
      if (amount.kind !== "valid" || amount.minorUnits === null || amount.minorUnits <= 0 || amount.minorUnits > INT4_MAX) errors[`share-${id}`] = "1円以上、上限以内の持分を入力してください";
      else sum += amount.minorUnits;
    }
    if (total.minorUnits !== null && sum > total.minorUnits) errors.shares = "持分の合計は立替金額以下にしてください";
  }
  return errors;
}

function toPayload(draft: SplitDraft): CreateSplitPayload {
  return { date: draft.date, description: draft.description.trim(), memo: draft.memo.trim() || null,
    amount: readMoneyDraft(draft.amountRaw, "JPY").minorUnits ?? 0, method: draft.method,
    ownRatio: draft.method === "ratio" ? positiveInteger(draft.ownRatio) : null,
    shares: Object.entries(draft.shares).filter(([, share]) => share.included).map(([personId, share]) => ({
      personId, ratio: draft.method === "ratio" ? positiveInteger(share.ratio) : null,
      amount: draft.method === "amount" ? readMoneyDraft(share.amountRaw, "JPY").minorUnits ?? undefined : undefined,
    })) };
}

export function SplitTransactionForm({ splitId, people, onSaved, onCancel, onRefreshed }: {
  splitId?: string; people: Person[]; onSaved: () => void; onCancel: () => void;
  onRefreshed?: (splits: SplitsResponse) => void;
}) {
  const { data, loading, error } = useResource(
    () => splitId ? apiFetch<SplitResponse>(`/api/splits/${splitId}`) : Promise.resolve(null), [splitId],
  );
  if (loading) return <p className="p-4 text-sm text-ink-3">読み込み中...</p>;
  if (error) return <div role="alert" className="p-4 text-sm text-critical">{error}<Button variant="secondary" onClick={onCancel}>閉じる</Button></div>;
  return <SplitTransactionEditor key={splitId ?? "new"} splitId={splitId} people={people} detail={data ?? undefined}
    onSaved={onSaved} onCancel={onCancel} onRefreshed={onRefreshed} />;
}

function SplitTransactionEditor({ splitId, people, detail, onSaved, onCancel, onRefreshed }: {
  splitId?: string; people: Person[]; detail?: SplitResponse; onSaved: () => void; onCancel: () => void;
  onRefreshed?: (splits: SplitsResponse) => void;
}) {
  const dateId = useId(); const descriptionId = useId(); const amountId = useId(); const ownRatioId = useId();
  const { toast } = useToast();
  const fieldIds: Record<string, string> = { date: dateId, description: descriptionId, amountRaw: amountId, ownRatio: ownRatioId, shares: "split-members" };
  for (const person of people) fieldIds[`share-${person.id}`] = `split-share-${person.id}`;
  const session = useEditSession({ identity: `split:${splitId ?? "new"}`, initial: initialDraft(people, detail), validate: validateSplit, fieldIds });
  const draft = session.draft;
  const fields = useFieldValidation(draft, validateSplit, fieldIds);
  const amount = readMoneyDraft(draft.amountRaw, "JPY");
  const set = (patch: Partial<SplitDraft>) => session.setDraft({ ...draft, ...patch });
  const updateShare = (id: string, patch: Partial<ShareDraft>) => set({ shares: { ...draft.shares, [id]: { ...draft.shares[id], ...patch } } });
  const refresh = async () => {
    const splits = await apiFetch<SplitsResponse>("/api/splits");
    onRefreshed?.(splits);
    if (!splitId) return draft;
    const loaded = await apiFetch<SplitResponse>(`/api/splits/${splitId}`);
    return initialDraft(people, loaded);
  };
  const save = async () => {
    fields.showAll();
    const ok = await session.save((value) => apiFetch(splitId ? `/api/splits/${splitId}` : "/api/splits", {
      method: splitId ? "PUT" : "POST", body: JSON.stringify(toPayload(value)),
    }), refresh);
    if (ok) { toast({ title: splitId ? "割り勘取引を更新しました" : "割り勘取引を追加しました" }); onSaved(); }
  };
  const changes: EditChange[] = [];
  const methodLabel: Record<SplitMethod, string> = { equal: "均等割り", ratio: "比率", amount: "金額指定" };
  const shareSummary = (value: SplitDraft) => people.filter((person) => value.shares[person.id]?.included).map((person) => {
    const share = value.shares[person.id];
    return `${person.name}${value.method === "ratio" ? `（重み ${share.ratio || "未入力"}）` : value.method === "amount" ? `（${share.amountRaw || "未入力"} 円）` : ""}`;
  }).join("、") || "未選択";
  for (const [label, before, after] of [
    ["日付", session.snapshot.date, draft.date], ["内容", session.snapshot.description, draft.description],
    ["メモ", session.snapshot.memo, draft.memo], ["立替金額", session.snapshot.amountRaw, draft.amountRaw],
    ["分割方法", methodLabel[session.snapshot.method], methodLabel[draft.method]],
    ["自分の重み", session.snapshot.ownRatio, draft.ownRatio],
  ]) if (before !== after) changes.push({ label, before: before || "未入力", after: after || "未入力" });
  if (JSON.stringify(session.snapshot.shares) !== JSON.stringify(draft.shares)) changes.push({ label: "メンバーの持分", before: shareSummary(session.snapshot), after: shareSummary(draft) });
  return <EditModal open subjectType="割り勘取引" subjectName={detail?.split.description ?? "割り勘取引"} mode={splitId ? "edit" : "create"}
    status={session.status} error={session.error} changes={changes} saveLabel={splitId ? "変更を保存" : "割り勘取引を追加"}
    impact="立替と未回収持分の台帳を更新します。口座残高や予測には直接反映されません。"
    onRequestClose={() => session.requestClose(onCancel)} onSave={() => void save()}
    onRetryRefresh={() => void session.retryRefresh().then((ok) => { if (ok) onSaved(); })}>
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <FormField label="日付" htmlFor={dateId} required error={fields.visibleErrors.date}><Input id={dateId} type="date" value={draft.date} onBlur={() => fields.touch("date")} onChange={(event) => set({ date: event.target.value })} /></FormField>
      <FormField label="内容" htmlFor={descriptionId} required error={fields.visibleErrors.description}><Input id={descriptionId} value={draft.description} onBlur={() => fields.touch("description")} onChange={(event) => set({ description: event.target.value })} /></FormField>
      <FormField label="メモ"><Input value={draft.memo} onChange={(event) => set({ memo: event.target.value })} /></FormField>
      <FormField label="金額" htmlFor={amountId} required error={fields.visibleErrors.amountRaw}>
        <MoneyInput id={amountId} value={amount.minorUnits} draftValue={draft.amountRaw} onChange={() => {}}
          onDraftChange={(next) => set({ amountRaw: next.raw })} onBlur={() => fields.touch("amountRaw")} />
      </FormField>
      <FormField label="方法"><Select value={draft.method} onChange={(event) => set({ method: event.target.value as SplitMethod })}>
        <option value="equal">均等割り</option><option value="ratio">比率</option><option value="amount">金額指定</option>
      </Select></FormField>
      {draft.method === "ratio" ? <FormField label="自分の重み" htmlFor={ownRatioId} error={fields.visibleErrors.ownRatio}>
        <Input id={ownRatioId} type="number" min={1} inputMode="numeric" value={draft.ownRatio} onBlur={() => fields.touch("ownRatio")} onChange={(event) => set({ ownRatio: event.target.value })} />
      </FormField> : null}
      <fieldset id="split-members" className="grid gap-2"><legend className="text-sm font-medium">メンバー</legend>
        {fields.visibleErrors.shares ? <p role="alert" className="text-sm text-critical">{fields.visibleErrors.shares}</p> : null}
        {people.map((person) => { const share = draft.shares[person.id]; const shareAmount = readMoneyDraft(share.amountRaw, "JPY"); return <div key={person.id} className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_7rem] sm:items-center">
          <label className="flex min-w-0 items-center gap-2 text-sm"><input type="checkbox" checked={share.included} onChange={(event) => updateShare(person.id, { included: event.target.checked })} /><span className="break-words">{person.name}</span></label>
          {draft.method === "ratio" ? <Input id={`split-share-${person.id}`} aria-label={`${person.name}の重み`} aria-invalid={Boolean(fields.visibleErrors[`share-${person.id}`])} aria-describedby={fields.visibleErrors[`share-${person.id}`] ? `split-share-error-${person.id}` : undefined}
            type="number" min={1} inputMode="numeric" value={share.ratio} onBlur={() => fields.touch(`share-${person.id}`)} onChange={(event) => updateShare(person.id, { ratio: event.target.value })} /> : null}
          {draft.method === "amount" ? <MoneyInput id={`split-share-${person.id}`} aria-label={`${person.name}の金額`} aria-invalid={Boolean(fields.visibleErrors[`share-${person.id}`])} aria-describedby={fields.visibleErrors[`share-${person.id}`] ? `split-share-error-${person.id}` : undefined}
            value={shareAmount.minorUnits} draftValue={share.amountRaw} onChange={() => {}} onDraftChange={(next) => updateShare(person.id, { amountRaw: next.raw })} onBlur={() => fields.touch(`share-${person.id}`)} /> : null}
          {fields.visibleErrors[`share-${person.id}`] ? <p id={`split-share-error-${person.id}`} role="alert" className="text-sm text-critical sm:col-span-2">{fields.visibleErrors[`share-${person.id}`]}</p> : null}
        </div>; })}
      </fieldset>
      <button type="submit" className="sr-only" aria-hidden="true" tabIndex={-1}>保存</button>
    </form>
  </EditModal>;
}
