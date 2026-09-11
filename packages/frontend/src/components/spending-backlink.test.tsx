import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SpendingBacklinks } from "./spending-backlink";
import { apiFetch } from "../lib/api";

vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it.each(["recurring", "transaction", "account"] as const)(
  "%s keeps relevant links after cancellation",
  async (kind) => {
    const entries = [
      { id: "active", status: "approved", state: "scheduled", transactionId: null, returnOf: null },
      { id: "expired", status: "expired", state: "cancelled", transactionId: null, returnOf: null },
      { id: "cancelled", status: "cancelled", state: "cancelled", transactionId: null, returnOf: null },
      { id: "purchased", status: "cancelled", state: "cancelled", transactionId: null, returnOf: null },
      { id: "difference", status: "cancelled", state: "attention", transactionId: "diff-tx", returnOf: null },
      { id: "used", status: "cancelled", state: "used", transactionId: "tx", returnOf: null },
      { id: "return", status: "cancelled", state: "scheduled", transactionId: null, returnOf: "original" },
      { id: "returned", status: "cancelled", state: "used", transactionId: "return-tx", returnOf: "original" },
    ];
    vi.mocked(apiFetch).mockResolvedValue({
      ledger: { requests: entries.map((e) => ({
        id: e.id, status: e.status, deletedAt: null, input: { name: e.id },
        fundingLinks: [{ id: e.id, returnOf: e.returnOf }],
      })) },
      requestStates: Object.fromEntries(entries.map((e) => [e.id, {
        status: e.id === "purchased" ? "completed" : e.status,
        issues: [], fundingActionRequired: ["scheduled", "attention"].includes(e.state), pendingFundingActionRequired: e.state === "scheduled", funding: [{ ...e, pending: e.state === "scheduled", scheduleAvailable: e.state !== "cancelled" }],
      }])),
    });
    render(<MemoryRouter><SpendingBacklinks kind={kind} /></MemoryRouter>);
    await screen.findByText(/関連する支出決裁/);
    const expected = kind === "recurring" ? ["active", "return"]
      : kind === "transaction" ? ["difference", "used", "returned"] : ["active", "difference", "return"];
    expect(screen.getAllByRole("link", { hidden: true }).map((el) => el.textContent)).toEqual(expected);
  },
);


it("refreshes after parent mutations and clears stale links", async () => {
  const request = { id: "r", deletedAt: null, input: { name: "架空の申請" } };
  vi.mocked(apiFetch).mockResolvedValueOnce({ ledger: { requests: [request] }, requestStates: {
    r: { issues: [], fundingActionRequired: true, funding: [{ pending: true }] },
  } }).mockResolvedValueOnce({ ledger: { requests: [] }, requestStates: {} });
  const view = render(<MemoryRouter><SpendingBacklinks kind="account" reloadKey={0} /></MemoryRouter>);
  await screen.findByText(/関連する支出決裁 \(1件\)/);
  view.rerender(<MemoryRouter><SpendingBacklinks kind="account" reloadKey={1} /></MemoryRouter>);
  await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText(/関連する支出決裁/)).toBeNull());
});

it("shows a retryable error instead of treating failure as no related approvals", async () => {
  vi.mocked(apiFetch).mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ ledger: { requests: [] }, requestStates: {} });
  render(<MemoryRouter><SpendingBacklinks kind="account" /></MemoryRouter>);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "再試行" }));
  await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
