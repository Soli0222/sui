import type {
  Account,
  BillingMonth,
  CreditCard,
  DateShiftPolicy,
  ForecastEvent,
  Loan,
  LoanPaymentMethod,
  RecurringItem,
  Subscription,
  Transaction,
  TransactionType,
} from "./domain";

export interface DashboardResponse {
  totalBalance: number;
  minBalance: number;
  nextIncome: Pick<ForecastEvent, "id" | "date" | "description" | "amount"> | null;
  nextExpense: Pick<ForecastEvent, "id" | "date" | "description" | "amount"> | null;
  forecast: ForecastEvent[];
  accountForecasts: AccountForecast[];
}

export interface DashboardEventsResponse {
  forecast: ForecastEvent[];
  accountForecasts: Pick<AccountForecast, "accountId" | "accountName" | "events">[];
}

export interface ConfirmForecastPayload {
  forecastEventId: string;
  amount: number;
  accountId?: string;
}

export interface CreateAccountPayload {
  name: string;
  balance: number;
  balanceOffset: number;
  sortOrder: number;
}

export type UpdateAccountPayload = CreateAccountPayload;

export interface CreateRecurringItemPayload {
  name: string;
  type: "income" | "expense";
  amount: number;
  dayOfMonth: number;
  startDate: string | null;
  endDate: string | null;
  dateShiftPolicy?: DateShiftPolicy;
  accountId: string;
  enabled: boolean;
  sortOrder: number;
}

export type UpdateRecurringItemPayload = CreateRecurringItemPayload;

export interface CreateCreditCardPayload {
  name: string;
  settlementDay?: number | null;
  dateShiftPolicy?: DateShiftPolicy;
  accountId: string;
  assumptionAmount: number;
  sortOrder: number;
}

export type UpdateCreditCardPayload = CreateCreditCardPayload;

export interface CreateSubscriptionPayload {
  name: string;
  amount: number;
  intervalMonths: number;
  startDate: string;
  dayOfMonth: number;
  endDate?: string | null;
  paymentSource?: string | null;
}

export type UpdateSubscriptionPayload = CreateSubscriptionPayload;

export interface BillingUpdatePayload {
  settlementDate?: string;
  items: {
    creditCardId: string;
    amount: number;
  }[];
}

export interface CreateLoanPayload {
  name: string;
  totalAmount: number;
  startDate: string;
  paymentCount: number;
  dateShiftPolicy?: DateShiftPolicy;
  paymentMethod?: LoanPaymentMethod;
  accountId: string | null;
}

export type UpdateLoanPayload = CreateLoanPayload;

export interface TransactionsResponse {
  items: Transaction[];
  page: number;
  limit: number;
  total: number;
}

export interface BalanceHistoryPoint {
  date: string;
  balance: number;
  description: string;
}

export interface BalanceHistoryResponse {
  points: BalanceHistoryPoint[];
}

export interface CreateTransactionPayload {
  accountId: string;
  transferToAccountId?: string;
  date: string;
  type: TransactionType;
  description: string;
  amount: number;
}

export type UpdateTransactionPayload = CreateTransactionPayload;

export type AccountsResponse = Array<Account>;
export type RecurringItemsResponse = Array<RecurringItem>;
export type CreditCardsResponse = Array<CreditCard>;
export type SubscriptionsResponse = Array<Subscription>;
export type LoansResponse = Array<Loan>;
export type BillingResponse = BillingMonth;

export interface AccountForecast {
  accountId: string;
  accountName: string;
  currentBalance: number;
  events: ForecastEvent[];
  minBalance: number;
  minBalanceDate: string;
  warningLevel: "none" | "yellow" | "red";
}
