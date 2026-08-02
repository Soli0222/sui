import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Person, SplitListItem, Transaction } from "@sui/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../lib/api";
import {
  calculateTotalOutstanding,
  CreateSettlementDialog,
  formatTransferOptionLabel,
  getSplitStatusBadge,
  getTransactionSettlementRemaining,
  isSettlementCandidate,
  MembersTab,
  SettlementTransferDetailPanel,
  SplitsTab,
  truncateByGraphemes,
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

function splitStub(overrides: Partial<SplitListItem> = {}): SplitListItem {
  return {
    id: "split-1",
    date: "2026-07-26",
    description: "旅行代の精算と立替金の清算用",
    memo: null,
    amount: 10000,
    method: "equal",
    ownRatio: 0,
    ownShare: 3000,
    status: "unsettled",
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
    shares: [
      {
        id: "share-1",
        splitId: "split-1",
        personId: "person-1",
        personName: "Taro",
        splitDescription: "旅行代の精算と立替金の清算用",
        splitDate: "2026-07-26",
        ratio: null,
        amount: 4000,
        settledAmount: 0,
        remainingAmount: 4000,
        status: "unsettled",
      },
    ],
    ...overrides,
  } as SplitListItem;
}

const person: Person = {
  id: "person-1",
  name: "Taro",
  memo: null,
  sortOrder: 0,
  outstandingAmount: { JPY: 4000 },
  deletedAt: null,
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
};

describe("truncateByGraphemes", () => {
  it("returns the original text when it is within the limit", () => {
    expect(truncateByGraphemes("旅行代", 10)).toBe("旅行代");
    expect(truncateByGraphemes("short", 24)).toBe("short");
  });

  it("truncates long text and appends an ellipsis", () => {
    const long = "旅行代の精算と立替金の清算用".repeat(5);
    const result = truncateByGraphemes(long, 24);
    expect(result).toMatch(/…$/);
    expect(result.length).toBeLessThan(long.length);
  });

  it("counts a surrogate pair as one grapheme", () => {
    const text = "🎉".repeat(30);
    const result = truncateByGraphemes(text, 24);
    const visible = result.slice(0, result.indexOf("…"));
    expect(visible).toBe("🎉".repeat(24));
  });

  it("keeps Japanese, ASCII and emoji mixed text without raising", () => {
    const text = "abc日本語🎉123#".repeat(8);
    const result = truncateByGraphemes(text, 24);
    expect(result).toMatch(/…$/);
    expect(result.length).toBeLessThan(text.length);
  });
});

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

describe("getSplitStatusBadge", () => {
  it("renders the status label with whitespace-nowrap", () => {
    const { container } = render(getSplitStatusBadge("partial")!);
    const badge = container.querySelector("span");
    expect(badge).toHaveTextContent("一部精算");
    expect(badge).toHaveClass("whitespace-nowrap");
  });
});

describe("SplitsTab table", () => {
  it("sets an explicit min-width on active and archived tables and keeps nowrap on compact cells", async () => {
    vi.mocked(apiFetch).mockImplementation((url) => {
      if (typeof url === "string" && url.includes("/api/splits")) {
        return Promise.resolve([
          splitStub(),
          splitStub({ id: "split-2", status: "settled" }),
        ] as SplitListItem[]);
      }
      if (typeof url === "string" && url === "/api/people") {
        return Promise.resolve([person]);
      }
      return Promise.resolve([]);
    });

    render(<SplitsTab />);

    await waitFor(() => expect(screen.getByText("割り勘一覧")).toBeInTheDocument());
    fireEvent.click(screen.getByText("精算済み (1)"));
    await waitFor(() => expect(screen.getAllByRole("table")).toHaveLength(2));

    const [activeTable, archivedTable] = screen.getAllByRole("table");
    for (const table of [activeTable, archivedTable]) {
      expect(table).toHaveClass("min-w-[60rem]");
    }

    const activeStatus = within(activeTable).getByText("未精算").closest("td");
    expect(activeStatus).toHaveClass("whitespace-nowrap", "min-w-[5.5rem]");
    expect(activeStatus!.querySelector(".whitespace-nowrap")).toHaveTextContent("未精算");

    const archivedStatus = within(archivedTable).getByText("精算済").closest("td");
    expect(archivedStatus).toHaveClass("whitespace-nowrap", "min-w-[5.5rem]");

    const dateCell = within(activeTable).getByText("2026-07-26").closest("td");
    expect(dateCell).toHaveClass("whitespace-nowrap", "min-w-[6.5rem]");

    const amountCell = within(activeTable).getByText("10,000 円").closest("td");
    expect(amountCell).toHaveClass("whitespace-nowrap", "min-w-[6.5rem]");

    const descriptionCell = within(activeTable).getByText("旅行代の精算と立替金の清算用").closest("td");
    expect(descriptionCell).toHaveClass("break-words", "min-w-[10rem]", "max-w-[16rem]");

    const breakdownCell = within(activeTable)
      .getByRole("button", { name: /未回収/ })
      .closest("td");
    expect(breakdownCell).toHaveClass("min-w-[10rem]");
    expect(within(activeTable).getByRole("button", { name: /未回収/ })).toHaveClass("whitespace-nowrap");

    const actionsCell = within(activeTable).getByRole("button", { name: "編集" }).closest("td");
    expect(actionsCell).toHaveClass("whitespace-nowrap", "min-w-[4.5rem]");
  });
});

describe("formatTransferOptionLabel", () => {
  it("shows date, remaining amount and short description", () => {
    const tx = transactionStub({ settlementRemainingAmount: 6000 });
    const label = formatTransferOptionLabel(tx, 24);
    expect(label).toMatch(/^2026-07-26 \/ 残り 6,000円 \/ 旅行代の精算$/);
  });

  it("shows remaining equal to amount for an unsettled transfer", () => {
    const tx = transactionStub();
    const label = formatTransferOptionLabel(tx, 24);
    expect(label).toMatch(/2026-07-26 \/ 残り 10,000円/);
    expect(label).toMatch(/旅行代の精算$/);
  });

  it("shows partial remaining for a partially settled transfer", () => {
    const tx = transactionStub({
      settlementAllocatedAmount: 4000,
      settlementRemainingAmount: 6000,
    });
    const label = formatTransferOptionLabel(tx, 24);
    expect(label).toMatch(/2026-07-26 \/ 残り 6,000円/);
    expect(label).not.toMatch(/総額/);
  });

  it("truncates a long description and ends with an ellipsis", () => {
    const long = "旅行代の精算と立替金の清算用".repeat(5);
    const tx = transactionStub({ description: long });
    const label = formatTransferOptionLabel(tx, 24);
    expect(label).toMatch(/…$/);
    expect(label).not.toContain(long);
  });

  it("keeps a short description unchanged", () => {
    const tx = transactionStub({ description: "旅行" });
    const label = formatTransferOptionLabel(tx, 24);
    expect(label).toMatch(/旅行$/);
    expect(label).not.toMatch(/…$/);
  });
});

describe("SettlementTransferDetailPanel", () => {
  it("shows the full description, total, allocated, remaining and both account names", () => {
    const long = "旅行代の精算と立替金の清算用".repeat(6);
    const tx = transactionStub({
      description: long,
      amount: 10000,
      settlementAllocatedAmount: 4000,
      settlementRemainingAmount: 6000,
      accountName: "Wallet",
      transferToAccountName: "Bank",
    });
    render(<SettlementTransferDetailPanel transaction={tx} />);

    expect(screen.getByText(long)).toBeInTheDocument();
    expect(screen.getByText(/総額/)).toHaveTextContent("10,000");
    expect(screen.getByText(/精算済み/)).toHaveTextContent("4,000");
    expect(screen.getByText(/残額/)).toHaveTextContent("6,000");
    expect(screen.getByText("振替元:")).toHaveTextContent("Wallet");
    expect(screen.getByText("振替先:")).toHaveTextContent("Bank");
  });

  it("falls back to 未設定 when account names are missing", () => {
    const tx = transactionStub({
      accountName: undefined,
      transferToAccountName: undefined,
    });
    render(<SettlementTransferDetailPanel transaction={tx} />);

    expect(screen.getByText("振替元:")).toHaveTextContent("未設定");
    expect(screen.getByText("振替先:")).toHaveTextContent("未設定");
  });
});

describe("CreateSettlementDialog", () => {
  const person = personStub({ id: "person-1", name: "Taro" });
  const share = {
    id: "share-1",
    splitId: "split-1",
    personId: "person-1",
    personName: "Taro",
    splitDescription: "Lunch",
    splitDate: "2026-07-24",
    ratio: null,
    amount: 4000,
    settledAmount: 0,
    remainingAmount: 4000,
    status: "unsettled" as const,
  };
  const summary = {
    person,
    outstandingAmount: { JPY: 4000 },
    shares: [share],
    settlements: [],
  };
  const tx = transactionStub({
    id: "tx-1",
    description: "旅行代の精算",
    amount: 10000,
    settlementAllocatedAmount: 0,
    settlementRemainingAmount: 10000,
    accountName: "From",
    transferToAccountName: "To",
  });

  it("does not show a detail panel before selecting a transaction", () => {
    render(<CreateSettlementDialog open people={[person]} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByText("総額")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("振替取引")).not.toBeInTheDocument();
  });

  it("keeps working when no transfer candidates exist", async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [], page: 1, limit: 100, total: 0 });
    render(<CreateSettlementDialog open people={[person]} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("種別"), { target: { value: "transaction" } });
    await waitFor(() => expect(screen.getByLabelText("振替取引")).toHaveValue(""));

    expect(screen.queryByText("総額")).not.toBeInTheDocument();
  });

  it("shows full details after selecting a transfer", async () => {
    const long = "旅行代の精算と立替金の清算用".repeat(6);
    vi.mocked(apiFetch).mockImplementation((url) => {
      if (typeof url === "string" && url.includes("/api/people/")) {
        return Promise.resolve(summary);
      }
      if (typeof url === "string" && url.includes("/api/transactions")) {
        return Promise.resolve({
          items: [{ ...tx, description: long }],
          page: 1,
          limit: 100,
          total: 1,
        });
      }
      return Promise.resolve([]);
    });

    render(<CreateSettlementDialog open people={[person]} onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("メンバー"), { target: { value: person.id } });
    fireEvent.change(screen.getByLabelText("種別"), { target: { value: "transaction" } });

    await waitFor(() => expect(screen.getByLabelText("振替取引").querySelectorAll("option").length).toBeGreaterThan(1));

    fireEvent.change(screen.getByLabelText("振替取引"), { target: { value: tx.id } });

    await waitFor(() => expect(screen.getByText(long)).toBeInTheDocument());
    expect(screen.getByText(long)).toBeInTheDocument();
    const detail = screen.getByText(long).parentElement;
    expect(detail).toHaveTextContent(/総額 10,000 円/);
    expect(detail).toHaveTextContent(/精算済み 0 円/);
    expect(detail).toHaveTextContent(/残額 10,000 円/);
    expect(screen.getByText("振替元:")).toHaveTextContent("From");
    expect(screen.getByText("振替先:")).toHaveTextContent("To");

    const select = screen.getByLabelText("振替取引") as HTMLSelectElement;
    const selectedOption = select.options[select.selectedIndex];
    expect(selectedOption.textContent).toMatch(/2026-07-26/);
    expect(selectedOption.textContent).toMatch(/残り 10,000円/);
    expect(selectedOption.textContent).toMatch(/…$/);
  });
});
