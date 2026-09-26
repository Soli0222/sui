import type { DataExportPayloadData } from "@sui/shared";
import type { Prisma } from "@sui/db";
import { prisma } from "../lib/db";
import type { ExportData } from "../schemas/data-transfer";

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

export async function buildExportData(prisma: Prisma.TransactionClient): Promise<DataExportPayloadData> {
  const [
    accounts,
    recurringItems,
    creditCards,
    creditCardBillings,
    subscriptions,
    salaryRecords,
    donations,
    furusatoSimulationInputs,
    loans,
    transactions,
    people,
    transactionSplits,
    splitShares,
    settlements,
    settlementAllocations,
    settings,
  ] = await Promise.all([
    prisma.account.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.recurringItem.findMany({ include: { amountChanges: { orderBy: { effectiveFrom: "asc" } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.creditCard.findMany({
      include: { assumptions: { orderBy: { sortOrder: "asc" } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    prisma.creditCardBilling.findMany({
      include: { items: { orderBy: [{ creditCardId: "asc" }, { id: "asc" }] } },
      orderBy: [{ yearMonth: "asc" }, { id: "asc" }],
    }),
    prisma.subscription.findMany({ include: { amountChanges: { orderBy: { effectiveFrom: "asc" } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.salaryRecord.findMany({ orderBy: [{ paidOn: "asc" }, { createdAt: "asc" }, { id: "asc" }] }),
    prisma.donation.findMany({ orderBy: [{ donatedOn: "asc" }, { createdAt: "asc" }, { id: "asc" }] }),
    prisma.furusatoSimulationInput.findMany({ orderBy: [{ year: "asc" }, { id: "asc" }] }),
    prisma.loan.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.transaction.findMany({ orderBy: [{ date: "asc" }, { createdAt: "asc" }, { id: "asc" }] }),
    prisma.person.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.transactionSplit.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    prisma.splitShare.findMany({ orderBy: [{ id: "asc" }] }),
    prisma.settlement.findMany({ orderBy: [{ date: "asc" }, { id: "asc" }] }),
    prisma.settlementAllocation.findMany({ orderBy: [{ id: "asc" }] }),
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
      amountChanges: item.amountChanges.map((change) => ({ ...change,
        effectiveFrom: toIsoString(change.effectiveFrom),
        createdAt: toIsoString(change.createdAt),
        updatedAt: toIsoString(change.updatedAt),
      })),
      startDate: toNullableIsoString(item.startDate),
      endDate: toNullableIsoString(item.endDate),
      deletedAt: toNullableIsoString(item.deletedAt),
      createdAt: toIsoString(item.createdAt),
      updatedAt: toIsoString(item.updatedAt),
    })),
    creditCards: creditCards.map((card) => ({
      ...card,
      assumptions: card.assumptions.map((period) => ({ amount: period.amount, startMonth: period.startMonth, endMonth: period.endMonth })),
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
      amountChanges: subscription.amountChanges.map((change) => ({
        ...change,
        effectiveFrom: toIsoString(change.effectiveFrom),
        createdAt: toIsoString(change.createdAt),
        updatedAt: toIsoString(change.updatedAt),
      })),
      startDate: toIsoString(subscription.startDate),
      endDate: toNullableIsoString(subscription.endDate),
      exchangeRateUpdatedAt: toIsoString(subscription.exchangeRateUpdatedAt),
      deletedAt: toNullableIsoString(subscription.deletedAt),
      createdAt: toIsoString(subscription.createdAt),
      updatedAt: toIsoString(subscription.updatedAt),
    })),
    salaryRecords: salaryRecords.map((record) => ({
      ...record,
      paidOn: toIsoString(record.paidOn),
      deletedAt: toNullableIsoString(record.deletedAt),
      createdAt: toIsoString(record.createdAt),
      updatedAt: toIsoString(record.updatedAt),
    })),
    donations: donations.map((donation) => ({
      ...donation,
      donatedOn: toIsoString(donation.donatedOn),
      deletedAt: toNullableIsoString(donation.deletedAt),
      createdAt: toIsoString(donation.createdAt),
      updatedAt: toIsoString(donation.updatedAt),
    })),
    furusatoSimulationInputs: furusatoSimulationInputs.map((input) => ({
      ...input,
      createdAt: toIsoString(input.createdAt),
      updatedAt: toIsoString(input.updatedAt),
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
    people: people.map((person) => ({
      ...person,
      deletedAt: toNullableIsoString(person.deletedAt),
      createdAt: toIsoString(person.createdAt),
      updatedAt: toIsoString(person.updatedAt),
    })),
    transactionSplits: transactionSplits.map((split) => ({
      ...split,
      date: toIsoString(split.date),
      createdAt: toIsoString(split.createdAt),
      updatedAt: toIsoString(split.updatedAt),
    })),
    splitShares: splitShares.map((share) => ({
      ...share,
      ratio: share.ratio,
      amount: share.amount,
    })),
    settlements: settlements.map((settlement) => ({
      ...settlement,
      date: toIsoString(settlement.date),
      createdAt: toIsoString(settlement.createdAt),
    })),
    settlementAllocations: settlementAllocations.map((allocation) => ({
      ...allocation,
      amount: allocation.amount,
    })),
    settings: settings.map((setting) => ({
      ...setting,
      updatedAt: toIsoString(setting.updatedAt),
    })),
  };
}

export async function replaceAllData(data: ExportData) {
  const creditCardItems = data.creditCardBillings.flatMap((billing) => billing.items);

  await prisma.$transaction(async (tx) => {
    await tx.settlementAllocation.deleteMany();
    await tx.settlement.deleteMany();
    await tx.splitShare.deleteMany();
    await tx.transactionSplit.deleteMany();
    await tx.transaction.deleteMany();
    await tx.creditCardItem.deleteMany();
    await tx.creditCardBilling.deleteMany();
    await tx.recurringItem.deleteMany();
    await tx.subscription.deleteMany();
    await tx.salaryRecord.deleteMany();
    await tx.donation.deleteMany();
    await tx.furusatoSimulationInput.deleteMany();
    await tx.creditCard.deleteMany();
    await tx.loan.deleteMany();
    await tx.person.deleteMany();
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
      const changes = data.recurringItems.flatMap((item) => item.amountChanges);
      if (changes.length > 0) {
        await tx.recurringItemAmountChange.createMany({ data: changes.map((change) => ({
          id: change.id,
          recurringItemId: change.recurringItemId,
          effectiveFrom: parseDate(change.effectiveFrom),
          amount: change.amount,
          createdAt: parseDate(change.createdAt),
          updatedAt: parseDate(change.updatedAt),
        })) });
      }
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
      const assumptions = data.creditCards.flatMap((card) => (card.assumptions ?? [{ amount: card.assumptionAmount, startMonth: null, endMonth: null }])
        .map((period, sortOrder) => ({ creditCardId: card.id, ...period, sortOrder })));
      if (assumptions.length > 0) {
        await tx.creditCardAssumption.createMany({ data: assumptions });
      }
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
      const changes = data.subscriptions.flatMap((subscription) => subscription.amountChanges);
      if (changes.length > 0) {
        await tx.subscriptionAmountChange.createMany({ data: changes.map((change) => ({
          id: change.id,
          subscriptionId: change.subscriptionId,
          effectiveFrom: parseDate(change.effectiveFrom),
          amount: change.amount,
          createdAt: parseDate(change.createdAt),
          updatedAt: parseDate(change.updatedAt),
        })) });
      }
    }

    if (data.salaryRecords.length > 0) {
      await tx.salaryRecord.createMany({
        data: data.salaryRecords.map((record) => ({
          id: record.id,
          paidOn: parseDate(record.paidOn),
          kind: record.kind,
          name: record.name,
          grossAmount: record.grossAmount,
          healthInsurance: record.healthInsurance,
          pensionInsurance: record.pensionInsurance,
          employmentInsurance: record.employmentInsurance,
          childcareSupportLevy: record.childcareSupportLevy,
          incomeTax: record.incomeTax,
          residentTax: record.residentTax,
          yearEndTaxAdjustment: record.yearEndTaxAdjustment,
          employeeStockContribution: record.employeeStockContribution,
          employeeStockIncentive: record.employeeStockIncentive,
          dcMatchingContribution: record.dcMatchingContribution,
          otherDeductions: record.otherDeductions,
          deletedAt: parseNullableDate(record.deletedAt),
          createdAt: parseDate(record.createdAt),
          updatedAt: parseDate(record.updatedAt),
        })),
      });
    }

    if (data.donations.length > 0) {
      await tx.donation.createMany({
        data: data.donations.map((donation) => ({
          id: donation.id,
          recipient: donation.recipient,
          amount: donation.amount,
          memo: donation.memo,
          donatedOn: parseDate(donation.donatedOn),
          deletedAt: parseNullableDate(donation.deletedAt),
          createdAt: parseDate(donation.createdAt),
          updatedAt: parseDate(donation.updatedAt),
        })),
      });
    }

    if (data.furusatoSimulationInputs.length > 0) {
      await tx.furusatoSimulationInput.createMany({
        data: data.furusatoSimulationInputs.map((input) => ({
          id: input.id,
          year: input.year,
          expectedBonusGross: input.expectedBonusGross,
          otherIncome: input.otherIncome,
          otherDeductions: input.otherDeductions,
          createdAt: parseDate(input.createdAt),
          updatedAt: parseDate(input.updatedAt),
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

    if (data.people.length > 0) {
      await tx.person.createMany({
        data: data.people.map((person) => ({
          id: person.id,
          name: person.name,
          memo: person.memo,
          sortOrder: person.sortOrder,
          deletedAt: parseNullableDate(person.deletedAt),
          createdAt: parseDate(person.createdAt),
          updatedAt: parseDate(person.updatedAt),
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

    if (data.transactionSplits.length > 0) {
      await tx.transactionSplit.createMany({
        data: data.transactionSplits.map((split) => ({
          id: split.id,
          date: parseDate(split.date),
          description: split.description,
          memo: split.memo,
          amount: split.amount,
          method: split.method,
          ownRatio: split.ownRatio,
          createdAt: parseDate(split.createdAt),
          updatedAt: parseDate(split.updatedAt),
        })),
      });
    }

    if (data.splitShares.length > 0) {
      await tx.splitShare.createMany({
        data: data.splitShares.map((share) => ({
          id: share.id,
          splitId: share.splitId,
          personId: share.personId,
          ratio: share.ratio,
          amount: share.amount,
        })),
      });
    }

    if (data.settlements.length > 0) {
      await tx.settlement.createMany({
        data: data.settlements.map((settlement) => ({
          id: settlement.id,
          kind: settlement.kind,
          personId: settlement.personId,
          transactionId: settlement.transactionId,
          date: parseDate(settlement.date),
          note: settlement.note,
          createdAt: parseDate(settlement.createdAt),
        })),
      });
    }

    if (data.settlementAllocations.length > 0) {
      await tx.settlementAllocation.createMany({
        data: data.settlementAllocations.map((allocation) => ({
          id: allocation.id,
          settlementId: allocation.settlementId,
          shareId: allocation.shareId,
          amount: allocation.amount,
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
    salaryRecords: data.salaryRecords.length,
    donations: data.donations.length,
    furusatoSimulationInputs: data.furusatoSimulationInputs.length,
    loans: data.loans.length,
    transactions: data.transactions.length,
    people: data.people.length,
    transactionSplits: data.transactionSplits.length,
    splitShares: data.splitShares.length,
    settlements: data.settlements.length,
    settlementAllocations: data.settlementAllocations.length,
    settings: data.settings.length,
  };
}
