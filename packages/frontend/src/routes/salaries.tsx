import { INT4_MAX, INT4_MIN, type CreateSalaryRecordPayload, type SalaryRecord, type SalaryRecordKind } from "@sui/shared";
import { useRef, useState, startTransition } from "react";
import { flushSync } from "react-dom";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { EditPage, type EditChange } from "../components/editing/edit-surface";
import { Button, IconButton } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { ConfirmDialog } from "../components/ui/confirm-dialog";
import { Disclosure } from "../components/ui/disclosure";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { MoneyInput, readMoneyDraft } from "../components/ui/money-input";
import { PeriodSelector } from "../components/period-selector";
import { ResponsiveTable, type ResponsiveTableColumn } from "../components/ui/responsive-table";
import { Select } from "../components/ui/select";
import { useResource } from "../hooks/use-resource";
import { useEditSession, type EditErrors } from "../hooks/use-edit-session";
import { useFieldValidation } from "../hooks/use-field-validation";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { formatCurrency, formatCurrencyInputValue, formatDateWithYear } from "../lib/format";
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
  yearEndTaxAdjustment: number;
  employeeStockContribution: number;
  employeeStockIncentive: number;
  dcMatchingContribution: number;
  otherDeductions: number;
};

/** 控除項目。年末調整過不足税額のようにマイナス（＝手取りが増える）を許す。 */
const deductionKeys = [
  "healthInsurance",
  "pensionInsurance",
  "employmentInsurance",
  "childcareSupportLevy",
  "incomeTax",
  "residentTax",
  "yearEndTaxAdjustment",
  "employeeStockContribution",
  "employeeStockIncentive",
  "dcMatchingContribution",
  "otherDeductions",
] as const satisfies readonly (keyof SalaryForm)[];
const amountKeys = ["grossAmount", ...deductionKeys] as const;
type SalaryAmountKey = typeof amountKeys[number];
type SalaryDraft = Pick<SalaryForm, "paidOn" | "kind" | "name"> & Record<SalaryAmountKey, string>;

const currentYear = Number(getCurrentYearMonth().slice(0, 4));

const emptyForm: SalaryForm = {
  paidOn: "",
  kind: "salary",
  name: "",
  grossAmount: 0,
  healthInsurance: 0,
  pensionInsurance: 0,
  employmentInsurance: 0,
  childcareSupportLevy: 0,
  incomeTax: 0,
  residentTax: 0,
  yearEndTaxAdjustment: 0,
  employeeStockContribution: 0,
  employeeStockIncentive: 0,
  dcMatchingContribution: 0,
  otherDeductions: 0,
};

function formatKind(kind: SalaryRecordKind) {
  return kind === "salary" ? "月給" : "賞与";
}

function deriveFromForm(form: SalaryForm) {
  const socialInsuranceTotal =
    form.healthInsurance +
    form.pensionInsurance +
    form.employmentInsurance +
    form.childcareSupportLevy;
  const deductionTotal =
    socialInsuranceTotal +
    form.incomeTax +
    form.residentTax +
    form.yearEndTaxAdjustment +
    form.employeeStockContribution +
    form.employeeStockIncentive +
    form.dcMatchingContribution +
    form.otherDeductions;
  const netAmount = form.grossAmount - deductionTotal;
  return { socialInsuranceTotal, deductionTotal, netAmount };
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
    yearEndTaxAdjustment: form.yearEndTaxAdjustment,
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
    yearEndTaxAdjustment: record.yearEndTaxAdjustment,
    employeeStockContribution: record.employeeStockContribution,
    employeeStockIncentive: record.employeeStockIncentive,
    dcMatchingContribution: record.dcMatchingContribution,
    otherDeductions: record.otherDeductions,
  };
}

function toDraft(form: SalaryForm): SalaryDraft {
  return Object.fromEntries(Object.entries(form).map(([key, value]) =>
    amountKeys.includes(key as SalaryAmountKey) ? [key, formatCurrencyInputValue(value as number, "JPY")] : [key, value],
  )) as SalaryDraft;
}

function fromDraft(draft: SalaryDraft): SalaryForm {
  return Object.fromEntries(Object.entries(draft).map(([key, value]) =>
    amountKeys.includes(key as SalaryAmountKey) ? [key, readMoneyDraft(value as string, "JPY").minorUnits ?? 0] : [key, value],
  )) as SalaryForm;
}

function validateSalary(draft: SalaryDraft): EditErrors {
  const errors: EditErrors = {};
  if (!draft.paidOn) errors.paidOn = "支給日を入力してください。";
  if (draft.name.trim().length > 100) errors.name = "名称は100文字以下で入力してください。";
  for (const key of amountKeys) {
    const parsed = readMoneyDraft(draft[key], "JPY");
    if (parsed.kind !== "valid" || parsed.minorUnits === null || parsed.minorUnits < INT4_MIN || parsed.minorUnits > INT4_MAX ||
      (key === "grossAmount" && parsed.minorUnits < 0)) {
      errors[key] = key === "grossAmount" ? "額面を0以上の整数で入力してください。" : "控除額をint32の範囲の整数で入力してください。";
    }
  }
  return errors;
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

function selectedYear(value: string | null) {
  return value && /^\d{4}$/.test(value) && Number(value) >= 1 && Number(value) <= 9998 ? value : String(currentYear);
}

export function SalariesPage() {
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const year = selectedYear(search.get("year"));
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

  const openEdit = (record: SalaryRecord) => navigate(`/salaries/${record.id}/edit?year=${year}`);
  const openCreate = () => navigate(`/salaries/new?year=${year}`);

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
      key: "socialInsuranceTotal",
      header: "社会保険料",
      align: "right",
      mono: true,
      render: (record) => formatCurrency(record.socialInsuranceTotal, "JPY"),
    },
    {
      key: "deductionTotal",
      header: "控除額合計",
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
        <Button className="min-h-10 gap-2" onClick={openCreate}>
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
            onChange={(value) => setSearch({ year: value })}
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

export function SalaryEditorPage() {
  const { id } = useParams();
  const [reloadKey, setReloadKey] = useState(0);
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const year = selectedYear(search.get("year"));
  const back = () => navigate(`/salaries?year=${encodeURIComponent(year)}`);
  const isNew = id === undefined;
  const { data, loading, error } = useResource(
    () => isNew ? Promise.resolve(null) : apiFetch<SalaryRecord>(`/api/salary-records/${id}`),
    [id, reloadKey],
  );
  const reload = () => setReloadKey((value) => value + 1);
  const activeRecord = !isNew && data?.id === id ? data : null;
  if (!isNew && (loading || (!activeRecord && !error))) return <p role="status" className="p-4">読み込み中...</p>;
  if (error) return <div className="grid gap-3 p-4"><ErrorBlock message={error} onRetry={reload} /><Button variant="ghost" onClick={back}>給与ログに戻る</Button></div>;
  const initial = toDraft(activeRecord ? fromSalaryRecord(activeRecord) : { ...emptyForm, paidOn: getTodayDate() });
  return <SalaryFormEditor key={id ?? "new"} initial={initial} record={activeRecord} onDone={back} />;
}

const moneyFields: { key: SalaryAmountKey; label: string; help?: string }[] = [
  { key: "grossAmount", label: "額面", help: "持株会奨励金など課税支給に含まれるものを加えた総支給額を入力します。" },
  { key: "healthInsurance", label: "健康保険" },
  { key: "pensionInsurance", label: "厚生年金" },
  { key: "employmentInsurance", label: "雇用保険" },
  { key: "childcareSupportLevy", label: "子ども子育て支援金" },
  { key: "incomeTax", label: "所得税" },
  { key: "residentTax", label: "住民税" },
  { key: "yearEndTaxAdjustment", label: "年末調整過不足税額", help: "不足徴収はプラス、還付はマイナスで入力します。" },
  { key: "otherDeductions", label: "その他控除" },
  { key: "employeeStockContribution", label: "持株会拠出金" },
  { key: "employeeStockIncentive", label: "持株会奨励金(控除)" },
  { key: "dcMatchingContribution", label: "DCマッチング拠出金" },
];

function SalaryFormEditor({ initial, record, onDone }: { initial: SalaryDraft; record: SalaryRecord | null; onDone: () => void }) {
  const savedId = useRef<string | null>(record?.id ?? null);
  const rare = new Set<SalaryAmountKey>(["employeeStockContribution", "employeeStockIncentive", "dcMatchingContribution", "otherDeductions"]);
  const original = fromDraft(initial);
  const [rareOpen, setRareOpen] = useState([...rare].some((key) => original[key] !== 0));
  const identity = record ? `salary:${record.id}` : "salary:new";
  const session = useEditSession({ identity, initial, validate: validateSalary });
  const validation = useFieldValidation(session.draft, validateSalary);
  const update = <K extends keyof SalaryDraft>(key: K, value: SalaryDraft[K]) => session.setDraft((draft) => ({ ...draft, [key]: value }));
  const parsed = fromDraft(session.draft);
  const derived = deriveFromForm(parsed);
  const originalDerived = deriveFromForm(original);
  const changes: EditChange[] = [];
  if (record && session.dirty) {
    if (session.draft.paidOn !== initial.paidOn) changes.push({ label: "支給日", before: initial.paidOn, after: session.draft.paidOn });
    if (session.draft.kind !== initial.kind) changes.push({ label: "種別", before: formatKind(initial.kind), after: formatKind(session.draft.kind) });
    for (const { key, label } of moneyFields) {
      if (session.draft[key] !== initial[key]) changes.push({ label, before: initial[key], after: session.draft[key] });
    }
    if (session.draft.name !== initial.name) changes.push({ label: "名称", before: initial.name || "—", after: session.draft.name || "—" });
  }
  const save = async () => {
    if ([...rare].some((key) => validateSalary(session.draft)[key])) flushSync(() => setRareOpen(true));
    validation.showAll();
    const success = await session.save(async (draft) => {
      const payload = toApiPayload(fromDraft(draft));
      const response = await apiFetch<SalaryRecord>(record ? `/api/salary-records/${record.id}` : "/api/salary-records", {
        method: record ? "PATCH" : "POST", body: JSON.stringify(payload),
      });
      savedId.current = response.id;
    }, async () => {
      if (!savedId.current) throw new Error("保存後の給与明細を確認できません。");
      return toDraft(fromSalaryRecord(await apiFetch<SalaryRecord>(`/api/salary-records/${savedId.current}`)));
    });
    if (success) onDone();
  };
  const retryRefresh = async () => { if (await session.retryRefresh()) onDone(); };
  const renderMoney = ({ key, label, help }: typeof moneyFields[number]) => <FormField key={key} label={label} htmlFor={key} required={key === "grossAmount"} help={help} error={validation.visibleErrors[key] ?? session.errors[key]}>
    <MoneyInput id={key} currencyCode="JPY" value={readMoneyDraft(session.draft[key], "JPY").minorUnits}
      draftValue={session.draft[key]} draftKey={identity} onChange={() => {}}
      onDraftChange={(value) => update(key, value.raw)} onBlur={() => validation.touch(key)} />
  </FormField>;
  return <EditPage subjectType="給与明細" subjectName={record?.name ?? "給与明細"} title={record ? `${record.name ?? formatKind(record.kind)}（${record.paidOn}）を編集` : "給与明細を追加"}
    mode={record ? "edit" : "create"} status={session.status} changes={changes}
    impact={<>手取り {formatCurrency(originalDerived.netAmount, "JPY")} → {formatCurrency(derived.netAmount, "JPY")}。給与ログの集計に反映します。口座残高や残高予測には直接反映しません。</>}
    error={session.error} saveLabel={record ? "変更を保存" : "明細を追加"} onRequestClose={() => session.requestClose(onDone)} onSave={save}
    onRetryRefresh={retryRefresh}>
    <Button type="button" variant="ghost" className="mb-4" onClick={() => session.requestClose(onDone)}>給与ログに戻る</Button>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)]">
      <div className="grid min-w-0 gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="支給日" htmlFor="paidOn" required error={validation.visibleErrors.paidOn ?? session.errors.paidOn}>
            <Input id="paidOn" type="date" value={session.draft.paidOn} onChange={(event) => update("paidOn", event.target.value)} onBlur={() => validation.touch("paidOn")} />
          </FormField>
          <FormField label="種別" htmlFor="kind"><Select id="kind" value={session.draft.kind} onChange={(event) => update("kind", event.target.value as SalaryRecordKind)}><option value="salary">月給</option><option value="bonus">賞与</option></Select></FormField>
          <FormField label="名称" htmlFor="name" error={validation.visibleErrors.name ?? session.errors.name}>
            <Input id="name" value={session.draft.name} onChange={(event) => update("name", event.target.value)} onBlur={() => validation.touch("name")} />
          </FormField>
        </div>
        {renderMoney(moneyFields[0])}
        <div className="grid gap-4 sm:grid-cols-2">{moneyFields.slice(1, 8).map(renderMoney)}</div>
        <Disclosure summary="その他の控除・拠出" open={rareOpen} onOpenChange={setRareOpen}>
          <div className="grid gap-4 sm:grid-cols-2">{moneyFields.filter(({ key }) => rare.has(key)).map(renderMoney)}</div>
        </Disclosure>
      </div>
      <Card className="grid content-start gap-3 self-start lg:sticky lg:top-4">
        <h3 className="font-semibold">計算結果</h3>
        <div className="flex justify-between gap-3"><span>額面</span><strong className="font-data">{formatCurrency(parsed.grossAmount, "JPY")}</strong></div>
        <div className="flex justify-between gap-3"><span>社会保険料合計</span><strong className="font-data">{formatCurrency(derived.socialInsuranceTotal, "JPY")}</strong></div>
        <div className="flex justify-between gap-3"><span>控除額合計</span><strong className="font-data">{formatCurrency(derived.deductionTotal, "JPY")}</strong></div>
        <div className="flex justify-between gap-3 border-t border-line pt-3"><span>手取り</span><strong className="font-data">{formatCurrency(derived.netAmount, "JPY")}</strong></div>
      </Card>
      <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
    </form>
  </EditPage>;
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
