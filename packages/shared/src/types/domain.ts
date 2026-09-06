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
  supplementalBudgetEnabled?: boolean;
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

export type ForecastEventSource =
  "recurring" | "credit-card" | "loan" | "transfer";

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

/** Independent spending ledger. All monetary values are integer minor units. */
export type SpendingStatus =
  | "draft"
  | "reviewing"
  | "conditional"
  | "held"
  | "denied"
  | "approved"
  | "purchased"
  | "completed"
  | "cancelled"
  | "expired";
export type SpendingDecision = "approvable" | "conditional" | "held" | "denied";
export interface SpendingSettings {
  threshold: number | null;
  freshnessDays: number | null;
  approvalDays: number | null;
  fundingDays: number | null;
  ai: {
    endpoint: string;
    model: string;
    credentialEnv: string;
    provider?: "openai" | "anthropic" | "custom";
    credentialMode?: "environment" | "stored";
    modelsEndpoint?: string;
    protocol: "chat-completions" | "anthropic";
  } | null;
}
export interface SpendingItem {
  id: string;
  name: string;
  amount: number;
  category: string;
  month: string;
  forecastId: string | null;
  forecastAmount: number;
}
export interface SpendingInput {
  name: string;
  reason: string;
  purchaseDate: string;
  payment: string;
  kind: "normal" | "supplemental";
  currency: string;
  rateToJpy: number | null;
  rateAt: string | null;
  urgency: string;
  replacement: string;
  alternatives: string;
  relatedIds: string[];
  items: SpendingItem[];
  funding: {
    sourceId: string;
    destinationId: string;
    date: string;
    amount: number;
  } | null;
}
export interface SpendingPurchase {
  id: string;
  itemId: string;
  date: string;
  amount: number;
  reason: string;
  /** Amount already represented in imported A, retained across unlink. */
  reflected: { detailId: string; amount: number }[];
}
export interface SpendingRequest {
  id: string;
  version: number;
  input: SpendingInput;
  status: SpendingStatus;
  approvedAmount: number;
  expiresAt: string | null;
  purchases: SpendingPurchase[];
  closedRemainder: boolean;
  deletedAt: string | null;
  createdAt: string;
  fundingLinks: {
    id: string;
    recurringId: string;
    eventId: string;
    expected: NonNullable<SpendingInput["funding"]>;
    returnOf: string | null;
  }[];
  history: {
    at: string;
    action: string;
    reason: string;
    input?: SpendingInput;
  }[];
}
export interface SpendingDetail {
  id: string;
  sourceId: string | null;
  raw: Record<string, string>;
  date: string;
  description: string;
  amount: number;
  categorySource: string;
  paymentSource: string;
  included: boolean;
  transfer: boolean;
  version: number;
  deletedAt: string | null;
  oneOff: boolean;
  classificationReason: string;
  fixedId: string | null;
  refundOf: string | null;
}
export interface SpendingAllocation {
  id: string;
  requestId: string;
  purchaseId: string;
  detailId: string;
  amount: number;
  active: boolean;
  at: string;
  detailVersion: number;
}
export interface SpendingBudget {
  id: string;
  month: string;
  category: string;
  amount: number;
  at: string;
  reason: string;
}
export interface SpendingBudgetProposal {
  id: string;
  name: string;
  from: string;
  to: string | null;
  categories: { category: string; amount: number }[];
  at: string;
  reason: string;
  supersededAt: string | null;
}
export interface SpendingPlan {
  id: string;
  month: string;
  category: string;
  name: string;
  amount: number;
  date: string;
  type: "fixed" | "variable";
  reason: string;
}
export interface SpendingImport {
  id: string;
  hash: string;
  filename: string;
  at: string;
  from: string;
  to: string;
  confirmedCoverage: boolean;
  month?: string;
  encoding?: "utf-8" | "shift_jis";
  removedIds?: string[];
  ledgerVersion?: number;
  supersededAt?: string;
  committed: boolean;
  rows: {
    line: number;
    detail: SpendingDetail | null;
    error: string | null;
    candidates: string[];
    existingId: string | null;
  }[];
  resolutions: Record<string, string>;
  errors: string[];
}
export interface SpendingCalculation {
  month: string;
  category: string;
  budget: number | null;
  A: number;
  R: number;
  F: number;
  Q: number;
  before: number;
  after: number;
  remaining: number | null;
  allSpending: number;
  supplemental: number;
  history: {
    month: string;
    total: number;
    variable: number;
    covered: boolean;
  }[];
  median: number;
  average: number;
  maximum: number;
  currentPace: number;
  coveredDays: number;
  forecastAvailable: { id: string; amount: number }[];
  missing: string[];
}
export interface SpendingReview {
  id: string;
  requestId: string;
  requestVersion: number;
  ledgerVersion: number;
  at: string;
  snapshot: {
    input: SpendingInput;
    settings: SpendingSettings;
    calculations: SpendingCalculation[];
    detailIds: string[];
    funding: SpendingFunding | null;
    fingerprint: string;
    context: unknown;
  };
  model: string | null;
  decision: SpendingDecision;
  reasons: string[];
  options: string[];
  missing: string[];
  overrideReason: string | null;
}
export interface SpendingFunding {
  accountId: string;
  balance: number;
  balanceOffset: number;
  held: number;
  available: number;
  through: string;
  events: { id: string; amount: number; date: string }[];
  issues: string[];
}
export interface SpendingLedger {
  schemaVersion: 1;
  budgetProposals?: SpendingBudgetProposal[];
  mfNative?: boolean;
  ruleDefaultsApplied?: boolean;
  paymentLinks?: Record<string, { kind: "account" | "card"; id: string }>;
  settings: SpendingSettings;
  requests: SpendingRequest[];
  details: SpendingDetail[];
  allocations: SpendingAllocation[];
  budgets: SpendingBudget[];
  plans: SpendingPlan[];
  imports: SpendingImport[];
  reviews: SpendingReview[];
  categoryMappings: Record<string, string>;
  paymentMappings: Record<string, string>;
}
