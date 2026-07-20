import type { SupportedCurrencyCode } from "../constants/currency";

export type TransactionType = "income" | "expense" | "transfer" | "adjustment";
export type RecurringItemType = "income" | "expense" | "transfer";
export type DateShiftPolicy = "none" | "previous" | "next";
export type LoanPaymentMethod = "account_withdrawal" | "credit_card";
export type Recurrence = "monthly" | "weekly";

export interface Account {
  id: string;
  name: string;
  balance: number;
  balanceOffset: number;
  lastReconciledAt: string | null;
  currencyCode: SupportedCurrencyCode;
  exchangeRateToJpy: number;
  exchangeRateUpdatedAt: string;
  sortOrder: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringItem {
  id: string;
  name: string;
  type: RecurringItemType;
  amount: number;
  recurrence: Recurrence;
  interval: number;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  startDate: string | null;
  endDate: string | null;
  dateShiftPolicy: DateShiftPolicy;
  accountId: string | null;
  account: Account | null;
  transferToAccountId: string | null;
  transferToAccount: Account | null;
  enabled: boolean;
  sortOrder: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreditCard {
  id: string;
  name: string;
  settlementDay: number | null;
  accountId: string | null;
  account: Account | null;
  assumptionAmount: number;
  dateShiftPolicy: DateShiftPolicy;
  sortOrder: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Subscription {
  id: string;
  name: string;
  amount: number;
  currencyCode: SupportedCurrencyCode;
  exchangeRateToJpy: number;
  exchangeRateUpdatedAt: string;
  recurrence: Recurrence;
  interval: number;
  startDate: string;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  endDate: string | null;
  paymentSource: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Loan {
  id: string;
  name: string;
  totalAmount: number;
  startDate: string;
  paymentCount: number;
  dateShiftPolicy: DateShiftPolicy;
  paymentMethod: LoanPaymentMethod;
  accountId: string | null;
  account: Account | null;
  remainingBalance: number;
  remainingPayments: number;
  nextPaymentAmount: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillingItem {
  creditCardId: string;
  amount: number;
}

export interface BillingMonth {
  yearMonth: string;
  settlementDate: string | null;
  resolvedSettlementDate: string | null;
  items: BillingItem[];
  total: number;
  appliedTotal: number;
  safetyValveActive: boolean;
  sourceType: "actual" | "safety-valve" | "assumption";
  monthOffset: number;
}

export interface Transaction {
  id: string;
  accountId: string | null;
  transferToAccountId: string | null;
  forecastEventId: string | null;
  date: string;
  type: TransactionType;
  description: string;
  amount: number;
  amountJpy: number;
  createdAt: string;
  currencyCode: SupportedCurrencyCode;
  accountName?: string | null;
  transferToAccountCurrencyCode?: SupportedCurrencyCode | null;
  transferToAccountName?: string | null;
}

export type ForecastEventSource = "recurring" | "credit-card" | "loan" | "transfer";

export interface ForecastEvent {
  id: string;
  date: string;
  type: "income" | "expense" | "transfer";
  source: ForecastEventSource;
  isAssumption: boolean;
  description: string;
  amount: number;
  amountJpy: number;
  balance: number;
  balanceJpy: number;
  currencyCode: SupportedCurrencyCode;
  accountId: string | null;
  transferToAccountId?: string | null;
}
