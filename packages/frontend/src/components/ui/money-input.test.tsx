import { type SupportedCurrencyCode } from "@sui/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { MoneyInput, readMoneyDraft } from "./money-input";

afterEach(() => {
  cleanup();
});

function StatefulMoneyInput({
  initialValue,
  currencyCode,
  onChange,
}: {
  initialValue: number;
  currencyCode?: SupportedCurrencyCode;
  onChange?: (value: number) => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <MoneyInput
      value={value}
      currencyCode={currencyCode}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

function getInput(container: HTMLElement) {
  return container.querySelector("input") as HTMLInputElement;
}

describe("MoneyInput", () => {
  it("raw draft distinguishes empty, incomplete, zero, invalid, and minor units", () => {
    expect(readMoneyDraft("", "USD")).toEqual({ raw: "", kind: "empty", minorUnits: null });
    expect(readMoneyDraft("-", "USD")).toEqual({ raw: "-", kind: "incomplete", minorUnits: null });
    expect(readMoneyDraft("1.", "USD")).toEqual({ raw: "1.", kind: "incomplete", minorUnits: null });
    expect(readMoneyDraft("0", "USD")).toEqual({ raw: "0", kind: "valid", minorUnits: 0 });
    expect(readMoneyDraft("1,234.56", "USD")).toEqual({ raw: "1234.56", kind: "valid", minorUnits: 123456 });
    expect(readMoneyDraft("9".repeat(400), "JPY").kind).toBe("invalid");
  });

  it("reports invalid raw text without converting it to zero, and composes blur handlers", () => {
    const onChange = vi.fn();
    const onDraftChange = vi.fn();
    const onBlur = vi.fn();
    const { container } = render(<MoneyInput value={0} currencyCode="USD" onChange={onChange}
      onDraftChange={onDraftChange} onBlur={onBlur} />);
    const input = getInput(container);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1." } });
    expect(onDraftChange).toHaveBeenLastCalledWith({ raw: "1.", kind: "incomplete", minorUnits: null });
    fireEvent.change(input, { target: { value: "invalid" } });
    expect(onDraftChange).toHaveBeenLastCalledWith({ raw: "invalid", kind: "invalid", minorUnits: null });
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.blur(input);
    expect(input.value).toBe("invalid");
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("isolates local text when subject or currency changes", () => {
    const { container, rerender } = render(<MoneyInput value={0} currencyCode="JPY" draftKey="first" onChange={vi.fn()} />);
    const input = getInput(container);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "123" } });
    expect(input.value).toBe("123");
    rerender(<MoneyInput value={0} currencyCode="JPY" draftKey="second" onChange={vi.fn()} />);
    expect(input.value).toBe("0");
    rerender(<MoneyInput value={1234} currencyCode="USD" draftKey="second" onChange={vi.fn()} />);
    expect(input.value).toBe("12.34");
  });
  it("フォーカス時にゼロ値は空欄になり、USD/EURの小数入力ができる", () => {
    const onChange = vi.fn();
    const { container } = render(
      <StatefulMoneyInput initialValue={0} currencyCode="USD" onChange={onChange} />,
    );
    const input = getInput(container);

    expect(input.value).toBe("0.00");

    fireEvent.focus(input);
    expect(input.value).toBe("");

    fireEvent.change(input, { target: { value: "1234.56" } });
    expect(onChange).toHaveBeenLastCalledWith(123_456);
    expect(input.value).toBe("1234.56");

    fireEvent.blur(input);
    expect(input.value).toBe("1234.56");
  });

  it("フォーカス時にゼロ値は空欄になり、JPY整数を入力できる", () => {
    const onChange = vi.fn();
    const { container } = render(
      <StatefulMoneyInput initialValue={0} currencyCode="JPY" onChange={onChange} />,
    );
    const input = getInput(container);

    expect(input.value).toBe("0");

    fireEvent.focus(input);
    expect(input.value).toBe("");

    fireEvent.change(input, { target: { value: "1234" } });
    expect(onChange).toHaveBeenLastCalledWith(1234);
    expect(input.value).toBe("1234");

    fireEvent.blur(input);
    expect(input.value).toBe("1234");
  });

  it("非ゼロ値はフォーカス時に全選択され、上書き入力できる", () => {
    const onChange = vi.fn();
    const { container } = render(
      <StatefulMoneyInput initialValue={123_456} currencyCode="USD" onChange={onChange} />,
    );
    const input = getInput(container);

    expect(input.value).toBe("1234.56");

    fireEvent.focus(input);
    expect(input.value).toBe("1234.56");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("1234.56".length);

    fireEvent.change(input, { target: { value: "99" } });
    expect(onChange).toHaveBeenLastCalledWith(9900);
    expect(input.value).toBe("99");

    fireEvent.blur(input);
    expect(input.value).toBe("99.00");
  });

  it("空欄のままblurするとゼロ表示に戻る", () => {
    const onChange = vi.fn();
    const { container } = render(
      <StatefulMoneyInput initialValue={0} currencyCode="USD" onChange={onChange} />,
    );
    const input = getInput(container);

    fireEvent.focus(input);
    expect(input.value).toBe("");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(input.value).toBe("0.00");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("0を入力しても編集中の状態を壊さず、blurで整形される", () => {
    const onChange = vi.fn();
    const { container } = render(
      <StatefulMoneyInput initialValue={0} currencyCode="USD" onChange={onChange} />,
    );
    const input = getInput(container);

    fireEvent.focus(input);

    fireEvent.change(input, { target: { value: "0" } });
    expect(input.value).toBe("0");
    expect(onChange).toHaveBeenLastCalledWith(0);

    fireEvent.change(input, { target: { value: "0." } });
    expect(input.value).toBe("0.");
    expect(onChange).toHaveBeenLastCalledWith(0);

    fireEvent.change(input, { target: { value: "0.0" } });
    expect(input.value).toBe("0.0");
    expect(onChange).toHaveBeenLastCalledWith(0);

    fireEvent.blur(input);
    expect(input.value).toBe("0.00");
  });

  it("末尾小数点を許容し、blurで整形される", () => {
    const onChange = vi.fn();
    const { container } = render(
      <StatefulMoneyInput initialValue={0} currencyCode="USD" onChange={onChange} />,
    );
    const input = getInput(container);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "123." } });
    expect(onChange).toHaveBeenLastCalledWith(12_300);
    expect(input.value).toBe("123.");

    fireEvent.blur(input);
    expect(input.value).toBe("123.00");
  });

  it("負数を入力できる", () => {
    const onChange = vi.fn();
    const { container } = render(
      <StatefulMoneyInput initialValue={0} currencyCode="USD" onChange={onChange} />,
    );
    const input = getInput(container);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "-" } });
    expect(input.value).toBe("-");
    expect(onChange).toHaveBeenLastCalledWith(0);

    fireEvent.change(input, { target: { value: "-123.45" } });
    expect(input.value).toBe("-123.45");
    expect(onChange).toHaveBeenLastCalledWith(-12_345);

    fireEvent.blur(input);
    expect(input.value).toBe("-123.45");
  });

  it("カンマ付き金額を貼り付けても最小単位として保存し、不正な表記は無視する", () => {
    const onChange = vi.fn();
    const { container } = render(
      <StatefulMoneyInput initialValue={0} currencyCode="JPY" onChange={onChange} />,
    );
    const input = getInput(container);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "218,800" } });
    expect(input.value).toBe("218800");
    expect(onChange).toHaveBeenLastCalledWith(218_800);

    const calls = onChange.mock.calls.length;
    fireEvent.change(input, { target: { value: "21,88,00" } });
    expect(input.value).toBe("218800");
    expect(onChange).toHaveBeenCalledTimes(calls);
  });

  it("部分選択をカンマ付き金額で置換できる", () => {
    const onChange = vi.fn();
    const { container } = render(
      <StatefulMoneyInput initialValue={123_456} currencyCode="JPY" onChange={onChange} />,
    );
    const input = getInput(container);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1,218,800" } });
    expect(input.value).toBe("1218800");
    expect(onChange).toHaveBeenLastCalledWith(1_218_800);
  });

  it("親valueがフォーカス外で変化したとき表示が追従する", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <MoneyInput value={0} currencyCode="USD" onChange={onChange} />,
    );
    const input = getInput(container);

    expect(input.value).toBe("0.00");

    rerender(<MoneyInput value={50_000} currencyCode="USD" onChange={onChange} />);
    expect(input.value).toBe("500.00");

    rerender(<MoneyInput value={-12_345} currencyCode="USD" onChange={onChange} />);
    expect(input.value).toBe("-123.45");
  });

  it("currencyCodeがフォーカス外で変化したとき表示が追従する", () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <MoneyInput value={100} currencyCode="JPY" onChange={onChange} />,
    );
    const input = getInput(container);

    expect(input.value).toBe("100");

    rerender(<MoneyInput value={100} currencyCode="USD" onChange={onChange} />);
    expect(input.value).toBe("1.00");
  });

  it("idとrefを維持する", () => {
    const inputRef = createRef<HTMLInputElement>();
    render(<MoneyInput id="amount" value={0} onChange={vi.fn()} ref={inputRef} />);

    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.id).toBe("amount");
    expect(inputRef.current).toBe(input);
  });

  it("1Passwordの候補を抑制し、例外指定時には属性を出さない", () => {
    const { container, rerender } = render(<MoneyInput value={0} onChange={vi.fn()} />);
    const input = getInput(container);

    expect(input.autocomplete).toBe("off");
    expect(input).toHaveAttribute("data-1p-ignore", "true");

    rerender(<MoneyInput value={0} onChange={vi.fn()} allowPasswordManager autoComplete="transaction-amount" />);
    expect(input.autocomplete).toBe("transaction-amount");
    expect(input).not.toHaveAttribute("data-1p-ignore");
  });

  it("通貨記号が表示される", () => {
    const { container } = render(<MoneyInput value={0} currencyCode="USD" onChange={vi.fn()} />);
    expect(container.textContent).toContain("$");
  });

  it("デフォルト通貨はJPY", () => {
    const { container } = render(<MoneyInput value={0} onChange={vi.fn()} />);
    const input = getInput(container);
    expect(input.value).toBe("0");
    expect(container.textContent).toContain("¥");
  });
});
