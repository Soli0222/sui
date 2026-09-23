import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, RouterProvider, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditingNavigationProvider } from "../components/editing/editing-navigation";
import { useEditSession } from "./use-edit-session";

afterEach(() => cleanup());

function Editor({ mutate = async () => {}, reload, identity = "account:1:edit", onSaved }: {
  mutate?: (draft: { name: string }) => Promise<unknown>;
  reload?: () => Promise<{ name: string }>;
  identity?: string;
  onSaved?: () => void;
}) {
  const navigate = useNavigate();
  const session = useEditSession({ identity, initial: { name: identity === "account:1:edit" ? "元" : "別対象" } });
  return <>
    <input aria-label="名前" value={session.draft.name} onChange={(event) => session.setDraft({ name: event.target.value })} />
    <span data-testid="state">{session.status}</span>
    <span data-testid="error">{session.error}</span>
    <button onClick={() => session.requestClose(() => navigate("/closed"))}>閉じる</button>
    <button onClick={() => navigate("/closed")}>別ページ</button>
    <button onClick={() => void session.save(mutate, reload).then((saved) => { if (saved && onSaved) onSaved(); })}>保存</button>
    <button onClick={() => void session.retryRefresh()}>再取得</button>
  </>;
}

function mount(props?: Parameters<typeof Editor>[0]) {
  const router = createMemoryRouter([
    { path: "/", element: <EditingNavigationProvider><Editor {...props} /></EditingNavigationProvider> },
    { path: "/closed", element: <p>移動済み</p> },
  ]);
  render(<RouterProvider router={router} />);
  return router;
}

describe("useEditSession", () => {
  it("keeps draft when discard is canceled, and skips confirmation after undo", async () => {
    mount();
    fireEvent.change(screen.getByRole("textbox", { name: "名前" }), { target: { value: "変更" } });
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(screen.getByText("未保存の変更を破棄しますか？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "編集を続ける" }));
    expect(screen.getByRole("textbox", { name: "名前", hidden: true })).toHaveValue("変更");
    fireEvent.change(screen.getByRole("textbox", { name: "名前" }), { target: { value: "元" } });
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    await waitFor(() => expect(screen.getByText("移動済み")).toBeInTheDocument());
  });

  it("blocks browser-router navigation and discards only on confirmation", async () => {
    mount();
    fireEvent.change(screen.getByRole("textbox", { name: "名前" }), { target: { value: "変更" } });
    fireEvent.click(screen.getByRole("button", { name: "別ページ" }));
    expect(screen.getByRole("textbox", { name: "名前", hidden: true })).toHaveValue("変更");
    fireEvent.click(screen.getByRole("button", { name: "変更を破棄" }));
    await waitFor(() => expect(screen.getByText("移動済み")).toBeInTheDocument());
  });

  it("prevents duplicate mutation, preserves draft on mutation error, and retries only refresh", async () => {
    let resolveMutation!: () => void;
    const mutate = vi.fn(() => new Promise<void>((resolve) => { resolveMutation = resolve; }));
    const reload = vi.fn().mockRejectedValueOnce(new Error("取得失敗")).mockResolvedValueOnce({ name: "保存後" });
    mount({ mutate, reload });
    fireEvent.change(screen.getByRole("textbox", { name: "名前" }), { target: { value: "変更" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    resolveMutation();
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("refresh-error"));
    expect(screen.getByRole("textbox", { name: "名前" })).toHaveValue("変更");
    fireEvent.change(screen.getByRole("textbox", { name: "名前" }), { target: { value: "再送禁止" } });
    expect(screen.getByRole("textbox", { name: "名前" })).toHaveValue("変更");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "再取得" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "名前" })).toHaveValue("保存後"));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("keeps the draft editable after a rejected mutation", async () => {
    const mutate = vi.fn().mockRejectedValue(new Error("保存失敗"));
    mount({ mutate });
    fireEvent.change(screen.getByRole("textbox", { name: "名前" }), { target: { value: "変更" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("保存失敗"));
    expect(screen.getByRole("textbox", { name: "名前" })).toHaveValue("変更");
    fireEvent.change(screen.getByRole("textbox", { name: "名前" }), { target: { value: "修正" } });
    expect(screen.getByRole("textbox", { name: "名前" })).toHaveValue("修正");
  });

  it("does not let an old mutation completion replace another target", async () => {
    let resolveMutation!: () => void;
    const mutate = vi.fn(() => new Promise<void>((resolve) => { resolveMutation = resolve; }));
    function SwitchingEditor() {
      const [identity, setIdentity] = useState("account:1:edit");
      return <EditingNavigationProvider>
        <button onClick={() => setIdentity("account:2:edit")}>対象を変更</button>
        <Editor identity={identity} mutate={mutate} />
      </EditingNavigationProvider>;
    }
    const router = createMemoryRouter([{ path: "/", element: <SwitchingEditor /> }]);
    render(<RouterProvider router={router} />);
    fireEvent.change(screen.getByRole("textbox", { name: "名前" }), { target: { value: "編集中" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    fireEvent.click(screen.getByRole("button", { name: "対象を変更" }));
    expect(screen.getByRole("textbox", { name: "名前" })).toHaveValue("別対象");
    resolveMutation();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "名前" })).toHaveValue("別対象"));
  });

  it("permits immediate navigation after a successful save", async () => {
    const mutate = vi.fn().mockResolvedValue(undefined);
    function SuccessEditor() {
      const navigate = useNavigate();
      return <EditingNavigationProvider><Editor mutate={mutate} onSaved={() => navigate("/closed")} /></EditingNavigationProvider>;
    }
    const router = createMemoryRouter([
      { path: "/", element: <SuccessEditor /> },
      { path: "/closed", element: <p>移動済み</p> },
    ]);
    render(<RouterProvider router={router} />);
    fireEvent.change(screen.getByRole("textbox", { name: "名前" }), { target: { value: "保存" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByText("移動済み")).toBeInTheDocument());
    expect(screen.queryByText("未保存の変更を破棄しますか？")).not.toBeInTheDocument();
  });
});
