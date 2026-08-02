import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import type { Person, Transaction } from "@sui/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../lib/api";
import {
  calculateTotalOutstanding,
  getTransactionSettlementRemaining,
  isSettlementCandidate,
  MembersTab,
} from "./splits";

vi.mock("../lib/api", () => ({ apiFetch: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function transactionStub(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-1",
    accountId: "acc-1",
    transferToAccountId: "acc-2",
    forecastEventId: null,
    date: "2026-07-26",
    type: "transfer",
    description: "旅行代の精算",
    amount: 10000,
    amountJpy: 10000,
    createdAt: "2026-07-26T00:00:00.000Z",
    currencyCode: "JPY",
    accountName: "From",
    transferToAccountCurrencyCode: "JPY",
    transferToAccountName: "To",
    settlementLinked: false,
    ...overrides,
  };
}

function personStub(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-1",
    name: "Taro",
    memo: null,
    sortOrder: 0,
    outstandingAmount: { JPY: 0 },
    deletedAt: null,
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
    ...overrides,
  };
}

describe("getTransactionSettlementRemaining", () => {
  it("prefers settlementRemainingAmount when present", () => {
    const tx = transactionStub({ settlementRemainingAmount: 6000 });
    expect(getTransactionSettlementRemaining(tx)).toBe(6000);
  });

  it("falls back to transaction amount when no remaining field is present", () => {
    const tx = transactionStub();
    expect(getTransactionSettlementRemaining(tx)).toBe(10000);
  });

  it("uses 0 when the remaining amount is 0", () => {
    const tx = transactionStub({ settlementRemainingAmount: 0 });
    expect(getTransactionSettlementRemaining(tx)).toBe(0);
  });
});

describe("isSettlementCandidate", () => {
  it("includes an unsettled JPY transfer", () => {
    expect(isSettlementCandidate(transactionStub())).toBe(true);
  });

  it("includes a partially settled JPY transfer", () => {
    expect(
      isSettlementCandidate(
        transactionStub({
          settlementLinked: true,
          settlementAllocatedAmount: 4000,
          settlementRemainingAmount: 6000,
        }),
      ),
    ).toBe(true);
  });

  it("excludes a fully settled JPY transfer", () => {
    expect(
      isSettlementCandidate(
        transactionStub({
          settlementLinked: true,
          settlementAllocatedAmount: 10000,
          settlementRemainingAmount: 0,
        }),
      ),
    ).toBe(false);
  });

  it("excludes non-transfer transactions", () => {
    expect(isSettlementCandidate(transactionStub({ type: "expense", accountId: "acc-1" }))).toBe(false);
  });

  it("excludes non-JPY transfers", () => {
    expect(
      isSettlementCandidate(transactionStub({ currencyCode: "USD", amountJpy: 15000 })),
    ).toBe(false);
  });
});

describe("calculateTotalOutstanding", () => {
  it("sums JPY outstanding amounts across members", () => {
    const people = [
      personStub({ id: "a", outstandingAmount: { JPY: 4000 } }),
      personStub({ id: "b", outstandingAmount: { JPY: 6000 } }),
      personStub({ id: "c", outstandingAmount: { JPY: 0 } }),
    ];
    expect(calculateTotalOutstanding(people)).toBe(10000);
  });

  it("treats a missing JPY value as 0", () => {
    const people = [
      personStub({ id: "a", outstandingAmount: { JPY: 5000 } }),
      personStub({ id: "b", outstandingAmount: {} }),
    ];
    expect(calculateTotalOutstanding(people)).toBe(5000);
  });

  it("returns 0 for an empty list", () => {
    expect(calculateTotalOutstanding([])).toBe(0);
  });
});

describe("MembersTab", () => {
  it("shows a loading summary and does not show 0 円 before data loads", () => {
    vi.mocked(apiFetch).mockImplementation(() => new Promise(() => {}));
    render(<MembersTab />);

    expect(screen.getByText("未回収合計")).toBeInTheDocument();
    expect(screen.getAllByText("読み込み中...").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("0 円")).not.toBeInTheDocument();
  });

  it("shows the total outstanding amount after loading", async () => {
    vi.mocked(apiFetch).mockResolvedValue([
      personStub({ id: "a", outstandingAmount: { JPY: 3000 } }),
      personStub({ id: "b", outstandingAmount: { JPY: 5000 } }),
    ]);
    render(<MembersTab />);

    await waitFor(() => expect(screen.queryByText("読み込み中...")).not.toBeInTheDocument());

    const summary = screen.getByTestId("members-total-outstanding");
    expect(within(summary).getByText("未回収合計")).toBeInTheDocument();
    expect(within(summary).getByText("8,000 円")).toBeInTheDocument();
  });

  it("hides the summary and shows the retry UI on error", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("network error"));
    render(<MembersTab />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    expect(screen.getByRole("alert")).toHaveTextContent("network error");
    expect(screen.queryByText("未回収合計")).not.toBeInTheDocument();
  });

  it("shows 0 円 when all members are settled", async () => {
    vi.mocked(apiFetch).mockResolvedValue([
      personStub({ id: "a", outstandingAmount: { JPY: 0 } }),
      personStub({ id: "b", outstandingAmount: { JPY: 0 } }),
    ]);
    render(<MembersTab />);

    await waitFor(() => expect(screen.queryByText("読み込み中...")).not.toBeInTheDocument());

    expect(screen.getByText("0 円")).toBeInTheDocument();
  });
});
