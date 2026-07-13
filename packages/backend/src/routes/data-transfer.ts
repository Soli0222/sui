import type { DataExportPayloadData, DataExportResponse } from "@sui/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { prisma } from "../lib/db";
import { badRequest, handleRouteError } from "../lib/http";
import { int32Schema, nonNegativeInt32Schema, positiveInt32Schema } from "../lib/validation";

const FORMAT_VERSION = 1;
const IMPORT_BODY_MAX_BYTES = 20 * 1024 * 1024;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const isoDateTimeSchema = z.string().datetime({ offset: true });
const nullableIsoDateTimeSchema = isoDateTimeSchema.nullable();
const uuidSchema = z.string().uuid();
const nullableUuidSchema = uuidSchema.nullable();
const dateShiftPolicySchema = z.enum(["none", "previous", "next"]);
const recurringItemTypeSchema = z.enum(["income", "expense", "transfer"]);
const transactionTypeSchema = z.enum(["income", "expense", "transfer", "adjustment"]);
const loanPaymentMethodSchema = z.enum(["account_withdrawal", "credit_card"]);
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

const recurringItemSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(100),
  type: recurringItemTypeSchema,
  amount: nonNegativeInt32Schema(),
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
  dateShiftPolicy: dateShiftPolicySchema,
  sortOrder: int32Schema(),
  deletedAt: nullableIsoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
}).strict();

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

const settingSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string(),
  updatedAt: isoDateTimeSchema,
}).strict();

const exportDataSchema = z.object({
  accounts: z.array(accountSchema),
  recurringItems: z.array(recurringItemSchema),
  creditCards: z.array(creditCardSchema),
  creditCardBillings: z.array(creditCardBillingSchema),
  subscriptions: z.array(subscriptionSchema),
  loans: z.array(loanSchema),
  transactions: z.array(transactionSchema),
  settings: z.array(settingSchema),
}).strict().superRefine((data, ctx) => {
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
});

const importPayloadSchema = z.object({
  formatVersion: z.number().int(),
  mode: z.string(),
  data: exportDataSchema,
}).strict();

type ExportData = z.infer<typeof exportDataSchema>;

function parseDate(value: string) {
  return new Date(value);
}

function parseNullableDate(value: string | null) {
  return value === null ? null : parseDate(value);
}

function toIsoString(value: Date) {
  return value.toISOString();
}

function toNullableIsoString(value: Date | null) {
  return value === null ? null : toIsoString(value);
}

function getJstDateStamp(date = new Date()) {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10).replaceAll("-", "");
}

async function buildExportData(): Promise<DataExportPayloadData> {
  const [
    accounts,
    recurringItems,
    creditCards,
    creditCardBillings,
    subscriptions,
    loans,
    transactions,
    settings,
  ] = await Promise.all([
    prisma.account.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.recurringItem.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.creditCard.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.creditCardBilling.findMany({
      include: { items: { orderBy: [{ creditCardId: "asc" }, { id: "asc" }] } },
      orderBy: [{ yearMonth: "asc" }, { id: "asc" }],
    }),
    prisma.subscription.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.loan.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.transaction.findMany({ orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }] }),
    prisma.setting.findMany({ orderBy: [{ key: "asc" }] }),
  ]);

  return {
    accounts: accounts.map((account) => ({
      ...account,
      lastReconciledAt: toNullableIsoString(account.lastReconciledAt),
      exchangeRateUpdatedAt: toIsoString(account.exchangeRateUpdatedAt),
      deletedAt: toNullableIsoString(account.deletedAt),
      createdAt: toIsoString(account.createdAt),
      updatedAt: toIsoString(account.updatedAt),
    })),
    recurringItems: recurringItems.map((item) => ({
      ...item,
      startDate: toNullableIsoString(item.startDate),
      endDate: toNullableIsoString(item.endDate),
      deletedAt: toNullableIsoString(item.deletedAt),
      createdAt: toIsoString(item.createdAt),
      updatedAt: toIsoString(item.updatedAt),
    })),
    creditCards: creditCards.map((card) => ({
      ...card,
      deletedAt: toNullableIsoString(card.deletedAt),
      createdAt: toIsoString(card.createdAt),
      updatedAt: toIsoString(card.updatedAt),
    })),
    creditCardBillings: creditCardBillings.map((billing) => ({
      ...billing,
      settlementDate: toNullableIsoString(billing.settlementDate),
      createdAt: toIsoString(billing.createdAt),
      updatedAt: toIsoString(billing.updatedAt),
      items: billing.items.map((item) => ({
        ...item,
        updatedAt: toIsoString(item.updatedAt),
      })),
    })),
    subscriptions: subscriptions.map((subscription) => ({
      ...subscription,
      startDate: toIsoString(subscription.startDate),
      endDate: toNullableIsoString(subscription.endDate),
      exchangeRateUpdatedAt: toIsoString(subscription.exchangeRateUpdatedAt),
      deletedAt: toNullableIsoString(subscription.deletedAt),
      createdAt: toIsoString(subscription.createdAt),
      updatedAt: toIsoString(subscription.updatedAt),
    })),
    loans: loans.map((loan) => ({
      ...loan,
      startDate: toIsoString(loan.startDate),
      deletedAt: toNullableIsoString(loan.deletedAt),
      createdAt: toIsoString(loan.createdAt),
      updatedAt: toIsoString(loan.updatedAt),
    })),
    transactions: transactions.map((transaction) => ({
      ...transaction,
      date: toIsoString(transaction.date),
      deletedAt: toNullableIsoString(transaction.deletedAt),
      createdAt: toIsoString(transaction.createdAt),
    })),
    settings: settings.map((setting) => ({
      ...setting,
      updatedAt: toIsoString(setting.updatedAt),
    })),
  };
}

async function replaceAllData(data: ExportData) {
  const creditCardItems = data.creditCardBillings.flatMap((billing) => billing.items);

  await prisma.$transaction(async (tx) => {
    await tx.transaction.deleteMany();
    await tx.creditCardItem.deleteMany();
    await tx.creditCardBilling.deleteMany();
    await tx.recurringItem.deleteMany();
    await tx.subscription.deleteMany();
    await tx.creditCard.deleteMany();
    await tx.loan.deleteMany();
    await tx.account.deleteMany();
    await tx.setting.deleteMany();

    if (data.accounts.length > 0) {
      await tx.account.createMany({
        data: data.accounts.map((account) => ({
          id: account.id,
          name: account.name,
          balance: account.balance,
          balanceOffset: account.balanceOffset,
          lastReconciledAt: parseNullableDate(account.lastReconciledAt),
          currencyCode: account.currencyCode,
          exchangeRateToJpy: account.exchangeRateToJpy,
          exchangeRateUpdatedAt: parseDate(account.exchangeRateUpdatedAt),
          sortOrder: account.sortOrder,
          deletedAt: parseNullableDate(account.deletedAt),
          createdAt: parseDate(account.createdAt),
          updatedAt: parseDate(account.updatedAt),
        })),
      });
    }

    if (data.recurringItems.length > 0) {
      await tx.recurringItem.createMany({
        data: data.recurringItems.map((item) => ({
          id: item.id,
          name: item.name,
          type: item.type,
          amount: item.amount,
          recurrence: item.recurrence,
          interval: item.interval,
          dayOfMonth: item.dayOfMonth,
          dayOfWeek: item.dayOfWeek,
          accountId: item.accountId,
          transferToAccountId: item.transferToAccountId,
          enabled: item.enabled,
          startDate: parseNullableDate(item.startDate),
          endDate: parseNullableDate(item.endDate),
          dateShiftPolicy: item.dateShiftPolicy,
          sortOrder: item.sortOrder,
          deletedAt: parseNullableDate(item.deletedAt),
          createdAt: parseDate(item.createdAt),
          updatedAt: parseDate(item.updatedAt),
        })),
      });
    }

    if (data.creditCards.length > 0) {
      await tx.creditCard.createMany({
        data: data.creditCards.map((card) => ({
          id: card.id,
          name: card.name,
          settlementDay: card.settlementDay,
          accountId: card.accountId,
          assumptionAmount: card.assumptionAmount,
          dateShiftPolicy: card.dateShiftPolicy,
          sortOrder: card.sortOrder,
          deletedAt: parseNullableDate(card.deletedAt),
          createdAt: parseDate(card.createdAt),
          updatedAt: parseDate(card.updatedAt),
        })),
      });
    }

    if (data.subscriptions.length > 0) {
      await tx.subscription.createMany({
        data: data.subscriptions.map((subscription) => ({
          id: subscription.id,
          name: subscription.name,
          amount: subscription.amount,
          currencyCode: subscription.currencyCode,
          exchangeRateToJpy: subscription.exchangeRateToJpy,
          exchangeRateUpdatedAt: parseDate(subscription.exchangeRateUpdatedAt),
          recurrence: subscription.recurrence,
          interval: subscription.interval,
          startDate: parseDate(subscription.startDate),
          dayOfMonth: subscription.dayOfMonth,
          dayOfWeek: subscription.dayOfWeek,
          endDate: parseNullableDate(subscription.endDate),
          paymentSource: subscription.paymentSource,
          deletedAt: parseNullableDate(subscription.deletedAt),
          createdAt: parseDate(subscription.createdAt),
          updatedAt: parseDate(subscription.updatedAt),
        })),
      });
    }

    if (data.loans.length > 0) {
      await tx.loan.createMany({
        data: data.loans.map((loan) => ({
          id: loan.id,
          name: loan.name,
          totalAmount: loan.totalAmount,
          startDate: parseDate(loan.startDate),
          paymentCount: loan.paymentCount,
          dateShiftPolicy: loan.dateShiftPolicy,
          paymentMethod: loan.paymentMethod,
          accountId: loan.accountId,
          deletedAt: parseNullableDate(loan.deletedAt),
          createdAt: parseDate(loan.createdAt),
          updatedAt: parseDate(loan.updatedAt),
        })),
      });
    }

    if (data.creditCardBillings.length > 0) {
      await tx.creditCardBilling.createMany({
        data: data.creditCardBillings.map((billing) => ({
          id: billing.id,
          yearMonth: billing.yearMonth,
          settlementDate: parseNullableDate(billing.settlementDate),
          createdAt: parseDate(billing.createdAt),
          updatedAt: parseDate(billing.updatedAt),
        })),
      });
    }

    if (creditCardItems.length > 0) {
      await tx.creditCardItem.createMany({
        data: creditCardItems.map((item) => ({
          id: item.id,
          billingId: item.billingId,
          creditCardId: item.creditCardId,
          amount: item.amount,
          updatedAt: parseDate(item.updatedAt),
        })),
      });
    }

    if (data.transactions.length > 0) {
      await tx.transaction.createMany({
        data: data.transactions.map((transaction) => ({
          id: transaction.id,
          accountId: transaction.accountId,
          transferToAccountId: transaction.transferToAccountId,
          forecastEventId: transaction.forecastEventId,
          date: parseDate(transaction.date),
          type: transaction.type,
          description: transaction.description,
          amount: transaction.amount,
          deletedAt: parseNullableDate(transaction.deletedAt),
          createdAt: parseDate(transaction.createdAt),
        })),
      });
    }

    if (data.settings.length > 0) {
      await tx.setting.createMany({
        data: data.settings.map((setting) => ({
          key: setting.key,
          value: setting.value,
          updatedAt: parseDate(setting.updatedAt),
        })),
      });
    }
  });

  return {
    accounts: data.accounts.length,
    recurringItems: data.recurringItems.length,
    creditCards: data.creditCards.length,
    creditCardBillings: data.creditCardBillings.length,
    creditCardItems: creditCardItems.length,
    subscriptions: data.subscriptions.length,
    loans: data.loans.length,
    transactions: data.transactions.length,
    settings: data.settings.length,
  };
}

export const dataTransferRoutes = new Hono()
  .get("/export", async (c) => {
    try {
      const payload: DataExportResponse = {
        formatVersion: FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        data: await buildExportData(),
      };

      c.header("Content-Disposition", `attachment; filename="sui-export-${getJstDateStamp()}.json"`);
      return c.json(payload);
    } catch (error) {
      return handleRouteError(c, error);
    }
  })
  .post(
    "/import",
    bodyLimit({
      maxSize: IMPORT_BODY_MAX_BYTES,
      onError: (c) => c.json({ error: "Payload too large" }, 413),
    }),
    async (c) => {
      try {
        const payload = importPayloadSchema.parse(await c.req.json());
        if (payload.mode !== "replace") {
          return badRequest(c, 'mode must be "replace"');
        }
        if (payload.formatVersion !== FORMAT_VERSION) {
          return badRequest(c, `formatVersion must be ${FORMAT_VERSION}`);
        }

        const counts = await replaceAllData(payload.data);
        return c.json({ counts });
      } catch (error) {
        return handleRouteError(c, error);
      }
    },
  );
