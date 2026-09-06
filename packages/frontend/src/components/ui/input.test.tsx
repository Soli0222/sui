import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { Input } from "./input";

afterEach(() => {
  cleanup();
});

describe("Input", () => {
  it.each([undefined, "text", "search", "number"])("通常入力には1Passwordの候補を抑制する (%s)", (type) => {
    const { container } = render(<Input type={type} />);
    const input = container.querySelector("input") as HTMLInputElement;

    expect(input.autocomplete).toBe("off");
    expect(input).toHaveAttribute("data-1p-ignore", "true");
  });

  it("明示したautoComplete、ref、イベントを維持する", () => {
    const ref = createRef<HTMLInputElement>();
    const onChange = vi.fn();
    const { container } = render(<Input ref={ref} autoComplete="transaction-amount" onChange={onChange} />);
    const input = container.querySelector("input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "100" } });
    expect(input.autocomplete).toBe("transaction-amount");
    expect(input).toHaveAttribute("data-1p-ignore", "true");
    expect(ref.current).toBe(input);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("パスワードマネージャーを許可する場合は抑制属性を出さない", () => {
    const { container } = render(<Input autoComplete="transaction-amount" allowPasswordManager />);
    const input = container.querySelector("input") as HTMLInputElement;

    expect(input.autocomplete).toBe("transaction-amount");
    expect(input).not.toHaveAttribute("data-1p-ignore");
    expect(input).not.toHaveAttribute("allowPasswordManager");
  });
});
