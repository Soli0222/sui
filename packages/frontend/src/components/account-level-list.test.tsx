import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AccountLevelList, type AccountLevelRow } from "./account-level-list";

afterEach(() => {
  cleanup();
});

const baseRows: AccountLevelRow[] = [
  {
    id: "usd",
    name: "USD Wallet",
    currentBalance: 200000,
    currentBalanceJpy: 30000000,
    currencyCode: "USD",
    minBalance: 10000,
    minBalanceJpy: 1500000,
    minBalanceDate: "2026-07-11",
    warningLevel: "none",
  },
  {
    id: "jpy",
    name: "JPY Wallet",
    currentBalance: 1000000,
    currentBalanceJpy: 1000000,
    currencyCode: "JPY",
    minBalance: 500000,
    minBalanceJpy: 500000,
    minBalanceDate: "2026-07-11",
    warningLevel: "yellow",
  },
  {
    id: "eur",
    name: "EUR Wallet",
    currentBalance: 10000,
    currentBalanceJpy: 1700000,
    currencyCode: "EUR",
    minBalance: 5000,
    minBalanceJpy: 850000,
    minBalanceDate: "2026-07-11",
    warningLevel: "red",
  },
];

describe("AccountLevelList", () => {
  it("renders account names, balances, and min balance dates", () => {
    render(<AccountLevelList rows={baseRows} selectedId="total" onSelect={() => {}} />);

    expect(screen.getByText("USD Wallet")).toBeVisible();
    expect(screen.getByText("JPY Wallet")).toBeVisible();
    expect(screen.getByText("EUR Wallet")).toBeVisible();

    expect(screen.getByText("$2,000.00")).toBeVisible();
    expect(screen.getByText(/[¥￥]30,000,000/)).toBeVisible();
    expect(screen.getByText(/[¥￥]1,000,000/)).toBeVisible();
    expect(screen.getByText("€100.00")).toBeVisible();

    expect(screen.getAllByText(/期間内最小/)).toHaveLength(3);
    expect(screen.getAllByText(/2026年7月11日/)).toHaveLength(3);
  });

  it("shows the selected row with a different style", () => {
    const { container } = render(<AccountLevelList rows={baseRows} selectedId="jpy" onSelect={() => {}} />);
    const buttons = container.querySelectorAll("button");

    const jpyButton = Array.from(buttons).find((button) => button.textContent?.includes("JPY Wallet"));
    expect(jpyButton).toHaveClass("border-brand", "bg-surface-2");

    const usdButton = Array.from(buttons).find((button) => button.textContent?.includes("USD Wallet"));
    expect(usdButton).toHaveClass("border-line", "bg-surface-1");
  });

  it("calls onSelect when a row is clicked", () => {
    const onSelect = vi.fn();
    render(<AccountLevelList rows={baseRows} selectedId="total" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /EUR Wallet/ }));
    expect(onSelect).toHaveBeenCalledWith("eur");
  });

  it("renders bar widths proportional to the largest JPY balance", () => {
    const { container } = render(<AccountLevelList rows={baseRows} selectedId="total" onSelect={() => {}} />);
    const fills = container.querySelectorAll('[data-testid="account-level-bar-fill"]');

    expect(fills).toHaveLength(3);

    const usd = baseRows[0].currentBalanceJpy;
    const jpy = baseRows[1].currentBalanceJpy;
    const eur = baseRows[2].currentBalanceJpy;
    const max = Math.max(usd, jpy, eur);

    expect(fills[0]).toHaveStyle({ width: `${Math.max((usd / max) * 100, 3)}%` });
    expect(fills[1]).toHaveStyle({ width: `${Math.max((jpy / max) * 100, 3)}%` });
    expect(fills[2]).toHaveStyle({ width: `${Math.max((eur / max) * 100, 3)}%` });
  });

  it("uses a subgrid layout so the bar column shares the same track across all rows", () => {
    const { container } = render(<AccountLevelList rows={baseRows} selectedId="total" onSelect={() => {}} />);
    const list = container.firstElementChild;
    const buttons = container.querySelectorAll("button");

    expect(list).toHaveClass("grid", "grid-cols-1", "gap-2", "gap-x-4", "sm:grid-cols-[minmax(0,1fr)_fit-content(75%)]");

    for (const button of buttons) {
      expect(button).toHaveClass("grid-cols-subgrid", "col-span-full", "gap-y-2");
    }
  });

  it("keeps numeric amounts from wrapping", () => {
    const { container } = render(<AccountLevelList rows={baseRows} selectedId="total" onSelect={() => {}} />);
    const numericCells = container.querySelectorAll(".font-data.whitespace-nowrap");

    expect(numericCells.length).toBeGreaterThan(0);
    for (const cell of numericCells) {
      expect(cell).toHaveClass("overflow-x-auto", "whitespace-nowrap");
    }
  });
});
