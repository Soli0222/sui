import type { Account, Prisma } from "@sui/db";
import { prisma } from "../lib/db";
import { normalizeCurrencyCode } from "../lib/currency";
import { BadRequestError, ConflictError, HttpError, NotFoundError } from "../lib/http";
import type { TransactionPayload } from "../schemas/transactions";
import { buildDashboard } from "./forecast";
import { applyBalanceEffects } from "./ledger-effects";
import { mutateLedger } from "./ledger-transaction";

export async function ensureActiveAccount(tx: Prisma.TransactionClient, id: string, message: string): Promise<Account> {
  const account = await tx.account.findFirst({ where: { id, deletedAt: null } });
  if (!account) throw new BadRequestError(message);
  return account;
}

async function validateTransactionAccounts(tx: Prisma.TransactionClient, body: TransactionPayload) {
  const source = body.accountId ? await ensureActiveAccount(tx, body.accountId, "Source account not found") : null;
  const destination = body.transferToAccountId
    ? await ensureActiveAccount(tx, body.transferToAccountId, "Destination account not found") : null;
  if (body.type === "transfer" && source && destination &&
    normalizeCurrencyCode(source.currencyCode) !== normalizeCurrencyCode(destination.currencyCode)) {
    throw new BadRequestError("Cross-currency transfers are not supported");
  }
}

export function createTransaction(body: TransactionPayload) {
  return mutateLedger(async (tx) => {
    await validateTransactionAccounts(tx, body);
    await applyBalanceEffects(tx, body);
    return tx.transaction.create({ data: {
      accountId: body.accountId ?? null,
      transferToAccountId: body.transferToAccountId ?? null,
      date: new Date(`${body.date}T00:00:00.000Z`),
      type: body.type,
      description: body.description,
      amount: body.amount,
    } });
  });
}

export function updateTransaction(id: string, body: TransactionPayload) {
  return mutateLedger(async (tx) => {
    const existing = await tx.transaction.findFirst({
      where: { id, deletedAt: null },
      include: { settlements: { include: { allocations: true } } },
    });
    if (!existing) throw new NotFoundError("Transaction not found");
    if (existing.type === "adjustment") throw new BadRequestError("Adjustment transactions cannot be edited");
    if (existing.settlements.length > 0 && body.type !== existing.type) {
      throw new BadRequestError("Transaction type cannot be changed while linked to a settlement");
    }
    if (existing.settlements.length > 0 && existing.type === "transfer" && !existing.accountId && body.accountId) {
      throw new BadRequestError("Cannot add a source account to a settlement-linked transfer");
    }
    await validateTransactionAccounts(tx, body);
    const allocated = existing.settlements.reduce((sum, settlement) =>
      sum + settlement.allocations.reduce((subtotal, allocation) => subtotal + allocation.amount, 0), 0);
    if (body.amount < allocated) throw new BadRequestError("New amount is less than linked settlement allocations");
    await applyBalanceEffects(tx, existing, -1);
    await applyBalanceEffects(tx, body);
    return tx.transaction.update({ where: { id: existing.id }, data: {
      accountId: body.accountId ?? null,
      transferToAccountId: body.transferToAccountId ?? null,
      date: new Date(`${body.date}T00:00:00.000Z`),
      type: body.type,
      description: body.description,
      amount: body.amount,
    } });
  });
}

export function deleteTransaction(id: string) {
  return mutateLedger(async (tx) => {
    const existing = await tx.transaction.findFirst({ where: { id, deletedAt: null }, include: { settlements: true } });
    if (!existing) throw new NotFoundError("Transaction not found");
    if (existing.forecastEventId !== null) throw new HttpError(403, "Forecast-confirmed transactions cannot be deleted");
    if (existing.settlements.length > 0) throw new HttpError(409, "Transactions linked to settlements cannot be deleted");
    await applyBalanceEffects(tx, existing, -1);
    await tx.transaction.update({ where: { id: existing.id }, data: { deletedAt: new Date() } });
  });
}

export async function confirmForecastEvent(body: { forecastEventId: string; amount: number; accountId?: string }) {
  // The forecast is read before the serializable ledger transaction. The unique
  // forecastEventId constraint resolves two requests using the same snapshot.
  const dashboard = await buildDashboard(prisma);
  const event = dashboard.forecast.find((item) => item.id === body.forecastEventId) ??
    dashboard.overdueForecast.find((item) => item.id === body.forecastEventId);
  if (!event) {
    const existing = await prisma.transaction.findUnique({ where: { forecastEventId: body.forecastEventId } });
    if (existing) throw new ConflictError("Forecast event already confirmed");
    throw new NotFoundError("Forecast event not found");
  }

  if (event.type === "transfer") {
    if (!event.accountId && !event.transferToAccountId) {
      throw new BadRequestError("Transfer forecast event requires source or destination account");
    }
    if (event.accountId && event.accountId === event.transferToAccountId) {
      throw new BadRequestError("transfer accounts must be different");
    }
  } else if (!(body.accountId ?? event.accountId)) {
    throw new BadRequestError("Account is required for this forecast event");
  }

  return mutateLedger(async (tx) => {
    const sourceId = event.type === "transfer" ? event.accountId : body.accountId ?? event.accountId;
    const destinationId = event.type === "transfer" ? event.transferToAccountId : null;
    const source = sourceId ? await ensureActiveAccount(tx, sourceId,
      event.type === "transfer" ? "Source account not found" : "Account not found") : null;
    const destination = destinationId ? await ensureActiveAccount(tx, destinationId, "Destination account not found") : null;
    if (event.type === "transfer" && source && destination &&
      normalizeCurrencyCode(source.currencyCode) !== normalizeCurrencyCode(destination.currencyCode)) {
      throw new BadRequestError("Cross-currency transfers are not supported");
    }
    if (event.type !== "transfer" && source && normalizeCurrencyCode(source.currencyCode) !== event.currencyCode) {
      throw new BadRequestError("Forecast event currency does not match the selected account");
    }
    const entry = { accountId: source?.id ?? null, transferToAccountId: destination?.id ?? null,
      type: event.type, amount: body.amount };
    await applyBalanceEffects(tx, entry);
    const transaction = await tx.transaction.create({ data: {
      ...entry,
      forecastEventId: event.id,
      date: new Date(`${event.date}T00:00:00.000Z`),
      description: event.description,
    } });
    return { transaction, currencyAccount: source ?? destination, accountName: source?.name ?? null, transferToAccount: destination };
  });
}
