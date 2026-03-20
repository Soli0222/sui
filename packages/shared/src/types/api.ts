import type {
  Account,
  BillingMonth,
  CreditCard,
  ForecastEvent,
  Loan,
  RecurringItem,
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
  accountId: string;
  enabled: boolean;
  sortOrder: number;
}

export type UpdateRecurringItemPayload = CreateRecurringItemPayload;

export interface CreateCreditCardPayload {
  name: string;
  settlementDay?: number | null;
  accountId: string;
  assumptionAmount: number;
  sortOrder: number;
}

export type UpdateCreditCardPayload = CreateCreditCardPayload;

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
  accountId: string;
}

export type UpdateLoanPayload = CreateLoanPayload;

export interface TransactionsResponse {
  items: Transaction[];
  page: number;
  limit: number;
  total: number;
}

export interface CreateTransactionPayload {
  accountId: string;
  transferToAccountId?: string;
  date: string;
  type: TransactionType;
  description: string;
  amount: number;
}

export type AccountsResponse = Array<Account>;
export type RecurringItemsResponse = Array<RecurringItem>;
export type CreditCardsResponse = Array<CreditCard>;
export type LoansResponse = Array<Loan>;
export type BillingResponse = BillingMonth;

export interface AccountForecast {
  accountId: string;
  accountName: string;
  currentBalance: number;
  events: ForecastEvent[];
  minBalance: number;
  minBalanceDate: string;
  willBeNegative: boolean;
}
