import type { CreateDonationPayload, Donation, UpdateDonationPayload } from "@sui/shared";
import { useEffect, useId, useRef, useState, startTransition } from "react";
import { Button, IconButton } from "./ui/button";
import { Card } from "./ui/card";
import { ConfirmDialog } from "./ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { FormField } from "./ui/form-field";
import { Input } from "./ui/input";
import { MoneyInput } from "./ui/money-input";
import { PeriodSelector } from "./period-selector";
import { ResponsiveTable, type ResponsiveTableColumn } from "./ui/responsive-table";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { formatCurrency, formatDateWithYear } from "../lib/format";
import { getCurrentYearMonth, getTodayDate } from "../lib/utils";
import { Pencil, Plus, Trash2 } from "lucide-react";

type DonationForm = {
  recipient: string;
  amount: number;
  memo: string;
  donatedOn: string;
};

const currentYear = Number(getCurrentYearMonth().slice(0, 4));

const emptyForm: DonationForm = {
  recipient: "",
  amount: 0,
  memo: "",
  donatedOn: getTodayDate(),
};

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
    amount: form.amount,
    memo: form.memo.trim() === "" ? null : form.memo.trim(),
    donatedOn: form.donatedOn,
  };
}

function fromDonation(donation: Donation): DonationForm {
  return {
    recipient: donation.recipient,
    amount: donation.amount,
    memo: donation.memo ?? "",
    donatedOn: donation.donatedOn,
  };
}

export function DonationLog() {
  const [reloadKey, setReloadKey] = useState(0);
  const [year, setYear] = useState(String(currentYear));
  const [form, setForm] = useState<DonationForm>(emptyForm);
  const [editForm, setEditForm] = useState<DonationForm>(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Donation | null>(null);
  const [deletingRecord, setDeletingRecord] = useState<Donation | null>(null);
  const { toast } = useToast();

  const { data, loading, error } = useResource(
    () => apiFetch<Donation[]>(`/api/donations?year=${year}`),
    [year, reloadKey],
  );

  const records = data ?? [];
  const reload = () => startTransition(() => setReloadKey((value) => value + 1));
  const annualTotal = records.reduce((sum, record) => sum + record.amount, 0);
  const yearOptions = buildYearOptions();

  const createDonation = async () => {
    try {
      await apiFetch("/api/donations", {
        method: "POST",
        body: JSON.stringify(toApiPayload(form)),
      });
      setForm(emptyForm);
      setCreateOpen(false);
      reload();
      toast({ title: "寄付を追加しました" });
    } catch (createError) {
      toast({ title: "追加に失敗しました", description: describeError(createError), variant: "error" });
    }
  };

  const updateDonation = async () => {
    if (!editingRecord) {
      return;
    }

    try {
      const payload: UpdateDonationPayload = {
        recipient: editForm.recipient.trim(),
        amount: editForm.amount,
        memo: editForm.memo.trim() === "" ? null : editForm.memo.trim(),
        donatedOn: editForm.donatedOn,
      };
      await apiFetch(`/api/donations/${editingRecord.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setEditingRecord(null);
      setEditForm(emptyForm);
      reload();
      toast({ title: "寄付を更新しました" });
    } catch (updateError) {
      toast({ title: "更新に失敗しました", description: describeError(updateError), variant: "error" });
    }
  };

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
    setEditForm(fromDonation(record));
  };

  const closeEdit = () => {
    setEditingRecord(null);
    setEditForm(emptyForm);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setForm(emptyForm);
  };

  const canCreate =
    form.recipient.trim().length > 0 && form.amount > 0 && form.donatedOn !== "";
  const canEdit =
    editForm.recipient.trim().length > 0 && editForm.amount > 0 && editForm.donatedOn !== "";

  const columns: ResponsiveTableColumn<Donation>[] = [
    {
      key: "donatedOn",
      header: "寄付日",
      render: (record) => formatDateWithYear(record.donatedOn),
    },
    {
      key: "recipient",
      header: "自治体・団体",
      render: (record) => record.recipient,
    },
    {
      key: "amount",
      header: "金額",
      align: "right",
      mono: true,
      render: (record) => formatCurrency(record.amount, "JPY"),
    },
    {
      key: "memo",
      header: "メモ",
      render: (record) => record.memo ?? "—",
    },
    {
      key: "actions",
      header: "",
      render: (record) => (
        <div className="flex justify-end gap-1">
          <IconButton aria-label="編集" onClick={() => openEdit(record)}>
            <Pencil aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <IconButton aria-label="削除" variant="danger" onClick={() => setDeletingRecord(record)}>
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </div>
      ),
    },
  ];

  const renderMobileRow = (record: Donation) => (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{record.recipient}</div>
          <div className="text-xs text-ink-3">{formatDateWithYear(record.donatedOn)}</div>
        </div>
        <div className="font-data text-base font-semibold">{formatCurrency(record.amount, "JPY")}</div>
      </div>
      {record.memo ? <div className="text-xs text-ink-3">{record.memo}</div> : null}
      <div className="flex items-center justify-end gap-1 text-xs text-ink-3">
        <IconButton aria-label="編集" onClick={() => openEdit(record)}>
          <Pencil aria-hidden="true" className="h-4 w-4" />
        </IconButton>
        <IconButton aria-label="削除" variant="danger" onClick={() => setDeletingRecord(record)}>
          <Trash2 aria-hidden="true" className="h-4 w-4" />
        </IconButton>
      </div>
    </>
  );

  return (
    <div className="grid gap-6">
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
            onChange={(value) => setYear(value)}
            ariaLabel="年を選択"
          />
        </div>
        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : (
          <ResponsiveTable
            columns={columns}
            rows={records}
            rowKey={(record) => record.id}
            emptyMessage={
              loading
                ? "読み込み中..."
                : "寄付が登録されていません。上部の「寄付を追加」から登録してください。"
            }
            mobileRow={renderMobileRow}
          />
        )}
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : closeCreate())}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">寄付を追加</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">
            寄付先、金額、日付を入力します。メモは任意です。
          </DialogDescription>
          <DonationFormDialog
            form={form}
            onChange={setForm}
            canSave={canCreate}
            actionLabel="追加"
            onCancel={closeCreate}
            onSave={createDonation}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingRecord)} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">寄付を編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">
            寄付内容を修正します。
          </DialogDescription>
          <DonationFormDialog
            form={editForm}
            onChange={setEditForm}
            canSave={canEdit}
            actionLabel="保存"
            onCancel={closeEdit}
            onSave={updateDonation}
          />
        </DialogContent>
      </Dialog>

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

function DonationFormDialog({
  form,
  onChange,
  canSave,
  actionLabel,
  onCancel,
  onSave,
}: {
  form: DonationForm;
  onChange: (next: DonationForm) => void;
  canSave: boolean;
  actionLabel: string;
  onCancel: () => void;
  onSave: () => void;
}) {
  const recipientId = useId();
  const amountId = useId();
  const donatedOnId = useId();
  const memoId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const setAmount = (value: number) => {
    onChange({ ...form, amount: Math.max(0, value) });
  };

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
      <FormField label="寄付先" htmlFor={recipientId} required>
        <Input
          id={recipientId}
          ref={firstFieldRef}
          value={form.recipient}
          onChange={(event) => onChange({ ...form, recipient: event.target.value })}
        />
      </FormField>

      <FormField label="金額" htmlFor={amountId} required>
        <MoneyInput
          id={amountId}
          currencyCode="JPY"
          value={form.amount}
          onChange={setAmount}
        />
      </FormField>

      <FormField label="寄付日" htmlFor={donatedOnId} required>
        <Input
          id={donatedOnId}
          type="date"
          value={form.donatedOn}
          onChange={(event) => onChange({ ...form, donatedOn: event.target.value })}
        />
      </FormField>

      <FormField label="メモ" htmlFor={memoId}>
        <Input
          id={memoId}
          value={form.memo}
          onChange={(event) => onChange({ ...form, memo: event.target.value })}
        />
      </FormField>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="text-xs text-ink-3">
          {!canSave ? "寄付先と金額と寄付日は必須です。" : ""}
        </div>
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
