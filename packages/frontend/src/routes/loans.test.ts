import { describe, expect, it } from "vitest";
import type { Loan } from "@sui/shared";
import { isEndedLoan, partitionLoans } from "./loans";

function buildLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: "11111111-1111-4111-a111-111111111111",
    name: "Loan",
    totalAmount: 120000,
    startDate: "2026-01-05",
    paymentCount: 12,
    dateShiftPolicy: "none",
    paymentMethod: "account_withdrawal",
    accountId: null,
    account: null,
    remainingBalance: 120000,
    remainingPayments: 12,
    nextPaymentAmount: 10000,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isEndedLoan", () => {
  it("残り回数が 0 なら終了", () => {
    const loan = buildLoan({ remainingPayments: 0 });
    expect(isEndedLoan(loan)).toBe(true);
  });

  it("残り回数が 1 以上なら現役", () => {
    const loan = buildLoan({ remainingPayments: 1 });
    expect(isEndedLoan(loan)).toBe(false);
  });

  it("残り残高が 0 以下なら終了", () => {
    const loan = buildLoan({ remainingBalance: 0, remainingPayments: 3 });
    expect(isEndedLoan(loan)).toBe(true);
  });

  it("残り残高が 0 より大きければ現役", () => {
    const loan = buildLoan({ remainingBalance: 1, remainingPayments: 3 });
    expect(isEndedLoan(loan)).toBe(false);
  });
});

describe("partitionLoans", () => {
  it("現役と終了済みに分離する", () => {
    const active = buildLoan({ id: "active", remainingPayments: 3 });
    const ended = buildLoan({ id: "ended", remainingPayments: 0 });
    const { active: activeLoans, archived } = partitionLoans([active, ended]);
    expect(activeLoans).toHaveLength(1);
    expect(activeLoans[0].id).toBe("active");
    expect(archived).toHaveLength(1);
    expect(archived[0].id).toBe("ended");
  });
});
