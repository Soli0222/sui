import type { Account } from "@sui/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSelect, PeriodFields } from "./form-fields";

afterEach(() => cleanup());

const accounts = [
  { id: "long", name: "とても長い名前の普通口座", currencyCode: "JPY" },
  { id: "usd", name: "米ドル口座", currencyCode: "USD" },
] as Account[];

describe("shared fields", () => {
  it("shows currency and preserves an unavailable selected account visibly", () => {
    render(<AccountSelect id="account" label="引落口座" accounts={accounts} value="usd" currencyFilter="JPY"
      onChange={vi.fn()} required={false} />);
    const select = screen.getByRole("combobox", { name: "引落口座" });
    expect(select).toHaveValue("usd");
    expect(screen.getByRole("option", { name: "米ドル口座 (USD)・対象外" })).toBeDisabled();
    expect(screen.getByRole("option", { name: "とても長い名前の普通口座 (JPY)" })).toBeInTheDocument();
    expect(select).not.toBeRequired();
  });

  it("associates the unlimited-period help only with the end date", () => {
    render(<PeriodFields idPrefix="period" startDate="" endDate="" onChangeStartDate={vi.fn()} onChangeEndDate={vi.fn()} />);
    expect(screen.getByLabelText("終了日")).toHaveAttribute("aria-describedby", "period-end-help");
    expect(screen.getByLabelText("開始日")).not.toHaveAttribute("aria-describedby");
  });
});
