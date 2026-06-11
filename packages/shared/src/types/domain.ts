export type TransactionType = "income" | "expense" | "transfer";
export type RecurringItemType = "income" | "expense";
export type DateShiftPolicy = "none" | "previous" | "next";
export type LoanPaymentMethod = "account_withdrawal" | "credit_card";
export type PersonalDebtDirection = "lent" | "borrowed";
export type PersonalDebtOrigin = "cash_loan" | "reimbursement";
export type PersonalDebtStatus = "open" | "settled" | "canceled";
export type PersonalDebtSourceType = "manual" | "split_bill";
export type SplitBillPayerType = "self" | "other";
export type SplitBillMethod = "equal";
export type SplitBillStatus = "open" | "settled" | "canceled";

export interface Account {
  id: string;
  name: string;
  balance: number;
  balanceOffset: number;
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
  dayOfMonth: number;
  startDate: string | null;
  endDate: string | null;
  dateShiftPolicy: DateShiftPolicy;
  accountId: string | null;
  account: Account | null;
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
  intervalMonths: number;
  startDate: string;
  dayOfMonth: number;
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

export interface PersonalDebtSettlement {
  id: string;
  debtId: string;
  date: string;
  amount: number;
  accountId: string;
  transactionId: string;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalDebt {
  id: string;
  direction: PersonalDebtDirection;
  origin: PersonalDebtOrigin;
  counterpartyName: string;
  title: string;
  principalAmount: number;
  settledAmount: number;
  remainingAmount: number;
  openedDate: string;
  dueDate: string | null;
  accountId: string;
  account: Account | null;
  status: PersonalDebtStatus;
  sourceType: PersonalDebtSourceType;
  splitBillId: string | null;
  openingTransactionId: string | null;
  memo: string | null;
  settlements: PersonalDebtSettlement[];
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SplitBillParticipant {
  id: string;
  splitBillId: string;
  name: string;
  isSelf: boolean;
  sortOrder: number;
  shareAmount: number;
  personalDebtId: string | null;
  personalDebt: PersonalDebt | null;
}

export interface SplitBill {
  id: string;
  title: string;
  totalAmount: number;
  paidDate: string;
  payerType: SplitBillPayerType;
  payerName: string | null;
  accountId: string;
  account: Account | null;
  splitMethod: SplitBillMethod;
  dueDate: string | null;
  paymentTransactionId: string | null;
  status: SplitBillStatus;
  memo: string | null;
  selfShareAmount: number;
  outstandingAmount: number;
  participants: SplitBillParticipant[];
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
  accountId: string;
  transferToAccountId: string | null;
  forecastEventId: string | null;
  date: string;
  type: TransactionType;
  description: string;
  amount: number;
  createdAt: string;
  accountName?: string;
  transferToAccountName?: string | null;
}

export interface ForecastEvent {
  id: string;
  date: string;
  type: "income" | "expense";
  description: string;
  amount: number;
  balance: number;
  accountId: string | null;
}
