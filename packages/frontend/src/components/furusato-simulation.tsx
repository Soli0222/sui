import type { FurusatoSimulationInputPayload, FurusatoSimulationResponse } from "@sui/shared";
import { startTransition, useState } from "react";
import { useResource } from "../hooks/use-resource";
import { useToast } from "../hooks/use-toast";
import { apiFetch } from "../lib/api";
import { formatCurrency } from "../lib/format";
import { getCurrentYearMonth } from "../lib/utils";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { FormField } from "./ui/form-field";
import { MoneyInput } from "./ui/money-input";
import { PeriodSelector } from "./period-selector";

type SimulationForm = Omit<FurusatoSimulationInputPayload, "year">;

const emptyForm: SimulationForm = {
  expectedBonusGross: 0,
  otherIncome: 0,
  otherDeductions: 0,
};

const currentYear = Number(getCurrentYearMonth().slice(0, 4));

function yearOptions() {
  const start = currentYear - 5;
  const end = currentYear + 2;
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const year = start + index;
    return { value: String(year), label: `${year}年` };
  });
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

export function FurusatoSimulation({
  year,
  onYearChange,
}: {
  year: string;
  onYearChange: (year: string) => void;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState<{ year: string; input: SimulationForm } | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { data, loading, error } = useResource(
    () => apiFetch<FurusatoSimulationResponse>(`/api/furusato/simulation?year=${year}`),
    [year, reloadKey],
  );

  const reload = () => startTransition(() => setReloadKey((value) => value + 1));
  const activeData = data?.year === Number(year) ? data : null;
  const form =
    draft?.year === year
      ? draft.input
      : activeData
        ? activeData.input
        : emptyForm;
  const clampNonNegative = (input: SimulationForm): SimulationForm => ({
    expectedBonusGross: Math.max(0, input.expectedBonusGross),
    otherIncome: Math.max(0, input.otherIncome),
    otherDeductions: Math.max(0, input.otherDeductions),
  });

  const updateForm = (update: (current: SimulationForm) => SimulationForm) => {
    setDraft({ year, input: clampNonNegative(update(form)) });
  };
  const limit = activeData?.limit ?? 0;
  const donated = activeData?.donations.total ?? 0;
  const remaining = activeData?.donations.remaining ?? 0;
  const progress = limit > 0 ? Math.min(100, Math.max(0, (donated / limit) * 100)) : 0;

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch("/api/furusato/simulation-input", {
        method: "PUT",
        body: JSON.stringify({ year: Number(year), ...form } satisfies FurusatoSimulationInputPayload),
      });
      toast({ title: "シミュレーション条件を保存しました" });
      setDraft(null);
      reload();
    } catch (saveError) {
      toast({
        title: "保存に失敗しました",
        description: describeError(saveError),
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

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
          onChange={onYearChange}
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

          <Card>
            <details>
              <summary className="cursor-pointer font-medium">見込み条件</summary>
              <p className="mt-2 text-sm text-ink-2">未支給の賞与と、給与台帳に含まれない所得・控除を入力します。</p>
              <form
                className="mt-5 grid gap-4 sm:grid-cols-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <FormField
                  label="未支給賞与の見込み額面"
                  htmlFor="expected-bonus-gross"
                  help="給与台帳に登録済みの賞与は実績として別に集計されます。ここには未支給分だけを入力します。"
                >
                  <MoneyInput
                    id="expected-bonus-gross"
                    value={form.expectedBonusGross}
                    onChange={(value) => updateForm((current) => ({ ...current, expectedBonusGross: value }))}
                  />
                </FormField>
                <FormField label="給与以外の所得金額" htmlFor="other-income">
                  <MoneyInput
                    id="other-income"
                    value={form.otherIncome}
                    onChange={(value) => updateForm((current) => ({ ...current, otherIncome: value }))}
                  />
                </FormField>
                <FormField label="その他の所得控除" htmlFor="other-deductions">
                  <MoneyInput
                    id="other-deductions"
                    value={form.otherDeductions}
                    onChange={(value) => updateForm((current) => ({ ...current, otherDeductions: value }))}
                  />
                </FormField>
                <div className="sm:col-span-3 flex justify-end">
                  <Button type="submit" disabled={loading || saving}>
                    {saving ? "保存中..." : "条件を保存して再計算"}
                  </Button>
                </div>
              </form>
            </details>
          </Card>
        </>
      )}

      <p className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm text-ink-2">
        令和7年分の税制に基づく概算です。調整控除等は考慮していません。正確な上限額は各自治体・税務署等で確認してください。
      </p>
    </section>
  );
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
