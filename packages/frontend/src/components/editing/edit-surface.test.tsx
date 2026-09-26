import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditModal, EditModalLayout, EditShell } from "./edit-surface";
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
  it("omits both dismiss controls only when requested", () => {
    const onCancel = vi.fn();
    const { rerender } = render(<EditShell {...editor} onCancel={onCancel} showDismissControls={false} />);
    const region = screen.getByRole("region", { name: "生活口座を編集" });
    expect(region.querySelectorAll("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "閉じる" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "キャンセル" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "変更を保存" }).parentElement).toHaveClass("justify-end");

    rerender(<EditShell {...editor} onCancel={onCancel} />);
    expect(screen.getByRole("button", { name: "閉じる" })).toBeVisible();
    expect(screen.getByRole("button", { name: "キャンセル" })).toBeVisible();
    expect(screen.getByRole("button", { name: "変更を保存" }).parentElement).toHaveClass("justify-between");
  });

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
    const dialog = screen.getByRole("dialog", { name: "生活口座を編集" });
    expect(dialog.getAttribute("aria-labelledby")).toBe(screen.getByRole("heading", { name: "生活口座を編集" }).id);
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("opens a dialog without changing the list's DOM and restores focus", async () => {
    function Fixture() {
      const [open, setOpen] = useState(false);
      return <EditModalLayout open={open} onRequestClose={() => setOpen(false)} editor={editor}>
        <button onClick={() => setOpen(true)}>一覧から編集</button>
      </EditModalLayout>;
    }
    render(<Fixture />);
    const opener = screen.getByRole("button", { name: "一覧から編集" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "生活口座を編集" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "生活口座を編集" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "一覧から編集", hidden: true })).toBe(opener);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
