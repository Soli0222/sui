import { describe, expect, it } from "vitest";
import type { Transaction } from "@sui/shared";
import { getTransactionSettlementRemaining, isSettlementCandidate } from "./splits";

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
