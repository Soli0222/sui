import { type SupportedCurrencyCode } from "@sui/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { MoneyInput } from "./money-input";

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
