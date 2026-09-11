import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
      { id: "cancelled", status: "cancelled", state: "cancelled", transactionId: null, returnOf: null },
      { id: "purchased", status: "cancelled", state: "cancelled", transactionId: null, returnOf: null },
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
        issues: [], funding: [e],
      }])),
    });
    render(<MemoryRouter><SpendingBacklinks kind={kind} /></MemoryRouter>);
    await screen.findByText(/関連する支出決裁/);
    const expected = kind === "recurring" ? ["active", "return"]
      : kind === "transaction" ? ["used", "returned"] : entries.map((e) => e.id);
    expect(screen.getAllByRole("link", { hidden: true }).map((el) => el.textContent)).toEqual(expected);
  },
);
