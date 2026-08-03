import type { SupportedCurrencyCode } from "../constants/currency";

export type TransactionType = "income" | "expense" | "transfer" | "adjustment";
export type RecurringItemType = "income" | "expense" | "transfer";
export type DateShiftPolicy = "none" | "previous" | "next";
export type LoanPaymentMethod = "account_withdrawal" | "credit_card";
export type Recurrence = "monthly" | "weekly";
export type SplitMethod = "equal" | "ratio" | "amount";
export type SettlementKind = "transaction" | "offset";
export type SplitStatus = "none" | "unsettled" | "partial" | "settled";
export type SalaryRecordKind = "salary" | "bonus";

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

export interface SalaryRecord {
  id: string;
  paidOn: string;
  kind: SalaryRecordKind;
  name: string | null;
  grossAmount: number;
  healthInsurance: number;
  pensionInsurance: number;
  employmentInsurance: number;
  childcareSupportLevy: number;
  incomeTax: number;
  residentTax: number;
  yearEndTaxAdjustment: number;
  employeeStockContribution: number;
  employeeStockIncentive: number;
  dcMatchingContribution: number;
  otherDeductions: number;
  socialInsuranceTotal: number;
  deductionTotal: number;
  netAmount: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Donation {
  id: string;
  recipient: string;
  amount: number;
  memo: string | null;
  donatedOn: string;
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
  settlementLinked?: boolean;
  settlementAllocatedAmount?: number;
  settlementRemainingAmount?: number;
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

export interface Person {
  id: string;
  name: string;
  memo: string | null;
  sortOrder: number;
  outstandingAmount: Partial<Record<SupportedCurrencyCode, number>>;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionSplit {
  id: string;
  date: string;
  description: string;
  memo: string | null;
  amount: number;
  method: SplitMethod;
  ownRatio: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SplitShare {
  id: string;
  splitId: string;
  personId: string;
  ratio: number | null;
  amount: number;
}

export interface Settlement {
  id: string;
  kind: SettlementKind;
  personId: string;
  transactionId: string | null;
  date: string;
  note: string | null;
  createdAt: string;
}

export interface SettlementAllocation {
  id: string;
  settlementId: string;
  shareId: string;
  amount: number;
}
