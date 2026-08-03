import type { CreateSalaryRecordPayload, SalaryRecord, SalaryRecordKind } from "@sui/shared";
import { useEffect, useId, useRef, useState, startTransition } from "react";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { MoneyInput } from "../components/ui/money-input";
import { PeriodSelector } from "../components/period-selector";
import { ResponsiveTable, type ResponsiveTableColumn } from "../components/ui/responsive-table";
import { Select } from "../components/ui/select";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { formatCurrency, formatDateWithYear } from "../lib/format";
import { getCurrentYearMonth, getTodayDate } from "../lib/utils";
import { Pencil, Trash2, Banknote } from "lucide-react";

type SalaryForm = {
  paidOn: string;
  kind: SalaryRecordKind;
  name: string;
  grossAmount: number;
  healthInsurance: number;
  pensionInsurance: number;
  employmentInsurance: number;
  childcareSupportLevy: number;
  incomeTax: number;
  residentTax: number;
  employeeStockContribution: number;
  employeeStockIncentive: number;
  dcMatchingContribution: number;
  otherDeductions: number;
};

const currentYear = Number(getCurrentYearMonth().slice(0, 4));

const emptyForm: SalaryForm = {
  paidOn: getTodayDate(),
  kind: "salary",
  name: "",
  grossAmount: 0,
  healthInsurance: 0,
  pensionInsurance: 0,
  employmentInsurance: 0,
  childcareSupportLevy: 0,
  incomeTax: 0,
  residentTax: 0,
  employeeStockContribution: 0,
  employeeStockIncentive: 0,
  dcMatchingContribution: 0,
  otherDeductions: 0,
};

function formatKind(kind: SalaryRecordKind) {
  return kind === "salary" ? "月給" : "賞与";
}

function deriveFromForm(form: SalaryForm) {
  const deductionTotal =
    form.healthInsurance +
    form.pensionInsurance +
    form.employmentInsurance +
    form.childcareSupportLevy +
    form.incomeTax +
    form.residentTax +
    form.employeeStockContribution +
    form.employeeStockIncentive +
    form.dcMatchingContribution +
    form.otherDeductions;
  const netAmount = form.grossAmount - deductionTotal;
  return { deductionTotal, netAmount };
}

function toApiPayload(form: SalaryForm): CreateSalaryRecordPayload {
  return {
    paidOn: form.paidOn,
    kind: form.kind,
    name: form.name.trim() === "" ? null : form.name.trim(),
    grossAmount: form.grossAmount,
    healthInsurance: form.healthInsurance,
    pensionInsurance: form.pensionInsurance,
    employmentInsurance: form.employmentInsurance,
    childcareSupportLevy: form.childcareSupportLevy,
    incomeTax: form.incomeTax,
    residentTax: form.residentTax,
    employeeStockContribution: form.employeeStockContribution,
    employeeStockIncentive: form.employeeStockIncentive,
    dcMatchingContribution: form.dcMatchingContribution,
    otherDeductions: form.otherDeductions,
  };
}

function fromSalaryRecord(record: SalaryRecord): SalaryForm {
  return {
    paidOn: record.paidOn,
    kind: record.kind,
    name: record.name ?? "",
    grossAmount: record.grossAmount,
    healthInsurance: record.healthInsurance,
    pensionInsurance: record.pensionInsurance,
    employmentInsurance: record.employmentInsurance,
    childcareSupportLevy: record.childcareSupportLevy,
    incomeTax: record.incomeTax,
    residentTax: record.residentTax,
    employeeStockContribution: record.employeeStockContribution,
    employeeStockIncentive: record.employeeStockIncentive,
    dcMatchingContribution: record.dcMatchingContribution,
    otherDeductions: record.otherDeductions,
  };
}

function clampNonNegative(value: number) {
  return Math.max(0, value);
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

function buildYearOptions() {
  const start = currentYear - 5;
  const end = currentYear + 2;
  const options = [];
  for (let year = start; year <= end; year++) {
    options.push({ value: String(year), label: `${year}年` });
  }
  return options;
}

export function SalariesPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [year, setYear] = useState(String(currentYear));
  const [form, setForm] = useState<SalaryForm>(emptyForm);
  const [editForm, setEditForm] = useState<SalaryForm>(emptyForm);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<SalaryRecord | null>(null);
  const [deletingRecord, setDeletingRecord] = useState<SalaryRecord | null>(null);
  const { toast } = useToast();

  const { data, loading, error } = useResource(
    () => apiFetch<SalaryRecord[]>(`/api/salary-records?year=${year}`),
    [year, reloadKey],
  );

  const records = data ?? [];
  const reload = () => startTransition(() => setReloadKey((value) => value + 1));

  const grossTotal = records.reduce((sum, record) => sum + record.grossAmount, 0);
  const deductionTotal = records.reduce((sum, record) => sum + record.deductionTotal, 0);
  const netTotal = records.reduce((sum, record) => sum + record.netAmount, 0);

  const yearOptions = buildYearOptions();

  const createSalaryRecord = async () => {
    try {
      await apiFetch("/api/salary-records", {
        method: "POST",
        body: JSON.stringify(toApiPayload(form)),
      });
      setForm(emptyForm);
      setCreateOpen(false);
      reload();
      toast({ title: "給与明細を追加しました" });
    } catch (createError) {
      toast({ title: "追加に失敗しました", description: describeError(createError), variant: "error" });
    }
  };

  const updateSalaryRecord = async () => {
    if (!editingRecord) {
      return;
    }

    try {
      await apiFetch(`/api/salary-records/${editingRecord.id}`, {
        method: "PATCH",
        body: JSON.stringify(toApiPayload(editForm)),
      });
      setEditingRecord(null);
      setEditForm(emptyForm);
      reload();
      toast({ title: "給与明細を更新しました" });
    } catch (updateError) {
      toast({ title: "更新に失敗しました", description: describeError(updateError), variant: "error" });
    }
  };

  const confirmDelete = async () => {
    if (!deletingRecord) {
      return;
    }

    try {
      await apiFetch(`/api/salary-records/${deletingRecord.id}`, { method: "DELETE" });
      setDeletingRecord(null);
      reload();
      toast({ title: "給与明細を削除しました" });
    } catch (deleteError) {
      toast({ title: "削除に失敗しました", description: describeError(deleteError), variant: "error" });
    }
  };

  const openEdit = (record: SalaryRecord) => {
    setEditingRecord(record);
    setEditForm(fromSalaryRecord(record));
  };

  const closeEdit = () => {
    setEditingRecord(null);
    setEditForm(emptyForm);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setForm(emptyForm);
  };

  const canCreate = form.paidOn !== "" && form.grossAmount >= 0;
  const canEdit = editForm.paidOn !== "" && editForm.grossAmount >= 0;

  const columns: ResponsiveTableColumn<SalaryRecord>[] = [
    {
      key: "paidOn",
      header: "支給日",
      render: (record) => formatDateWithYear(record.paidOn),
    },
    {
      key: "kind",
      header: "種別",
      render: (record) => formatKind(record.kind),
    },
    {
      key: "name",
      header: "名称",
      render: (record) => record.name ?? "—",
    },
    {
      key: "grossAmount",
      header: "額面",
      align: "right",
      mono: true,
      render: (record) => formatCurrency(record.grossAmount, "JPY"),
    },
    {
      key: "deductionTotal",
      header: "控除額",
      align: "right",
      mono: true,
      render: (record) => formatCurrency(record.deductionTotal, "JPY"),
    },
    {
      key: "netAmount",
      header: "手取り",
      align: "right",
      mono: true,
      render: (record) => formatCurrency(record.netAmount, "JPY"),
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

  const renderMobileRow = (record: SalaryRecord) => (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-medium">{record.name ?? formatKind(record.kind)}</div>
          <div className="text-xs text-ink-3">{formatDateWithYear(record.paidOn)}</div>
        </div>
        <div className="font-data text-base font-semibold">{formatCurrency(record.grossAmount, "JPY")}</div>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-ink-3">
        <span>手取り {formatCurrency(record.netAmount, "JPY")}</span>
        <div className="flex gap-1">
          <IconButton aria-label="編集" onClick={() => openEdit(record)}>
            <Pencil aria-hidden="true" className="h-4 w-4" />
          </IconButton>
          <IconButton aria-label="削除" variant="danger" onClick={() => setDeletingRecord(record)}>
            <Trash2 aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
    </>
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">給与ログ</h2>
          <p className="mt-2 text-sm text-ink-2">給与明細を額面と控除内訳で記録します。</p>
          <p className="mt-1 max-w-3xl text-sm text-ink-2">
            残高予測や口座残高には影響しません。手取り額は入力に応じて自動計算されます。
          </p>
        </div>
        <Button className="min-h-10 gap-2" onClick={() => setCreateOpen(true)}>
          <Banknote aria-hidden="true" className="h-5 w-5" />
          給与明細を追加
        </Button>
      </div>

      <Card className="grid gap-4 sm:grid-cols-3">
        <div className="min-w-0 rounded-lg border border-line bg-surface-2 p-4">
          <div className="text-sm font-medium text-ink-3">{year}年の額面合計</div>
          <div className="font-data mt-3 overflow-x-auto whitespace-nowrap text-2xl font-semibold sm:text-3xl">
            {formatCurrency(grossTotal, "JPY")}
          </div>
        </div>
        <div className="min-w-0 rounded-lg border border-line bg-surface-2 p-4">
          <div className="text-sm font-medium text-ink-3">控除額合計</div>
          <div className="font-data mt-3 overflow-x-auto whitespace-nowrap text-2xl font-semibold sm:text-3xl">
            {formatCurrency(deductionTotal, "JPY")}
          </div>
        </div>
        <div className="min-w-0 rounded-lg border border-line bg-surface-2 p-4">
          <div className="text-sm font-medium text-ink-3">手取り合計</div>
          <div className="font-data mt-3 overflow-x-auto whitespace-nowrap text-2xl font-semibold sm:text-3xl">
            {formatCurrency(netTotal, "JPY")}
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">明細一覧</h2>
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
                : "給与明細が登録されていません。上部の「給与明細を追加」から登録してください。"
            }
            mobileRow={renderMobileRow}
          />
        )}
      </Card>

      <Dialog open={createOpen} onOpenChange={(open) => (open ? setCreateOpen(true) : closeCreate())}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">給与明細を追加</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">
            額面と控除内訳を入力すると、手取りがリアルタイムに表示されます。
          </DialogDescription>
          <SalaryFormDialog
            form={form}
            onChange={setForm}
            canSave={canCreate}
            actionLabel="追加"
            onCancel={closeCreate}
            onSave={createSalaryRecord}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingRecord)} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent size="m">
          <DialogTitle className="text-lg font-semibold">給与明細を編集</DialogTitle>
          <DialogDescription className="mt-2 text-sm text-ink-2">
            控除内訳を修正すると、手取りが自動で再計算されます。
          </DialogDescription>
          <SalaryFormDialog
            form={editForm}
            onChange={setEditForm}
            canSave={canEdit}
            actionLabel="保存"
            onCancel={closeEdit}
            onSave={updateSalaryRecord}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deletingRecord)}
        onOpenChange={(open) => !open && setDeletingRecord(null)}
        title="給与明細を削除しますか？"
        description={
          deletingRecord
            ? `「${deletingRecord.name ?? formatKind(deletingRecord.kind)}」を削除します。この操作は取り消せません。`
            : undefined
        }
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function SalaryFormDialog({
  form,
  onChange,
  canSave,
  actionLabel,
  onCancel,
  onSave,
}: {
  form: SalaryForm;
  onChange: (next: SalaryForm) => void;
  canSave: boolean;
  actionLabel: string;
  onCancel: () => void;
  onSave: () => void;
}) {
  const paidOnId = useId();
  const kindId = useId();
  const nameId = useId();
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  const setAmount = (key: keyof SalaryForm, value: number) => {
    onChange({ ...form, [key]: clampNonNegative(value) });
  };

  const { deductionTotal, netAmount } = deriveFromForm(form);

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
      <FormField label="支給日" htmlFor={paidOnId} required>
        <Input
          id={paidOnId}
          ref={firstFieldRef}
          type="date"
          value={form.paidOn}
          onChange={(event) => onChange({ ...form, paidOn: event.target.value })}
        />
      </FormField>

      <FormField label="種別" htmlFor={kindId}>
        <Select
          id={kindId}
          value={form.kind}
          onChange={(event) => onChange({ ...form, kind: event.target.value as SalaryRecordKind })}
        >
          <option value="salary">月給</option>
          <option value="bonus">賞与</option>
        </Select>
      </FormField>

      <FormField label="名称" htmlFor={nameId}>
        <Input
          id={nameId}
          value={form.name}
          onChange={(event) => onChange({ ...form, name: event.target.value })}
        />
      </FormField>

      <FormField label="額面" htmlFor="salary-gross" required>
        <MoneyInput
          id="salary-gross"
          currencyCode="JPY"
          value={form.grossAmount}
          onChange={(value) => setAmount("grossAmount", value)}
        />
      </FormField>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="健康保険" htmlFor="salary-health">
          <MoneyInput
            id="salary-health"
            currencyCode="JPY"
            value={form.healthInsurance}
            onChange={(value) => setAmount("healthInsurance", value)}
          />
        </FormField>
        <FormField label="厚生年金" htmlFor="salary-pension">
          <MoneyInput
            id="salary-pension"
            currencyCode="JPY"
            value={form.pensionInsurance}
            onChange={(value) => setAmount("pensionInsurance", value)}
          />
        </FormField>
        <FormField label="雇用保険" htmlFor="salary-employment">
          <MoneyInput
            id="salary-employment"
            currencyCode="JPY"
            value={form.employmentInsurance}
            onChange={(value) => setAmount("employmentInsurance", value)}
          />
        </FormField>
        <FormField label="子ども子育て支援金" htmlFor="salary-childcare">
          <MoneyInput
            id="salary-childcare"
            currencyCode="JPY"
            value={form.childcareSupportLevy}
            onChange={(value) => setAmount("childcareSupportLevy", value)}
          />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="所得税" htmlFor="salary-income-tax">
          <MoneyInput
            id="salary-income-tax"
            currencyCode="JPY"
            value={form.incomeTax}
            onChange={(value) => setAmount("incomeTax", value)}
          />
        </FormField>
        <FormField label="住民税" htmlFor="salary-resident-tax">
          <MoneyInput
            id="salary-resident-tax"
            currencyCode="JPY"
            value={form.residentTax}
            onChange={(value) => setAmount("residentTax", value)}
          />
        </FormField>
        <FormField label="その他控除" htmlFor="salary-other">
          <MoneyInput
            id="salary-other"
            currencyCode="JPY"
            value={form.otherDeductions}
            onChange={(value) => setAmount("otherDeductions", value)}
          />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField label="持株会拠出金" htmlFor="salary-stock-contribution">
          <MoneyInput
            id="salary-stock-contribution"
            currencyCode="JPY"
            value={form.employeeStockContribution}
            onChange={(value) => setAmount("employeeStockContribution", value)}
          />
        </FormField>
        <FormField label="持株会奨励金(控除)" htmlFor="salary-stock-incentive">
          <MoneyInput
            id="salary-stock-incentive"
            currencyCode="JPY"
            value={form.employeeStockIncentive}
            onChange={(value) => setAmount("employeeStockIncentive", value)}
          />
        </FormField>
        <FormField label="DCマッチング拠出金" htmlFor="salary-dc-matching">
          <MoneyInput
            id="salary-dc-matching"
            currencyCode="JPY"
            value={form.dcMatchingContribution}
            onChange={(value) => setAmount("dcMatchingContribution", value)}
          />
        </FormField>
      </div>

      <div className="grid gap-4 rounded-lg border border-line bg-surface-2 p-4 sm:grid-cols-2">
        <div>
          <div className="text-sm font-medium text-ink-3">控除額合計</div>
          <div className="font-data mt-1 text-xl font-semibold">{formatCurrency(deductionTotal, "JPY")}</div>
        </div>
        <div>
          <div className="text-sm font-medium text-ink-3">手取り</div>
          <div className="font-data mt-1 text-xl font-semibold">{formatCurrency(netAmount, "JPY")}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <div className="text-xs text-ink-3">{!canSave ? "額面は 0 以上の必須項目です。" : ""}</div>
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
