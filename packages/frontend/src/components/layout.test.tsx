import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AppLayout } from "./layout";

vi.mock("../lib/api", () => ({ apiFetch: () => Promise.resolve({ overdueForecast: [] }) }));

describe("AppLayout navigation", () => {
  it("omits audit history from desktop and mobile navigation", () => {
    render(<MemoryRouter><AppLayout><div>page</div></AppLayout></MemoryRouter>);
    const desktop = screen.getByRole("complementary");
    expect(within(desktop).queryByRole("link", { name: "監査ログ" })).toBeNull();
    const mobile = screen.getByRole("navigation", { name: "モバイルナビゲーション" });
    fireEvent.click(within(mobile).getByRole("button", { name: "その他" }));
    expect(within(mobile).queryByRole("link", { name: "監査ログ" })).toBeNull();
    expect(within(mobile).getByRole("link", { name: "データ管理" })).toBeInTheDocument();
  });
});
