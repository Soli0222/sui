import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FurusatoSimulationInputPayload, FurusatoSimulationResponse } from "@sui/shared";
import { FurusatoSimulation } from "./furusato-simulation";
import { formatCurrency } from "../lib/format";

vi.mock("../lib/api", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../lib/api";

const warningText =
  "令和7年分の税制に基づく概算です。調整控除等は考慮していません。正確な上限額は各自治体・税務署等で確認してください。";

const baseResponse: FurusatoSimulationResponse = {
  year: 2026,
  input: { expectedBonusGross: 0, otherIncome: 0, otherDeductions: 0 },
  projection: {
    salaryActualGross: 300_000,
    extrapolatedGross: 3_300_000,
    expectedGrossIncome: 3_600_000,
    socialInsurance: 540_000,
    employmentIncome: 2_440_000,
    totalIncome: 2_440_000,
    taxableIncomeNational: 1_020_000,
    taxableIncomeResident: 1_470_000,
    marginalTaxRate: 0.05,
  },
  limit: 36_631,
  donations: { total: 30_000, remaining: 6_631 },
  deduction: { incomeTax: 1_429, residentBasic: 2_800, residentSpecial: 23_770, selfBurden: 2_001 },
};

const updatedResponse: FurusatoSimulationResponse = {
  year: 2026,
  input: { expectedBonusGross: 600_000, otherIncome: 100_000, otherDeductions: 50_000 },
  projection: {
    salaryActualGross: 300_000,
    extrapolatedGross: 3_300_000,
    expectedGrossIncome: 4_200_000,
    socialInsurance: 630_000,
    employmentIncome: 2_920_000,
    totalIncome: 3_020_000,
    taxableIncomeNational: 1_460_000,
    taxableIncomeResident: 1_910_000,
    marginalTaxRate: 0.05,
  },
  limit: 46_996,
  donations: { total: 30_000, remaining: 16_996 },
  deduction: { incomeTax: 1_429, residentBasic: 2_800, residentSpecial: 23_770, selfBurden: 2_001 },
};

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: true,
      media: "",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.mocked(apiFetch).mockReset();
});

function waitForLoaded(limit = baseResponse.limit) {
  return waitFor(() => expect(screen.getByText(formatCurrency(limit, "JPY"))).toBeVisible());
}

function openConditions() {
  fireEvent.click(screen.getByText("見込み条件"));
}

async function fillMoneyInput(label: string, value: string) {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
  await waitFor(() => expect(input).toHaveValue(value));
  return input;
}

describe("FurusatoSimulation", () => {
  it("renders the limit, donated total, remaining amount, progress and warning", async () => {
    vi.mocked(apiFetch).mockResolvedValue(baseResponse);
    render(<FurusatoSimulation year="2026" onYearChange={() => {}} />);
    await waitForLoaded();

    expect(screen.getByText("2026年の上限額目安")).toBeVisible();
    expect(screen.getByText(formatCurrency(baseResponse.limit, "JPY"))).toBeVisible();
    expect(screen.getByText(formatCurrency(baseResponse.donations.total, "JPY"))).toBeVisible();
    expect(screen.getByText(formatCurrency(baseResponse.donations.remaining, "JPY"))).toBeVisible();

    const progress = screen.getByRole("progressbar", { name: "上限に対する寄付状況" });
    expect(progress).toHaveAttribute("aria-valuenow", "82");
    expect(screen.getByText("82%")).toBeVisible();

    expect(screen.getByText(warningText)).toBeVisible();
  });

  it("expands projection and deduction details", async () => {
    vi.mocked(apiFetch).mockResolvedValue(baseResponse);
    render(<FurusatoSimulation year="2026" onYearChange={() => {}} />);
    await waitForLoaded();

    fireEvent.click(screen.getByText("見込みと控除の内訳"));

    expect(screen.getByText("給与・賞与の実績")).toBeVisible();
    expect(screen.getByText(formatCurrency(baseResponse.projection.salaryActualGross, "JPY"))).toBeVisible();
    expect(screen.getByText("月給の外挿分")).toBeVisible();
    expect(screen.getByText(formatCurrency(baseResponse.projection.extrapolatedGross, "JPY"))).toBeVisible();
    expect(screen.getByText("未支給賞与の見込み（手入力）")).toBeVisible();
    expect(screen.getByText(formatCurrency(baseResponse.input.expectedBonusGross, "JPY"))).toBeVisible();
    expect(screen.getByText("社会保険料見込み")).toBeVisible();
    expect(screen.getByText(formatCurrency(baseResponse.projection.socialInsurance, "JPY"))).toBeVisible();
    expect(screen.getByText("所得税の限界税率")).toBeVisible();
    expect(screen.getByText("5%")).toBeVisible();
    expect(screen.getByText("実質自己負担")).toBeVisible();
    expect(screen.getByText(formatCurrency(baseResponse.deduction.selfBurden, "JPY"))).toBeVisible();
  });

  it("clamps progress at 100 percent when donations exceed the limit", async () => {
    const overLimit: FurusatoSimulationResponse = {
      ...baseResponse,
      limit: 10_000,
      donations: { total: 15_000, remaining: 0 },
    };
    vi.mocked(apiFetch).mockResolvedValue(overLimit);
    render(<FurusatoSimulation year="2026" onYearChange={() => {}} />);
    await waitForLoaded(10_000);

    const progress = screen.getByRole("progressbar", { name: "上限に対する寄付状況" });
    expect(progress).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("100%")).toBeVisible();
  });

  it("does not render stale response data from another year", async () => {
    const stale: FurusatoSimulationResponse = {
      ...baseResponse,
      year: 2025,
      limit: 100_000,
      donations: { total: 50_000, remaining: 50_000 },
    };
    vi.mocked(apiFetch).mockResolvedValue(stale);
    render(<FurusatoSimulation year="2026" onYearChange={() => {}} />);
    await waitFor(() => expect(screen.queryByText("読み込み中...")).not.toBeInTheDocument());

    expect(screen.queryByText(formatCurrency(100_000, "JPY"))).not.toBeInTheDocument();
    expect(screen.queryByText(formatCurrency(50_000, "JPY"))).not.toBeInTheDocument();
  });

  it("calls onYearChange when the year selector is changed", async () => {
    vi.mocked(apiFetch).mockResolvedValue(baseResponse);
    const onYearChange = vi.fn();
    render(<FurusatoSimulation year="2026" onYearChange={onYearChange} />);
    await waitForLoaded();

    const select = screen.getByLabelText("シミュレーション対象年");
    fireEvent.change(select, { target: { value: "2025" } });

    expect(onYearChange).toHaveBeenCalledWith("2025");
  });

  it("prevents negative monetary form values at the UI boundary", async () => {
    vi.mocked(apiFetch).mockResolvedValue(baseResponse);
    render(<FurusatoSimulation year="2026" onYearChange={() => {}} />);
    await waitForLoaded();
    openConditions();

    const input = screen.getByLabelText("未支給賞与の見込み額面") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "-5000" } });
    fireEvent.blur(input);

    await waitFor(() => expect(input).toHaveValue("0"));
  });

  it("saves all three inputs and triggers a refresh", async () => {
    vi.mocked(apiFetch).mockResolvedValue(baseResponse);
    render(<FurusatoSimulation year="2026" onYearChange={() => {}} />);
    await waitForLoaded();
    openConditions();

    vi.mocked(apiFetch).mockReset();
    vi.mocked(apiFetch).mockImplementation(async (path, init) => {
      if (init?.method === "PUT") {
        return {
          year: 2026,
          expectedBonusGross: 600_000,
          otherIncome: 100_000,
          otherDeductions: 50_000,
        } satisfies FurusatoSimulationInputPayload;
      }
      return updatedResponse;
    });

    await fillMoneyInput("未支給賞与の見込み額面", "600000");
    await fillMoneyInput("給与以外の所得金額", "100000");
    await fillMoneyInput("その他の所得控除", "50000");

    fireEvent.click(screen.getByRole("button", { name: "条件を保存して再計算" }));

    await waitFor(() => expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(2));

    expect(vi.mocked(apiFetch)).toHaveBeenNthCalledWith(
      1,
      "/api/furusato/simulation-input",
      {
        method: "PUT",
        body: JSON.stringify({
          year: 2026,
          expectedBonusGross: 600_000,
          otherIncome: 100_000,
          otherDeductions: 50_000,
        }),
      },
    );
    expect(vi.mocked(apiFetch)).toHaveBeenNthCalledWith(2, "/api/furusato/simulation?year=2026");

    await waitFor(() => expect(screen.getByText(formatCurrency(46_996, "JPY"))).toBeVisible());
    expect(screen.getByText(formatCurrency(16_996, "JPY"))).toBeVisible();
  });
});
