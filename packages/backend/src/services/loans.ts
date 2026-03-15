import type { Loan, Transaction } from "@sui/db";
import { addMonthsToYearMonth, getCurrentYearMonth, resolveDateFromYearMonth, toDateOnlyString } from "../lib/dates";

interface LoanTransactionSummary {
  totalPaid: number;
  paidMonths: Set<string>;
}

function parseLoanForecastEventId(forecastEventId: string | null) {
  if (!forecastEventId) {
    return null;
  }

  const match = /^loan:([^:]+):(\d{4}-\d{2})$/.exec(forecastEventId);
  if (!match) {
    return null;
  }

  return {
    loanId: match[1],
    yearMonth: match[2],
  };
}

function buildLoanTransactionSummaries(
  transactions: Array<Pick<Transaction, "forecastEventId" | "amount">>,
) {
  const summaries = new Map<string, LoanTransactionSummary>();

  for (const transaction of transactions) {
    const parsed = parseLoanForecastEventId(transaction.forecastEventId);
    if (!parsed) {
      continue;
    }

    const summary = summaries.get(parsed.loanId) ?? {
      totalPaid: 0,
      paidMonths: new Set<string>(),
    };

    summary.totalPaid += transaction.amount;
    summary.paidMonths.add(parsed.yearMonth);
    summaries.set(parsed.loanId, summary);
  }

  return summaries;
}

export function getLoanSnapshot(
  loan: Loan,
  transactions: Array<Pick<Transaction, "forecastEventId" | "amount">>,
) {
  const summary = buildLoanTransactionSummaries(transactions).get(loan.id);
  const remainingBalance = Math.max(loan.totalAmount - (summary?.totalPaid ?? 0), 0);
  const remainingPayments = Math.max(loan.paymentCount - (summary?.paidMonths.size ?? 0), 0);
  const nextPaymentAmount =
    remainingPayments > 0 ? Math.ceil(remainingBalance / remainingPayments) : 0;

  return {
    remainingBalance,
    remainingPayments,
    nextPaymentAmount,
  };
}

export function buildLoanForecastEvents(
  loan: Loan,
  transactions: Array<Pick<Transaction, "forecastEventId" | "amount">>,
  today: string,
  forecastMonths: number,
) {
  const summary = buildLoanTransactionSummaries(transactions).get(loan.id);
  let remainingBalance = Math.max(loan.totalAmount - (summary?.totalPaid ?? 0), 0);
  let remainingPayments = Math.max(loan.paymentCount - (summary?.paidMonths.size ?? 0), 0);
  const paidMonths = summary?.paidMonths ?? new Set<string>();
  const startDate = toDateOnlyString(loan.startDate);

  if (!startDate || remainingBalance <= 0 || remainingPayments <= 0) {
    return [];
  }

  const currentYearMonth = getCurrentYearMonth(today);
  const startYearMonth = startDate.slice(0, 7);
  const dayOfMonth = Number(startDate.slice(8, 10));
  const events: Array<{ id: string; date: string; amount: number; description: string }> = [];

  for (let offset = 0; offset < forecastMonths; offset += 1) {
    const yearMonth = addMonthsToYearMonth(currentYearMonth, offset);
    if (yearMonth < startYearMonth || paidMonths.has(yearMonth) || remainingPayments <= 0) {
      continue;
    }

    const date = resolveDateFromYearMonth(yearMonth, dayOfMonth);
    if (date < today || date < startDate) {
      continue;
    }

    const amount = Math.ceil(remainingBalance / remainingPayments);
    events.push({
      id: `loan:${loan.id}:${yearMonth}`,
      date,
      amount,
      description: `ローン: ${loan.name}`,
    });

    remainingBalance = Math.max(remainingBalance - amount, 0);
    remainingPayments -= 1;
  }

  return events;
}
