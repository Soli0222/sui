import { hasOverlappingAssumptions, isValidYearMonth } from "@sui/shared";
import { z } from "zod";
import { isDateString } from "../lib/dates";
import { int32Schema, nonNegativeInt32Schema, positiveInt32Schema } from "../lib/validation";

export const FORMAT_VERSION = 1;

const isoDateTimeSchema = z.string().datetime({ offset: true });
const nullableIsoDateTimeSchema = isoDateTimeSchema.nullable();
const uuidSchema = z.string().uuid();
const nullableUuidSchema = uuidSchema.nullable();
const dateShiftPolicySchema = z.enum(["none", "previous", "next"]);
const assumptionMonthSchema = z.string().refine(isValidYearMonth).nullable().optional().default(null);
const assumptionPeriodSchema = z.object({
  amount: nonNegativeInt32Schema(),
  startMonth: assumptionMonthSchema,
  endMonth: assumptionMonthSchema,
}).strict().refine((period) => !period.startMonth || !period.endMonth || period.startMonth <= period.endMonth);
const recurringItemTypeSchema = z.enum(["income", "expense", "transfer"]);
const transactionTypeSchema = z.enum(["income", "expense", "transfer", "adjustment"]);
const loanPaymentMethodSchema = z.enum(["account_withdrawal", "credit_card"]);
const salaryRecordKindSchema = z.enum(["salary", "bonus"]);
const recurrenceSchema = z.enum(["monthly", "weekly"]).optional().default("monthly");

const accountSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(100),
  balance: int32Schema(),
  balanceOffset: int32Schema(),
  lastReconciledAt: nullableIsoDateTimeSchema,
  currencyCode: z.string().length(3),
  exchangeRateToJpy: z.number().finite().positive(),
  exchangeRateUpdatedAt: isoDateTimeSchema,
  sortOrder: int32Schema(),
  deletedAt: nullableIsoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

const recurringAmountChangeSchema = z.object({
  id: uuidSchema,
  recurringItemId: uuidSchema,
  effectiveFrom: isoDateTimeSchema.refine((value) => value.endsWith("T00:00:00.000Z") && isDateString(value.slice(0, 10))),
  amount: nonNegativeInt32Schema(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

const recurringItemSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(100),
  type: recurringItemTypeSchema,
  amount: nonNegativeInt32Schema(),
  amountChanges: z.array(recurringAmountChangeSchema).default([]),
  recurrence: recurrenceSchema,
  interval: positiveInt32Schema().optional().default(1),
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional().default(null),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional().default(null),
  accountId: nullableUuidSchema,
  transferToAccountId: nullableUuidSchema,
  enabled: z.boolean(),
  startDate: nullableIsoDateTimeSchema,
  endDate: nullableIsoDateTimeSchema,
  dateShiftPolicy: dateShiftPolicySchema,
  sortOrder: int32Schema(),
  deletedAt: nullableIsoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict().superRefine((item, ctx) => {
  if (item.recurrence === "monthly" && (item.dayOfMonth === null || item.dayOfWeek !== null)) {
    ctx.addIssue({
      code: "custom",
      message: "monthly recurring item requires dayOfMonth and no dayOfWeek",
      path: ["dayOfMonth"],
    });
  }
  if (item.recurrence === "weekly" && (item.dayOfWeek === null || item.dayOfMonth !== null)) {
    ctx.addIssue({
      code: "custom",
      message: "weekly recurring item requires dayOfWeek and no dayOfMonth",
      path: ["dayOfWeek"],
    });
  }
  if (item.interval > 1 && item.startDate === null) {
    ctx.addIssue({
      code: "custom",
      message: "recurring item with interval > 1 requires startDate",
      path: ["startDate"],
    });
  }
});

const creditCardSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(100),
  settlementDay: z.number().int().min(1).max(31).nullable(),
  accountId: nullableUuidSchema,
  assumptionAmount: nonNegativeInt32Schema(),
  assumptions: z.array(assumptionPeriodSchema).optional(),
  dateShiftPolicy: dateShiftPolicySchema,
  sortOrder: int32Schema(),
  deletedAt: nullableIsoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict().refine((card) => !hasOverlappingAssumptions(card.assumptions ?? [{ amount: card.assumptionAmount, startMonth: null, endMonth: null }]), {
  message: "credit card assumption periods must not overlap",
  path: ["assumptions"],
});

const creditCardItemSchema = z.object({
  id: uuidSchema,
  billingId: uuidSchema,
  creditCardId: uuidSchema,
  amount: nonNegativeInt32Schema(),
  updatedAt: isoDateTimeSchema,
}).strict();

const creditCardBillingSchema = z.object({
  id: uuidSchema,
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  settlementDate: nullableIsoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  items: z.array(creditCardItemSchema),
}).strict();

const subscriptionAmountChangeSchema = z.object({
  id: uuidSchema,
  subscriptionId: uuidSchema,
  effectiveFrom: isoDateTimeSchema.refine((value) => value.endsWith("T00:00:00.000Z") && isDateString(value.slice(0, 10))),
  amount: positiveInt32Schema(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

const subscriptionSchema = z.preprocess(
  (value) => {
    if (!value || typeof value !== "object") {
      return value;
    }

    const record = { ...value } as Record<string, unknown>;

    if (record.recurrence === undefined) {
      record.recurrence = record.dayOfWeek !== undefined && record.dayOfWeek !== null ? "weekly" : "monthly";
    }

    if (record.interval === undefined) {
      const intervalMonths = record.intervalMonths;
      record.interval = intervalMonths === null ? 1 : (intervalMonths ?? 1);
    }

    return record;
  },
  z.object({
    id: uuidSchema,
    name: z.string().min(1).max(100),
    amount: positiveInt32Schema(),
    amountChanges: z.array(subscriptionAmountChangeSchema).default([]),
    currencyCode: z.string().length(3).default("JPY"),
    exchangeRateToJpy: z.number().finite().positive().default(1),
    exchangeRateUpdatedAt: isoDateTimeSchema.default(() => new Date().toISOString()),
    recurrence: recurrenceSchema,
    interval: positiveInt32Schema(),
    intervalMonths: positiveInt32Schema().nullable().optional(),
    startDate: isoDateTimeSchema,
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional().default(null),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional().default(null),
    endDate: nullableIsoDateTimeSchema,
    paymentSource: z.string().max(100).nullable(),
    deletedAt: nullableIsoDateTimeSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  }).strict().superRefine((item, ctx) => {
    if (item.recurrence === "monthly" && (item.dayOfMonth === null || item.dayOfWeek !== null)) {
      ctx.addIssue({
        code: "custom",
        message: "monthly subscription requires dayOfMonth and no dayOfWeek",
        path: ["dayOfMonth"],
      });
    }
    if (item.recurrence === "weekly" && (item.dayOfWeek === null || item.dayOfMonth !== null)) {
      ctx.addIssue({
        code: "custom",
        message: "weekly subscription requires dayOfWeek and no dayOfMonth",
        path: ["dayOfWeek"],
      });
    }
  }),
);

const loanSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(100),
  totalAmount: positiveInt32Schema(),
  startDate: isoDateTimeSchema,
  paymentCount: positiveInt32Schema(),
  dateShiftPolicy: dateShiftPolicySchema,
  paymentMethod: loanPaymentMethodSchema,
  accountId: nullableUuidSchema,
  deletedAt: nullableIsoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

const salaryRecordSchema = z.object({
  id: uuidSchema,
  paidOn: isoDateTimeSchema,
  kind: salaryRecordKindSchema,
  name: z.string().max(100).nullable(),
  grossAmount: nonNegativeInt32Schema(),
  healthInsurance: int32Schema(),
  pensionInsurance: int32Schema(),
  employmentInsurance: int32Schema(),
  childcareSupportLevy: int32Schema().default(0),
  incomeTax: int32Schema(),
  residentTax: int32Schema(),
  yearEndTaxAdjustment: int32Schema().default(0),
  employeeStockContribution: int32Schema().default(0),
  employeeStockIncentive: int32Schema().default(0),
  dcMatchingContribution: int32Schema().default(0),
  otherDeductions: int32Schema(),
  deletedAt: nullableIsoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

const donationSchema = z.object({
  id: uuidSchema,
  recipient: z.string().min(1).max(100),
  amount: positiveInt32Schema(),
  memo: z.string().max(200).nullable(),
  donatedOn: isoDateTimeSchema,
  deletedAt: nullableIsoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

const furusatoSimulationInputSchema = z.object({
  id: uuidSchema,
  year: z.number().int().min(1).max(9998),
  expectedBonusGross: nonNegativeInt32Schema(),
  otherIncome: nonNegativeInt32Schema(),
  otherDeductions: nonNegativeInt32Schema(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

const transactionSchema = z.object({
  id: uuidSchema,
  accountId: nullableUuidSchema,
  transferToAccountId: nullableUuidSchema,
  forecastEventId: z.string().max(100).nullable(),
  date: isoDateTimeSchema,
  type: transactionTypeSchema,
  description: z.string().min(1).max(200),
  amount: positiveInt32Schema(),
  deletedAt: nullableIsoDateTimeSchema,
  createdAt: isoDateTimeSchema,
}).strict();

const splitMethodSchema = z.enum(["equal", "ratio", "amount"]);
const settlementKindSchema = z.enum(["transaction", "offset"]);

const personSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(100),
  memo: z.string().max(200).nullable(),
  sortOrder: int32Schema(),
  deletedAt: nullableIsoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

const transactionSplitSchema = z.object({
  id: uuidSchema,
  date: isoDateTimeSchema,
  description: z.string().min(1).max(200),
  memo: z.string().max(200).nullable(),
  amount: positiveInt32Schema(),
  method: splitMethodSchema,
  ownRatio: z.number().int().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

const splitShareSchema = z.object({
  id: uuidSchema,
  splitId: uuidSchema,
  personId: uuidSchema,
  ratio: z.number().int().nullable(),
  amount: z.number().int(),
}).strict();

const settlementSchema = z.object({
  id: uuidSchema,
  kind: settlementKindSchema,
  personId: uuidSchema,
  transactionId: nullableUuidSchema,
  date: isoDateTimeSchema,
  note: z.string().max(200).nullable(),
  createdAt: isoDateTimeSchema,
}).strict();

const settlementAllocationSchema = z.object({
  id: uuidSchema,
  settlementId: uuidSchema,
  shareId: uuidSchema,
  amount: z.number().int(),
}).strict();

const settingSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string(),
  updatedAt: isoDateTimeSchema,
}).strict();

export const exportDataSchema = z.object({
  accounts: z.array(accountSchema),
  recurringItems: z.array(recurringItemSchema),
  creditCards: z.array(creditCardSchema),
  creditCardBillings: z.array(creditCardBillingSchema),
  subscriptions: z.array(subscriptionSchema),
  salaryRecords: z.array(salaryRecordSchema).default([]),
  donations: z.array(donationSchema).default([]),
  furusatoSimulationInputs: z.array(furusatoSimulationInputSchema).default([]),
  loans: z.array(loanSchema),
  transactions: z.array(transactionSchema),
  people: z.array(personSchema).default([]),
  transactionSplits: z.array(transactionSplitSchema).default([]),
  splitShares: z.array(splitShareSchema).default([]),
  settlements: z.array(settlementSchema).default([]),
  settlementAllocations: z.array(settlementAllocationSchema).default([]),
  settings: z.array(settingSchema),
}).strict().superRefine((data, ctx) => {
  data.recurringItems.forEach((item, itemIndex) => {
    const dates = new Set<string>();
    item.amountChanges.forEach((change, changeIndex) => {
      if (change.recurringItemId !== item.id || dates.has(change.effectiveFrom)) {
        ctx.addIssue({ code: "custom", message: "Amount change must belong to its recurring item and have a unique date", path: ["recurringItems", itemIndex, "amountChanges", changeIndex] });
      }
      dates.add(change.effectiveFrom);
    });
  });
  data.creditCardBillings.forEach((billing, billingIndex) => {
    billing.items.forEach((item, itemIndex) => {
      if (item.billingId !== billing.id) {
        ctx.addIssue({
          code: "custom",
          message: "billingId must match parent billing id",
          path: ["creditCardBillings", billingIndex, "items", itemIndex, "billingId"],
        });
      }
    });
  });

  data.subscriptions.forEach((subscription, subscriptionIndex) => {
    const dates = new Set<string>();
    subscription.amountChanges.forEach((change, changeIndex) => {
      if (change.subscriptionId !== subscription.id || dates.has(change.effectiveFrom)) {
        ctx.addIssue({ code: "custom", message: "Amount change must belong to its subscription and have a unique date", path: ["subscriptions", subscriptionIndex, "amountChanges", changeIndex] });
      }
      dates.add(change.effectiveFrom);
    });
  });

  const splitIds = new Set(data.transactionSplits.map((split) => split.id));
  data.splitShares.forEach((share, index) => {
    if (!splitIds.has(share.splitId)) {
      ctx.addIssue({
        code: "custom",
        message: "splitId must reference an exported transaction split",
        path: ["splitShares", index, "splitId"],
      });
    }
  });

  const settlementIds = new Set(data.settlements.map((settlement) => settlement.id));
  data.settlementAllocations.forEach((allocation, index) => {
    if (!settlementIds.has(allocation.settlementId)) {
      ctx.addIssue({
        code: "custom",
        message: "settlementId must reference an exported settlement",
        path: ["settlementAllocations", index, "settlementId"],
      });
    }
  });
});

export const importPayloadSchema = z.object({
  formatVersion: z.number().int(),
  mode: z.string(),
  data: exportDataSchema,
}).strict();

export type ExportData = z.infer<typeof exportDataSchema>;
