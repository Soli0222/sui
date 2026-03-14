import type { Loan } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildLoanForecastEvents, getLoanSnapshot } from "./loans";

function createLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: "loan-1",
    name: "Car Loan",
    totalAmount: 1000,
    startDate: new Date("2026-01-15T00:00:00.000Z"),
    paymentCount: 3,
    accountId: "account-1",
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("getLoanSnapshot", () => {
  it("calculates remaining balance and payments from confirmed transactions", () => {
    const loan = createLoan();

    const snapshot = getLoanSnapshot(loan, [
      { forecastEventId: "loan:loan-1:2026-01", amount: 334 },
      { forecastEventId: "loan:loan-1:2026-02", amount: 333 },
      { forecastEventId: "loan:other-loan:2026-01", amount: 999 },
      { forecastEventId: null, amount: 100 },
    ]);

    expect(snapshot).toEqual({
      remainingBalance: 333,
      remainingPayments: 1,
      nextPaymentAmount: 333,
    });
  });
});

describe("buildLoanForecastEvents", () => {
  it("builds evenly distributed forecast events for unpaid months", () => {
    const loan = createLoan();

    expect(buildLoanForecastEvents(loan, [], "2026-01-01", 4)).toEqual([
      {
        id: "loan:loan-1:2026-01",
        date: "2026-01-15",
        amount: 334,
        description: "ローン: Car Loan",
      },
      {
        id: "loan:loan-1:2026-02",
        date: "2026-02-15",
        amount: 333,
        description: "ローン: Car Loan",
      },
      {
        id: "loan:loan-1:2026-03",
        date: "2026-03-15",
        amount: 333,
        description: "ローン: Car Loan",
      },
    ]);
  });

  it("skips already paid months", () => {
    const loan = createLoan();

    expect(
      buildLoanForecastEvents(
        loan,
        [{ forecastEventId: "loan:loan-1:2026-02", amount: 334 }],
        "2026-01-01",
        4,
      ),
    ).toEqual([
      {
        id: "loan:loan-1:2026-01",
        date: "2026-01-15",
        amount: 333,
        description: "ローン: Car Loan",
      },
      {
        id: "loan:loan-1:2026-03",
        date: "2026-03-15",
        amount: 333,
        description: "ローン: Car Loan",
      },
    ]);
  });

  it("starts from the configured future month", () => {
    const loan = createLoan({
      startDate: new Date("2026-03-15T00:00:00.000Z"),
      paymentCount: 2,
      totalAmount: 500,
    });

    expect(buildLoanForecastEvents(loan, [], "2026-01-01", 4)).toEqual([
      {
        id: "loan:loan-1:2026-03",
        date: "2026-03-15",
        amount: 250,
        description: "ローン: Car Loan",
      },
      {
        id: "loan:loan-1:2026-04",
        date: "2026-04-15",
        amount: 250,
        description: "ローン: Car Loan",
      },
    ]);
  });

  it("returns no events when the loan is fully paid", () => {
    const loan = createLoan();

    expect(
      buildLoanForecastEvents(
        loan,
        [
          { forecastEventId: "loan:loan-1:2026-01", amount: 334 },
          { forecastEventId: "loan:loan-1:2026-02", amount: 333 },
          { forecastEventId: "loan:loan-1:2026-03", amount: 333 },
        ],
        "2026-01-01",
        4,
      ),
    ).toEqual([]);
  });

  it("applies ceil rounding while keeping the final event balanced", () => {
    const loan = createLoan({
      totalAmount: 1001,
      paymentCount: 3,
    });

    expect(buildLoanForecastEvents(loan, [], "2026-01-01", 4).map((event) => event.amount)).toEqual([
      334,
      334,
      333,
    ]);
  });
});
