import type {
  Account,
  BillingMonth,
  CreditCard,
  DateShiftPolicy,
  ForecastEvent,
  Loan,
  LoanPaymentMethod,
  PersonalDebt,
  PersonalDebtDirection,
  PersonalDebtOrigin,
  PersonalDebtStatus,
  RecurringItem,
  SplitBill,
  SplitBillMethod,
  SplitBillPayerType,
  Subscription,
  Transaction,
  TransactionType,
} from "./domain";

export interface DashboardResponse {
  totalBalance: number;
  minBalance: number;
  nextIncome: Pick<ForecastEvent, "id" | "date" | "description" | "amount"> | null;
  nextExpense: Pick<ForecastEvent, "id" | "date" | "description" | "amount"> | null;
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

export interface CreatePersonalDebtPayload {
  direction: PersonalDebtDirection;
  origin?: PersonalDebtOrigin;
  counterpartyName: string;
  title: string;
  principalAmount: number;
  openedDate: string;
  dueDate?: string | null;
  accountId: string;
  memo?: string | null;
}

export interface UpdatePersonalDebtPayload extends CreatePersonalDebtPayload {
  status?: PersonalDebtStatus;
}

export interface CreatePersonalDebtSettlementPayload {
  date: string;
  amount: number;
  accountId?: string;
  memo?: string | null;
}

export type UpdatePersonalDebtSettlementPayload = CreatePersonalDebtSettlementPayload;

export interface SplitBillParticipantPayload {
  name: string;
  isSelf?: boolean;
  sortOrder?: number;
}

export interface CreateSplitBillPayload {
  title: string;
  totalAmount: number;
  paidDate: string;
  payerType: SplitBillPayerType;
  payerName?: string | null;
  accountId: string;
  splitMethod?: SplitBillMethod;
  dueDate?: string | null;
  memo?: string | null;
  participants: SplitBillParticipantPayload[];
}

export interface UpdateSplitBillPayload extends CreateSplitBillPayload {
  status?: "open" | "settled" | "canceled";
}

export interface SplitBillPreviewPayload {
  totalAmount: number;
  splitMethod?: SplitBillMethod;
  participants: SplitBillParticipantPayload[];
}

export interface SplitBillPreviewResponse {
  participants: Array<{
    name: string;
    isSelf: boolean;
    sortOrder: number;
    shareAmount: number;
  }>;
}

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
export type PersonalDebtsResponse = Array<PersonalDebt>;
export type SplitBillsResponse = Array<SplitBill>;
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
