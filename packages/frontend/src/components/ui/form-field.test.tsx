import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormField, FieldGroup } from "./form-field";
import { Input } from "./input";
import { SegmentedControl } from "./segmented-control";

afterEach(() => cleanup());

describe("FormField", () => {
  it("binds label, required, help and errors to the real input", () => {
    render(<FormField label="金額" htmlFor="amount" required help="最小単位で入力" error="必須です">
      <Input id="amount" />
    </FormField>);
    const input = screen.getByRole("textbox", { name: /金額/ });
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "amount-help amount-error");
    expect(screen.getByText("最小単位で入力")).toHaveAttribute("id", "amount-help");
    expect(screen.getByRole("alert")).toHaveAttribute("id", "amount-error");
  });

  it("labels a segmented radio group and supports arrow navigation", () => {
    const onChange = vi.fn();
    const { rerender } = render(<FormField label="種別" htmlFor="type" help="選択してください">
      <SegmentedControl options={[{ value: "income", label: "収入" }, { value: "expense", label: "支出" }]}
        value="income" onChange={onChange} />
    </FormField>);
    const group = screen.getByRole("radiogroup", { name: "種別" });
    expect(group).toHaveAttribute("aria-describedby", "type-help");
    const income = screen.getByRole("radio", { name: "収入" });
    const expense = screen.getByRole("radio", { name: "支出" });
    expect(income).toHaveAttribute("tabindex", "0");
    expect(expense).toHaveAttribute("tabindex", "-1");
    income.focus();
    fireEvent.keyDown(income, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("expense");
    expect(expense).toHaveFocus();
    rerender(<FormField label="種別" htmlFor="type"><SegmentedControl
      options={[{ value: "income", label: "収入" }, { value: "expense", label: "支出" }]}
      value="expense" onChange={onChange} /></FormField>);
    expect(screen.getByRole("radio", { name: "支出" })).toHaveAttribute("tabindex", "0");
  });

  it("uses fieldset and legend for grouped controls", () => {
    render(<FieldGroup legend="期間" help="終了日だけ空欄可"><Input aria-label="開始日" /></FieldGroup>);
    expect(screen.getByRole("group", { name: "期間" })).toHaveAttribute("aria-describedby");
  });
});
