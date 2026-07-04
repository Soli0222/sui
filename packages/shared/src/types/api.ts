import type {
  Account,
  BillingMonth,
  CreditCard,
  DateShiftPolicy,
  ForecastEvent,
  Loan,
  LoanPaymentMethod,
  RecurringItem,
  RecurringItemType,
  Subscription,
  Transaction,
  TransactionType,
} from "./domain";
import type { SupportedCurrencyCode } from "../constants/currency";

export interface DashboardResponse {
  totalBalance: number;
  minBalance: number;
  nextIncome: Pick<ForecastEvent, "id" | "date" | "description" | "amount" | "amountJpy" | "currencyCode"> | null;
  nextExpense: Pick<ForecastEvent, "id" | "date" | "description" | "amount" | "amountJpy" | "currencyCode"> | null;
  overdueForecast: ForecastEvent[];
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
  currencyCode: SupportedCurrencyCode;
  exchangeRateToJpy: number;
  sortOrder: number;
}

export type UpdateAccountPayload = CreateAccountPayload;

export interface ReconcileAccountPayload {
  actualBalance: number;
}

export interface ReconcileAccountAdjustment {
  id: string;
  accountId: string | null;
  transferToAccountId: string | null;
  forecastEventId: string | null;
  date: string;
  type: "adjustment";
  description: string;
  amount: number;
  deletedAt: string | null;
  createdAt: string;
}

export interface ReconcileAccountResponse {
  account: Account;
  adjustment: ReconcileAccountAdjustment | null;
  diff: number;
}

export interface CreateRecurringItemPayload {
  name: string;
  type: RecurringItemType;
  amount: number;
  dayOfMonth: number;
  startDate: string | null;
  endDate: string | null;
  dateShiftPolicy?: DateShiftPolicy;
  accountId: string;
  transferToAccountId?: string | null;
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

export interface CreditCardAssumptionSuggestionResponse {
  creditCardId: string;
  method: "median";
  months: number;
  sampleCount: number;
  sourceYearMonths: string[];
  suggestedAmount: number | null;
}

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
  balanceJpy: number;
  currencyCode: SupportedCurrencyCode;
  description: string;
}

export interface BalanceHistoryResponse {
  points: BalanceHistoryPoint[];
}

export type EditableTransactionType = Exclude<TransactionType, "adjustment">;

export interface CreateTransactionPayload {
  accountId?: string | null;
  transferToAccountId?: string | null;
  date: string;
  type: EditableTransactionType;
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
  currentBalanceJpy: number;
  currencyCode: SupportedCurrencyCode;
  exchangeRateToJpy: number;
  events: ForecastEvent[];
  minBalance: number;
  minBalanceJpy: number;
  minBalanceDate: string;
  warningLevel: "none" | "yellow" | "red";
}
