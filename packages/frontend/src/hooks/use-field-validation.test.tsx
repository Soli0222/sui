import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { FormField } from "../components/ui/form-field";
import { Input } from "../components/ui/input";
import { useFieldValidation } from "./use-field-validation";

afterEach(() => cleanup());

function Fixture() {
  const [value, setValue] = useState("");
  const validation = useFieldValidation(value, (draft): Record<string, string> => draft ? {} : { name: "名前を入力してください" });
  return <>
    <FormField label="名前" htmlFor="name" required error={validation.visibleErrors.name}>
      <Input id="name" value={value} onChange={(event) => setValue(event.target.value)} onBlur={() => validation.touch("name")} />
    </FormField>
    <button onClick={() => validation.showAll()}>保存</button>
  </>;
}

describe("useFieldValidation", () => {
  it("shows errors after blur or submit and focuses the first invalid control", () => {
    render(<Fixture />);
    const input = screen.getByRole("textbox", { name: /名前/ });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(input).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("名前を入力してください");
    fireEvent.change(input, { target: { value: "新しい名前" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
