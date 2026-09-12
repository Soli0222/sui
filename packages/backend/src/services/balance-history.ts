import { Prisma } from "@sui/db";
import { prisma } from "../lib/db";
import { normalizeCurrencyCode, toJpy } from "../lib/currency";
import { fromDateOnlyString, toDateOnlyString } from "../lib/dates";

export const MAX_HISTORY_POINTS = 2048;

// Aggregate inside PostgreSQL: neither a busy day nor an all-time query loads
// individual ledger records into the Node process. Bucket endpoints remain exact.
export async function getBalanceHistory(accountId: string | undefined, startDate: string | undefined, endDate: string, applyOffset: boolean) {
  return prisma.$transaction(async (tx) => {
    const accounts = await tx.account.findMany({
      where: { deletedAt: null, ...(accountId ? { id: accountId } : {}) },
      select: { id: true, balance: true, balanceOffset: true, currencyCode: true, exchangeRateToJpy: true },
    });
    const account = accountId ? accounts[0] : undefined;
    if (accountId && !account) return null;
    let balance = accounts.reduce((sum, item) => {
      const value = item.balance - (applyOffset ? item.balanceOffset : 0);
      return sum + (accountId ? value : toJpy(value, item));
    }, 0);
    const end = fromDateOnlyString(endDate);
    const scope = accountId
      ? Prisma.sql`AND (t.account_id = ${accountId}::uuid OR t.transfer_to_account_id = ${accountId}::uuid)`
      : Prisma.empty;
    const start = startDate ? Prisma.sql`AND t.date >= ${fromDateOnlyString(startDate)}::date` : Prisma.empty;
    const amount = accountId ? Prisma.sql`t.amount::double precision` : Prisma.sql`
      CASE WHEN upper(coalesce(a.currency_code, d.currency_code, 'JPY')) IN ('USD', 'EUR')
        THEN floor((t.amount::double precision / 100) * coalesce(a.exchange_rate_to_jpy, d.exchange_rate_to_jpy, 1) + 0.5)
        ELSE t.amount::double precision END`;
    const sign = accountId ? Prisma.sql`
      CASE WHEN t.type IN ('income', 'adjustment') THEN 1 WHEN t.type = 'expense' THEN -1
        WHEN t.account_id = ${accountId}::uuid THEN -1 ELSE 1 END` : Prisma.sql`
      CASE WHEN t.type IN ('income', 'adjustment') THEN 1 WHEN t.type = 'expense' THEN -1
        WHEN t.account_id IS NULL THEN 1 WHEN t.transfer_to_account_id IS NULL THEN -1 ELSE 0 END`;
    const rows = await tx.$queryRaw<Array<{ bucket: number; days: number; date: Date; delta: number; count: bigint; description: string }>>(Prisma.sql`
      WITH scoped AS (
        SELECT t.id, t.date, t.created_at, t.description, (${amount}) * (${sign}) AS delta
        FROM transactions t
        LEFT JOIN accounts a ON a.id = t.account_id
        LEFT JOIN accounts d ON d.id = t.transfer_to_account_id
        WHERE t.deleted_at IS NULL ${scope} ${start}
      ), bounds AS (
        SELECT min(date) FILTER (WHERE date <= ${end}::date) AS first_date,
          greatest(1, ceil(((${end}::date - min(date) FILTER (WHERE date <= ${end}::date)) + 1)::numeric / ${MAX_HISTORY_POINTS}))::int AS days
        FROM scoped
      ), bucketed AS (
        SELECT s.*, b.days, CASE WHEN s.date > ${end}::date THEN -1
          ELSE (s.date - b.first_date) / b.days END AS bucket
        FROM scoped s CROSS JOIN bounds b
      ), totals AS (
        SELECT bucket, days, max(date) AS date, sum(delta)::double precision AS delta, count(*) AS count
        FROM bucketed GROUP BY bucket, days
      ), descriptions AS (
        SELECT DISTINCT ON (bucket) bucket, description FROM bucketed ORDER BY bucket, date, created_at, id
      )
      SELECT t.*, d.description FROM totals t JOIN descriptions d USING (bucket)
      ORDER BY (t.bucket = -1) DESC, t.bucket DESC
    `);
    const currencyCode = account ? normalizeCurrencyCode(account.currencyCode) : "JPY";
    const points = [];
    let bucketDays = 1;
    for (const row of rows) {
      if (row.bucket !== -1) {
        bucketDays = row.days;
        points.push({
          date: toDateOnlyString(row.date)!, balance,
          balanceJpy: account ? toJpy(balance, account) : balance, currencyCode,
          description: `${row.description}${row.count > 1n ? ` 他${row.count - 1n}件` : ""}${row.days > 1 ? `（${row.days}日単位の期末残高）` : ""}`,
        });
      }
      balance -= row.delta;
    }
    return { points: points.reverse(), bucketDays };
  }, { isolationLevel: "RepeatableRead" });
}
