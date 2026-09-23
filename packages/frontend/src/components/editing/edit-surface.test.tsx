import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditModal, EditPanelLayout } from "./edit-surface";
import { ConfirmDialog } from "../ui/confirm-dialog";

afterEach(() => cleanup());

const editor = {
  subjectType: "口座", subjectName: "生活口座", mode: "edit" as const,
  status: "idle" as const, onSave: vi.fn(), children: <input aria-label="名前" />,
};

function ModalFixture() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>編集を開く</button>
    <EditModal {...editor} open={open} onRequestClose={() => setOpen(false)} />
  </>;
}

describe("editing surfaces", () => {
  it("stacks discard confirmation above an open edit modal", () => {
    render(<>
      <EditModal {...editor} open onRequestClose={vi.fn()} />
      <ConfirmDialog open onOpenChange={vi.fn()} title="変更を破棄しますか？" onConfirm={vi.fn()} />
    </>);
    const [edit, confirmation] = screen.getAllByRole("dialog", { hidden: true });
    expect(edit).toHaveClass("z-[70]");
    expect(confirmation).toHaveClass("z-[80]");
    expect(document.querySelectorAll(".dialog-overlay.z-\\[80\\]")).toHaveLength(1);
  });

  it("focuses the modal heading and restores focus to its opener", async () => {
    render(<ModalFixture />);
    const opener = screen.getByRole("button", { name: "編集を開く" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("heading", { name: "生活口座を編集" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("keeps keyboard focus inside the compact full-screen panel", async () => {
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 800 });
    vi.stubGlobal("ResizeObserver", class { observe(callbackTarget: Element) {
      void callbackTarget;
      queueMicrotask(() => this.callback([], this as unknown as ResizeObserver));
    } disconnect() {} constructor(private callback: ResizeObserverCallback) {} });
    try {
      render(<EditPanelLayout open onRequestClose={vi.fn()} editor={editor}>
        <button>背景の操作</button>
      </EditPanelLayout>);
      await waitFor(() => expect(screen.getByRole("button", { name: "背景の操作", hidden: true }).parentElement).toHaveAttribute("inert"));
      const heading = screen.getByRole("heading", { name: "生活口座を編集" });
      heading.focus();
      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      expect(screen.getByRole("button", { name: "変更を保存" })).toHaveFocus();
    } finally {
      vi.unstubAllGlobals();
      if (width) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
    }
  });
});
