import type { FurusatoSimulationInputPayload, FurusatoSimulationResponse } from "@sui/shared";
import { startTransition, useEffect, useRef, useState } from "react";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { getCurrentYearMonth } from "../lib/utils";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { FormField } from "./ui/form-field";
import { MoneyInput, readMoneyDraft } from "./ui/money-input";
import { PeriodSelector } from "./period-selector";
import { useEditSession, type EditErrors } from "../hooks/use-edit-session";
import { useFieldValidation } from "../hooks/use-field-validation";
import type { EditChange } from "./editing/edit-surface";

type SimulationForm = Omit<FurusatoSimulationInputPayload, "year">;

function yearOptions() {
  const currentYear = Number(getCurrentYearMonth().slice(0, 4));
  const start = currentYear - 5;
  const end = currentYear + 2;
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const year = start + index;
    return { value: String(year), label: `${year}年` };
  });
}

type SimulationDraft = { expectedBonusGross: string; otherIncome: string; otherDeductions: string };
const toDraft = (input: SimulationForm): SimulationDraft => ({
  expectedBonusGross: String(input.expectedBonusGross), otherIncome: String(input.otherIncome), otherDeductions: String(input.otherDeductions),
});
function validateSimulation(draft: SimulationDraft): EditErrors {
  const errors: EditErrors = {};
  for (const key of Object.keys(draft) as Array<keyof SimulationDraft>) {
    const value = readMoneyDraft(draft[key], "JPY");
    if (value.kind !== "valid" || value.minorUnits === null || value.minorUnits < 0) errors[key] = "0以上の金額を入力してください";
  }
  return errors;
}

export function FurusatoSimulation({
  year,
  onYearChange,
}: {
  year: string;
  onYearChange: (year: string) => void;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const yearTransitionRef = useRef<((next: string) => void) | null>(null);
  const { data, loading, error, setData } = useResource(
    () => apiFetch<FurusatoSimulationResponse>(`/api/furusato/simulation?year=${year}`),
    [year, reloadKey],
  );

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));
  const activeData = data?.year === Number(year) ? data : null;
  const limit = activeData?.limit ?? 0;
  const donated = activeData?.donations.total ?? 0;
  const remaining = activeData?.donations.remaining ?? 0;
  const progress = limit > 0 ? Math.min(100, Math.max(0, (donated / limit) * 100)) : 0;

  return (
    <section className="grid gap-4" aria-labelledby="furusato-simulation-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="furusato-simulation-title" className="text-2xl font-semibold">
            ふるさと納税シミュレーション
          </h1>
          <p className="mt-2 text-sm text-ink-2">給与と寄付の実績から控除上限の目安を計算します。</p>
        </div>
        <PeriodSelector
          presets={yearOptions()}
          selected={year}
          onChange={(next) => yearTransitionRef.current ? yearTransitionRef.current(next) : onYearChange(next)}
          ariaLabel="シミュレーション対象年"
        />
      </div>

      {error ? (
        <Card className="grid gap-3 border-critical/40 bg-critical/10">
          <p role="alert" className="text-sm">{error}</p>
          <Button className="justify-self-start" variant="secondary" onClick={reload}>
            再試行
          </Button>
        </Card>
      ) : (
        <>
          <Card className="grid gap-5">
            <div>
              <div className="text-sm font-medium text-ink-3">{year}年の上限額目安</div>
              <div className="font-data mt-2 text-3xl font-semibold sm:text-4xl">
                {loading ? "読み込み中..." : formatCurrency(limit, "JPY")}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-line bg-surface-2 p-4">
                <div className="text-sm text-ink-3">寄付済み</div>
                <div className="font-data mt-2 text-xl font-semibold">{formatCurrency(donated, "JPY")}</div>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 p-4">
                <div className="text-sm text-ink-3">残り寄付可能額</div>
                <div className="font-data mt-2 text-xl font-semibold">{formatCurrency(remaining, "JPY")}</div>
              </div>
            </div>
            <div>
              <div className="mb-2 flex justify-between text-xs text-ink-3">
                <span>上限に対する寄付状況</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div
                className="h-3 overflow-hidden rounded-full bg-surface-3"
                role="progressbar"
                aria-label="上限に対する寄付状況"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
              >
                <div className="h-full rounded-full bg-brand" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </Card>

          {activeData ? <ProjectionDetails data={activeData} /> : null}

          {activeData ? <SimulationInputsEditor key={year} year={year} input={activeData.input} onRefreshed={setData} onYearChange={onYearChange} yearTransitionRef={yearTransitionRef} /> : null}
        </>
      )}

      <p className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-ink-2">
        令和7年分の税制に基づく概算です。調整控除等は考慮していません。正確な上限額は各自治体・税務署等で確認してください。
      </p>
    </section>
  );
}

function SimulationInputsEditor({ year, input, onRefreshed, onYearChange, yearTransitionRef }: {
  year: string; input: SimulationForm; onRefreshed: (data: FurusatoSimulationResponse) => void; onYearChange: (year: string) => void;
  yearTransitionRef: { current: ((next: string) => void) | null };
}) {
  const { toast } = useToast();
  const session = useEditSession({ identity: `furusato-input:${year}`, initial: toDraft(input), validate: validateSimulation,
    fieldIds: { expectedBonusGross: "expected-bonus-gross", otherIncome: "other-income", otherDeductions: "other-deductions" } });
  const form = session.draft;
  const fields = useFieldValidation(form, validateSimulation,
    { expectedBonusGross: "expected-bonus-gross", otherIncome: "other-income", otherDeductions: "other-deductions" });
  const requestTransition = session.requestTransition;
  useEffect(() => {
    yearTransitionRef.current = (next) => requestTransition(() => onYearChange(next));
    return () => { yearTransitionRef.current = null; };
  }, [yearTransitionRef, requestTransition, onYearChange]);
  const labels: Record<keyof SimulationDraft, string> = {
    expectedBonusGross: "未支給賞与の見込み額面", otherIncome: "給与以外の所得金額", otherDeductions: "その他の所得控除",
  };
  const changes: EditChange[] = (Object.keys(form) as Array<keyof SimulationDraft>)
    .filter((key) => form[key] !== session.snapshot[key])
    .map((key) => ({ label: labels[key], before: `${session.snapshot[key]} 円`, after: `${form[key] || "未入力"} 円` }));
  const refresh = async () => {
    const loaded = await apiFetch<FurusatoSimulationResponse>(`/api/furusato/simulation?year=${year}`);
    onRefreshed(loaded);
    return toDraft(loaded.input);
  };
  const save = async () => {
    fields.showAll();
    const ok = await session.save((value) => apiFetch("/api/furusato/simulation-input", {
      method: "PUT", body: JSON.stringify({ year: Number(year),
        expectedBonusGross: readMoneyDraft(value.expectedBonusGross, "JPY").minorUnits ?? 0,
        otherIncome: readMoneyDraft(value.otherIncome, "JPY").minorUnits ?? 0,
        otherDeductions: readMoneyDraft(value.otherDeductions, "JPY").minorUnits ?? 0,
      } satisfies FurusatoSimulationInputPayload),
    }), refresh);
    if (ok) toast({ title: "シミュレーション条件を保存しました" });
  };
  const busy = session.status === "saving" || session.status === "refreshing";
  return <Card>
    <details open={session.dirty || session.status === "error" || session.status === "refresh-error" ? true : undefined}>
      <summary className="cursor-pointer font-medium">見込み条件</summary>
      <p className="mt-2 text-sm text-ink-2">未保存の条件は上の試算に反映されません。保存するとこの年の条件だけが更新されます。</p>
      <form className="mt-5 grid gap-4 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        {(Object.keys(labels) as Array<keyof SimulationDraft>).map((key) => {
          const id = key === "expectedBonusGross" ? "expected-bonus-gross" : key === "otherIncome" ? "other-income" : "other-deductions";
          const amount = readMoneyDraft(form[key], "JPY");
          return <FormField key={key} label={labels[key]} htmlFor={id} error={fields.visibleErrors[key]}
            help={key === "expectedBonusGross" ? "給与台帳に登録済みの賞与は実績として別に集計されます。ここには未支給分だけを入力します。" : undefined}>
            <MoneyInput id={id} value={amount.minorUnits} draftValue={form[key]} onChange={() => {}}
              onDraftChange={(next) => session.setDraft({ ...form, [key]: next.raw })} onBlur={() => fields.touch(key)} />
          </FormField>;
        })}
        <div className="sm:col-span-3 border-t border-line pt-4">
          <p role="status" className="text-sm text-ink-2">{session.status === "saved" ? "保存済み" : session.status === "refresh-error" ? "保存済み・表示更新失敗" : busy ? "保存中" : session.dirty ? "未保存の条件" : "変更なし"}</p>
          {changes.length > 0 ? <dl className="mt-2 grid gap-1 text-sm">{changes.map((change) => <div key={change.label}><dt className="inline font-medium">{change.label}: </dt><dd className="inline">{change.before} → {change.after}</dd></div>)}</dl> : null}
          {session.error ? <p role="alert" className="mt-2 text-sm text-critical">{session.error}</p> : null}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {session.status === "refresh-error" ? <Button type="button" variant="secondary" onClick={() => void session.retryRefresh()}>表示を再取得</Button> : null}
            {session.dirty ? <Button type="button" variant="ghost" disabled={busy} onClick={() => session.requestClose(session.discard)}>変更を破棄</Button> : null}
            <Button type="submit" disabled={!session.dirty || busy || session.status === "refresh-error"}>{busy ? "保存中..." : "条件を保存して再計算"}</Button>
          </div>
        </div>
      </form>
    </details>
  </Card>;
}

function ProjectionDetails({ data }: { data: FurusatoSimulationResponse }) {
  const rows = [
    ["給与・賞与の実績", formatCurrency(data.projection.salaryActualGross, "JPY")],
    ["月給の外挿分", formatCurrency(data.projection.extrapolatedGross, "JPY")],
    ["未支給賞与の見込み（手入力）", formatCurrency(data.input.expectedBonusGross, "JPY")],
    ["給与収入見込み", formatCurrency(data.projection.expectedGrossIncome, "JPY")],
    ["社会保険料見込み", formatCurrency(data.projection.socialInsurance, "JPY")],
    ["給与所得", formatCurrency(data.projection.employmentIncome, "JPY")],
    ["課税所得（所得税）", formatCurrency(data.projection.taxableIncomeNational, "JPY")],
    ["課税所得（住民税）", formatCurrency(data.projection.taxableIncomeResident, "JPY")],
    ["所得税の限界税率", `${data.projection.marginalTaxRate * 100}%`],
    ["所得税控除分", formatCurrency(data.deduction.incomeTax, "JPY")],
    ["住民税基本分", formatCurrency(data.deduction.residentBasic, "JPY")],
    ["住民税特例分", formatCurrency(data.deduction.residentSpecial, "JPY")],
    ["実質自己負担", formatCurrency(data.deduction.selfBurden, "JPY")],
  ];

  return (
    <Card>
      <details>
        <summary className="cursor-pointer font-medium">見込みと控除の内訳</summary>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 border-b border-line pb-2">
              <dt className="text-sm text-ink-3">{label}</dt>
              <dd className="font-data text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </details>
    </Card>
  );
}
