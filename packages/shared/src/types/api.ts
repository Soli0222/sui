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

export interface ConfirmForecastPayload {
  forecastEventId: string;
  amount: number;
  accountId?: string;
}

export interface CreateAccountPayload {
  name: string;
  balance: number;
  sortOrder: number;
}

export interface UpdateAccountPayload extends CreateAccountPayload {}

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

export interface UpdateRecurringItemPayload extends CreateRecurringItemPayload {}

export interface CreateCreditCardPayload {
  name: string;
  settlementDay?: number | null;
  accountId: string;
  assumptionAmount: number;
  sortOrder: number;
}

export interface UpdateCreditCardPayload extends CreateCreditCardPayload {}

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

export interface UpdateLoanPayload extends CreateLoanPayload {}

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

export interface AccountsResponse extends Array<Account> {}
export interface RecurringItemsResponse extends Array<RecurringItem> {}
export interface CreditCardsResponse extends Array<CreditCard> {}
export interface LoansResponse extends Array<Loan> {}
export interface BillingResponse extends BillingMonth {}

export interface AccountForecast {
  accountId: string;
  accountName: string;
  currentBalance: number;
  events: ForecastEvent[];
  minBalance: number;
  minBalanceDate: string;
  willBeNegative: boolean;
}
