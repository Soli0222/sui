export type TransactionType = "income" | "expense" | "transfer";
export type RecurringItemType = "income" | "expense";

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
