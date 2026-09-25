import type { CreateDonationPayload, Donation } from "@sui/shared";
import { useId, useState, startTransition } from "react";
import { Button, IconButton } from "./ui/button";
import { Card } from "./ui/card";
import { CardList, RecordCardLayout } from "./ui/card-list";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { EditModal, type EditChange } from "./editing/edit-surface";
import { FormField } from "./ui/form-field";
import { Input } from "./ui/input";
import { MoneyInput, readMoneyDraft } from "./ui/money-input";
import { PeriodSelector } from "./period-selector";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { formatCurrency, formatDateWithYear } from "../lib/format";
import { getCurrentYearMonth, getTodayDate } from "../lib/utils";
import { useEditSession, type EditErrors } from "../hooks/use-edit-session";
import { useFieldValidation } from "../hooks/use-field-validation";
import { Pencil, Plus, Trash2 } from "lucide-react";

type DonationForm = {
  recipient: string;
  amountRaw: string;
  memo: string;
  donatedOn: string;
};

const currentYear = Number(getCurrentYearMonth().slice(0, 4));

const emptyForm = (): DonationForm => ({
  recipient: "",
  amountRaw: "",
  memo: "",
  donatedOn: getTodayDate(),
});

function buildYearOptions() {
  const start = currentYear - 5;
  const end = currentYear + 2;
  const options = [];
  for (let year = start; year <= end; year += 1) {
    options.push({ value: String(year), label: `${year}年` });
  }
  return options;
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

function toApiPayload(form: DonationForm): CreateDonationPayload {
  return {
    recipient: form.recipient.trim(),
    amount: readMoneyDraft(form.amountRaw, "JPY").minorUnits ?? 0,
    memo: form.memo.trim() === "" ? null : form.memo.trim(),
    donatedOn: form.donatedOn,
  };
}

function fromDonation(donation: Donation): DonationForm {
  return {
    recipient: donation.recipient,
    amountRaw: String(donation.amount),
    memo: donation.memo ?? "",
    donatedOn: donation.donatedOn,
  };
}

function validateDonation(value: DonationForm): EditErrors {
  const errors: EditErrors = {};
  if (!value.recipient.trim()) errors.recipient = "寄付先を入力してください";
  const amount = readMoneyDraft(value.amountRaw, "JPY");
  if (amount.kind !== "valid" || !amount.minorUnits || amount.minorUnits <= 0) errors.amountRaw = "正の金額を入力してください";
  if (!value.donatedOn) errors.donatedOn = "寄付日を入力してください";
  return errors;
}

export function DonationLog({
  selectedYear,
  onYearChange,
}: {
  selectedYear?: string;
  onYearChange?: (year: string) => void;
} = {}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [internalYear, setInternalYear] = useState(String(currentYear));
  const year = selectedYear ?? internalYear;
  const [createOpen, setCreateOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Donation | null>(null);
  const [deletingRecord, setDeletingRecord] = useState<Donation | null>(null);
  const { toast } = useToast();

  const { data, loading, error, setData } = useResource(
    () => apiFetch<Donation[]>(`/api/donations?year=${year}`),
    [year, reloadKey],
  );

  const records = data ?? [];
  const reload = () => startTransition(() => setReloadKey((value) => value + 1));
  const acceptRefresh = (allRecords: Donation[]) => setData(allRecords.filter((item) => item.donatedOn.startsWith(`${year}-`)));
  const annualTotal = records.reduce((sum, record) => sum + record.amount, 0);
  const yearOptions = buildYearOptions();

  const confirmDelete = async () => {
    if (!deletingRecord) {
      return;
    }

    try {
      await apiFetch(`/api/donations/${deletingRecord.id}`, { method: "DELETE" });
      setDeletingRecord(null);
      reload();
      toast({ title: "寄付を削除しました" });
    } catch (deleteError) {
      toast({ title: "削除に失敗しました", description: describeError(deleteError), variant: "error" });
    }
  };

  const openEdit = (record: Donation) => {
    setEditingRecord(record);
  };

  const closeEdit = () => {
    setEditingRecord(null);
  };

  const closeCreate = () => {
    setCreateOpen(false);
  };

  const renderDonation = (record: Donation) => (
    <RecordCardLayout
      title={<div className="break-words font-medium">{record.recipient}</div>}
      value={<div className="font-data whitespace-nowrap font-semibold">{formatCurrency(record.amount, "JPY")}</div>}
      details={<div className="grid gap-1 text-xs text-ink-2">
        <div>寄付日 <span className="whitespace-nowrap">{formatDateWithYear(record.donatedOn)}</span></div>
        {record.memo && <div className="break-words text-ink-3">メモ {record.memo}</div>}
      </div>}
      actions={<>
        <IconButton aria-label={`${record.recipient}を編集`} onClick={() => openEdit(record)}>
          <Pencil aria-hidden="true" className="h-4 w-4" />
        </IconButton>
        <IconButton aria-label={`${record.recipient}を削除`} variant="danger" onClick={() => setDeletingRecord(record)}>
          <Trash2 aria-hidden="true" className="h-4 w-4" />
        </IconButton>
      </>}
    />
  );

  return (
    <div className="grid max-w-5xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">ふるさと納税ログ</h2>
          <p className="mt-2 text-sm text-ink-2">寄付の記録を年ごとに管理します。</p>
          <p className="mt-1 max-w-3xl text-sm text-ink-2">
            残高予測や口座残高には影響しません。将来的な控除シミュレーションの入力データとして使います。
          </p>
        </div>
        <Button className="min-h-10 gap-2" onClick={() => setCreateOpen(true)}>
          <Plus aria-hidden="true" className="h-5 w-5" />
          寄付を追加
        </Button>
      </div>

      <Card className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0 rounded-lg border border-line bg-surface-2 p-4">
          <div className="text-sm font-medium text-ink-3">{year}年の寄付合計</div>
          <div className="font-data mt-3 overflow-x-auto whitespace-nowrap text-2xl font-semibold sm:text-3xl">
            {formatCurrency(annualTotal, "JPY")}
          </div>
        </div>
        <div className="min-w-0 rounded-lg border border-line bg-surface-2 p-4">
          <div className="text-sm font-medium text-ink-3">件数</div>
          <div className="mt-3 break-words text-2xl font-semibold sm:text-3xl">
            {loading ? "読み込み中..." : `${records.length}件`}
          </div>
          <div className="mt-2 text-sm text-ink-2">{year}年の登録件数</div>
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">寄付一覧</h2>
          <PeriodSelector
            presets={yearOptions}
            selected={year}
            onChange={(value) => {
              if (selectedYear === undefined) {
                setInternalYear(value);
              }
              onYearChange?.(value);
            }}
            ariaLabel="年を選択"
          />
        </div>
        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : (
          <CardList
            rows={records}
            rowKey={(record) => record.id}
            emptyMessage={
              loading
                ? "読み込み中..."
                : "寄付が登録されていません。上部の「寄付を追加」から登録してください。"
            }
            renderItem={renderDonation}
          />
        )}
      </Card>

      {createOpen ? <DonationFormDialog onClose={closeCreate} onRefreshed={acceptRefresh} /> : null}
      {editingRecord ? <DonationFormDialog key={editingRecord.id} record={editingRecord} onClose={closeEdit} onRefreshed={acceptRefresh} /> : null}

      <ConfirmDialog
        open={Boolean(deletingRecord)}
        onOpenChange={(open) => !open && setDeletingRecord(null)}
        title="寄付を削除しますか？"
        description={
          deletingRecord
            ? `「${deletingRecord.recipient}」の寄付を削除します。この操作は取り消せません。`
            : undefined
        }
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function DonationFormDialog({ record, onClose, onRefreshed }: { record?: Donation; onClose: () => void; onRefreshed: (records: Donation[]) => void }) {
  const recipientId = useId();
  const amountId = useId();
  const donatedOnId = useId();
  const memoId = useId();
  const { toast } = useToast();
  const session = useEditSession<DonationForm>({
    identity: `donation:${record?.id ?? "new"}`,
    initial: record ? fromDonation(record) : emptyForm(),
    fieldIds: { recipient: recipientId, amountRaw: amountId, donatedOn: donatedOnId },
    validate: validateDonation,
  });
  const form = session.draft;
  const fields = useFieldValidation(form, validateDonation, { recipient: recipientId, amountRaw: amountId, donatedOn: donatedOnId });
  const amount = readMoneyDraft(form.amountRaw, "JPY");
  const changes: EditChange[] = ([
    ["寄付先", session.snapshot.recipient, form.recipient],
    ["金額", session.snapshot.amountRaw, form.amountRaw],
    ["寄付日", session.snapshot.donatedOn, form.donatedOn],
    ["メモ", session.snapshot.memo, form.memo],
  ] as const).filter(([, before, after]) => before !== after).map(([label, before, after]) => ({ label, before: before || "未入力", after: after || "未入力" }));
  const refresh = async () => {
    const records = await apiFetch<Donation[]>("/api/donations");
    onRefreshed(records);
    if (!record) return form;
    const saved = records.find((item) => item.id === record.id);
    if (!saved) throw new Error("保存した寄付を再取得できませんでした");
    return fromDonation(saved);
  };
  const save = async () => {
    const ok = await session.save((value) => apiFetch(record ? `/api/donations/${record.id}` : "/api/donations", {
      method: record ? "PATCH" : "POST", body: JSON.stringify(toApiPayload(value)),
    }), refresh);
    if (ok) { toast({ title: record ? "寄付を更新しました" : "寄付を追加しました" }); onClose(); }
  };
  return <EditModal open subjectType="ふるさと納税の寄付" subjectName={record?.recipient ?? "寄付"} mode={record ? "edit" : "create"}
    status={session.status} error={session.error} changes={changes} saveLabel={record ? "変更を保存" : "寄付を追加"}
    impact="寄付台帳とシミュレーションの寄付済み額に反映されます。口座残高には影響しません。"
    onRequestClose={() => session.requestClose(onClose)} onSave={() => void save()}
    onRetryRefresh={() => void session.retryRefresh().then((ok) => { if (ok) onClose(); })}>
    <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <FormField label="寄付先" htmlFor={recipientId} required error={fields.visibleErrors.recipient}>
        <Input id={recipientId} value={form.recipient} onBlur={() => fields.touch("recipient")} onChange={(event) => session.setDraft({ ...form, recipient: event.target.value })} />
      </FormField>
      <FormField label="金額" htmlFor={amountId} required error={fields.visibleErrors.amountRaw}>
        <MoneyInput id={amountId} currencyCode="JPY" value={amount.minorUnits} draftValue={form.amountRaw} onChange={() => {}}
          onDraftChange={(next) => session.setDraft({ ...form, amountRaw: next.raw })} onBlur={() => fields.touch("amountRaw")} />
      </FormField>
      <FormField label="寄付日" htmlFor={donatedOnId} required error={fields.visibleErrors.donatedOn}>
        <Input id={donatedOnId} type="date" value={form.donatedOn} onBlur={() => fields.touch("donatedOn")} onChange={(event) => session.setDraft({ ...form, donatedOn: event.target.value })} />
      </FormField>
      <FormField label="メモ" htmlFor={memoId}><Input id={memoId} value={form.memo} onChange={(event) => session.setDraft({ ...form, memo: event.target.value })} /></FormField>
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
