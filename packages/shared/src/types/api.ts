import type {
  Account,
  BillingMonth,
  CreditCard,
  DateShiftPolicy,
  ForecastEventSource,
  ForecastEvent,
  Loan,
  LoanPaymentMethod,
  Recurrence,
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

export interface DashboardExplainEvent {
  id: string;
  date: string;
  description: string;
  type: ForecastEvent["type"];
  source: ForecastEventSource;
  isAssumption: boolean;
  amountJpy: number;
  runningBalance: number;
}

export interface DashboardExplainSourceTotals {
  recurringIncomeJpy: number;
  recurringExpenseJpy: number;
  creditCardJpy: number;
  loanJpy: number;
  transferJpy: number;
}

export interface DashboardExplainResponse {
  date: string;
  accountId: string | null;
  startBalance: number;
  events: DashboardExplainEvent[];
  sourceTotals: DashboardExplainSourceTotals;
  finalBalance: number;
  assumptionEventCount: number;
}

export interface DashboardSimulationPayload {
  months?: number;
  applyOffset?: boolean;
  exclude?: {
    recurringItemIds?: string[];
    loanIds?: string[];
    creditCardIds?: string[];
  };
  cardAssumptionOverrides?: Array<{
    creditCardId: string;
    assumptionAmount: number;
  }>;
}

export interface DashboardSimulationSummary {
  minBalance: number;
  minBalanceDate: string | null;
  finalBalance: number;
  warningAccountCount: number;
}

export interface DashboardSimulationResponse {
  baseline: DashboardSimulationSummary;
  simulated: DashboardSimulationSummary;
  delta: {
    minBalance: number;
    finalBalance: number;
    warningAccountCount: number;
  };
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
  recurrence?: Recurrence;
  dayOfMonth?: number | null;
  dayOfWeek?: number | null;
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
  method: "average";
  months: number;
  sampleCount: number;
  sourceYearMonths: string[];
  suggestedAmount: number | null;
}

export interface CreateSubscriptionPayload {
  name: string;
  amount: number;
  recurrence?: Recurrence;
  intervalMonths?: number | null;
  startDate: string;
  dayOfMonth?: number | null;
  dayOfWeek?: number | null;
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

export interface AuditLogEntry {
  id: string;
  createdAt: string;
  method: string;
  path: string;
  status: number;
  clientSource: "mcp" | "web" | "unknown";
  requestId: string | null;
}

export interface AuditLogsResponse {
  items: AuditLogEntry[];
  page: number;
  limit: number;
  total: number;
}

export interface DataExportAccount {
  id: string;
  name: string;
  balance: number;
  balanceOffset: number;
  lastReconciledAt: string | null;
  currencyCode: string;
  exchangeRateToJpy: number;
  exchangeRateUpdatedAt: string;
  sortOrder: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DataExportRecurringItem {
  id: string;
  name: string;
  type: RecurringItemType;
  amount: number;
  recurrence: Recurrence;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  accountId: string | null;
  transferToAccountId: string | null;
  enabled: boolean;
  startDate: string | null;
  endDate: string | null;
  dateShiftPolicy: DateShiftPolicy;
  sortOrder: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DataExportCreditCard {
  id: string;
  name: string;
  settlementDay: number | null;
  accountId: string | null;
  assumptionAmount: number;
  dateShiftPolicy: DateShiftPolicy;
  sortOrder: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DataExportCreditCardItem {
  id: string;
  billingId: string;
  creditCardId: string;
  amount: number;
  updatedAt: string;
}

export interface DataExportCreditCardBilling {
  id: string;
  yearMonth: string;
  settlementDate: string | null;
  createdAt: string;
  updatedAt: string;
  items: DataExportCreditCardItem[];
}

export interface DataExportSubscription {
  id: string;
  name: string;
  amount: number;
  recurrence: Recurrence;
  intervalMonths: number | null;
  startDate: string;
  dayOfMonth: number | null;
  dayOfWeek: number | null;
  endDate: string | null;
  paymentSource: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DataExportLoan {
  id: string;
  name: string;
  totalAmount: number;
  startDate: string;
  paymentCount: number;
  dateShiftPolicy: DateShiftPolicy;
  paymentMethod: LoanPaymentMethod;
  accountId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DataExportTransaction {
  id: string;
  accountId: string | null;
  transferToAccountId: string | null;
  forecastEventId: string | null;
  date: string;
  type: TransactionType;
  description: string;
  amount: number;
  deletedAt: string | null;
  createdAt: string;
}

export interface DataExportSetting {
  key: string;
  value: string;
  updatedAt: string;
}

export interface DataExportPayloadData {
  accounts: DataExportAccount[];
  recurringItems: DataExportRecurringItem[];
  creditCards: DataExportCreditCard[];
  creditCardBillings: DataExportCreditCardBilling[];
  subscriptions: DataExportSubscription[];
  loans: DataExportLoan[];
  transactions: DataExportTransaction[];
  settings: DataExportSetting[];
}

export interface DataExportResponse {
  formatVersion: 1;
  exportedAt: string;
  data: DataExportPayloadData;
}

export interface DataImportPayload {
  formatVersion: 1;
  mode: "replace";
  data: DataExportPayloadData;
}

export interface DataImportCounts {
  accounts: number;
  recurringItems: number;
  creditCards: number;
  creditCardBillings: number;
  creditCardItems: number;
  subscriptions: number;
  loans: number;
  transactions: number;
  settings: number;
}

export interface DataImportResponse {
  counts: DataImportCounts;
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
