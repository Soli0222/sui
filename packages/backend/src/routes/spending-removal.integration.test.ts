import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, it } from "vitest";

type TestDb = {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
};
const PgClient = createRequire(import.meta.url)("pg").Client as new (options: { connectionString?: string }) => TestDb;
const migration = readFileSync(new URL("../../../db/prisma/migrations/20260926000000_remove_spending_approval/migration.sql", import.meta.url), "utf8");
const preview = readFileSync(new URL("../../../../scripts/spending-removal-preview.sql", import.meta.url), "utf8");
const sourceId = "11111111-1111-4111-a111-111111111111";
const destinationId = "22222222-2222-4222-a222-222222222222";

async function fixture(run: (db: TestDb) => Promise<void>) {
  const db = new PgClient({ connectionString: process.env.DATABASE_URL });
  const schema = `spending_removal_${randomUUID().replaceAll("-", "")}`;
  await db.connect();
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET search_path TO ${schema}`);
    await db.query(`
      CREATE TABLE accounts (id uuid PRIMARY KEY, balance integer NOT NULL, balance_offset integer NOT NULL,
        supplemental_budget_enabled boolean NOT NULL DEFAULT false);
      CREATE TABLE recurring_items (id uuid PRIMARY KEY, type text NOT NULL, amount integer NOT NULL,
        recurrence text NOT NULL, interval integer NOT NULL, start_date date, end_date date,
        account_id uuid, transfer_to_account_id uuid, enabled boolean NOT NULL,
        deleted_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE recurring_item_amount_changes (id uuid PRIMARY KEY, recurring_item_id uuid NOT NULL
        REFERENCES recurring_items(id) ON DELETE CASCADE, amount integer NOT NULL);
      CREATE TABLE transactions (id uuid PRIMARY KEY, forecast_event_id text UNIQUE, type text NOT NULL,
        amount integer NOT NULL, date date NOT NULL, account_id uuid, transfer_to_account_id uuid,
        description text NOT NULL, deleted_at timestamptz);
      CREATE TABLE spending_ledgers (id integer PRIMARY KEY, data jsonb NOT NULL);
      CREATE TABLE spending_ai_credentials (id integer PRIMARY KEY, encrypted text NOT NULL);
    `);
    await run(db);
  } finally {
    await db.query("ROLLBACK").catch(() => undefined);
    await db.query(`DROP SCHEMA ${schema} CASCADE`);
    await db.end();
  }
}

async function schedule(db: TestDb, id: string, enabled = true, deleted = false) {
  await db.query(`INSERT INTO recurring_items
    (id, type, amount, recurrence, interval, start_date, end_date,
      account_id, transfer_to_account_id, enabled, deleted_at)
    VALUES ($1, 'transfer', 8000, 'monthly', 1, '2026-09-20', '2026-09-20', $2, $3, $4, $5)`,
  [id, sourceId, destinationId, enabled, deleted ? new Date() : null]);
}

function link(recurringId: string, returnOf: string | null = null) {
  return { id: randomUUID(), recurringId, eventId: `recurring:${recurringId}:2026-09`, returnOf,
    expected: { sourceId, destinationId, date: "2026-09-20", amount: 8000 } };
}

it("removes only unconfirmed funding and keeps actual transfers with disabled source schedules", async () => {
  await fixture(async (db) => {
    const account = sourceId;
    const pending = randomUUID();
    const cancelled = randomUUID();
    const expired = randomUUID();
    const purchasedPending = randomUUID();
    const confirmed = randomUUID();
    const pendingReturn = randomUUID();
    const confirmedReturn = randomUUID();
    const manual = randomUUID();
    const originalLink = link(confirmed);
    const links = [link(pending), link(cancelled), link(purchasedPending), originalLink,
      link(pendingReturn, originalLink.id), link(confirmedReturn, originalLink.id), link(expired)];
    await db.query("INSERT INTO accounts VALUES ($1, 125000, 25000, true)", [account]);
    await db.query("INSERT INTO accounts VALUES ($1, 50000, 0, false)", [destinationId]);
    for (const id of [pending, cancelled, expired, purchasedPending, confirmed, pendingReturn, confirmedReturn, manual]) {
      await schedule(db, id, id !== cancelled, id === cancelled || id === confirmedReturn);
    }
    await db.query("INSERT INTO recurring_item_amount_changes VALUES ($1, $2, 4000)", [randomUUID(), pending]);
    await db.query("INSERT INTO recurring_item_amount_changes VALUES ($1, $2, 8000)", [randomUUID(), confirmed]);
    await db.query("INSERT INTO recurring_item_amount_changes VALUES ($1, $2, 6000)", [randomUUID(), manual]);
    const actualId = randomUUID();
    const deletedActualId = randomUUID();
    await db.query(`INSERT INTO transactions VALUES
      ($1, $2, 'transfer', 8000, '2026-09-20', $3, NULL, '支出決裁による振替', NULL),
      ($4, $5, 'transfer', 2000, '2026-09-20', $3, NULL, '支出決裁による返却', now())`,
    [actualId, originalLink.eventId, account, deletedActualId, links[5].eventId]);
    await db.query("INSERT INTO spending_ai_credentials VALUES (1, 'encrypted')");
    await db.query("INSERT INTO spending_ledgers VALUES (1, $1)", [JSON.stringify({schemaVersion: 1, requests: [
      { id: randomUUID(), status: "approved", fundingLinks: [links[0], originalLink, links[4], links[5]] },
      { id: randomUUID(), status: "cancelled", deletedAt: "2026-09-21", fundingLinks: [links[1]] },
      { id: randomUUID(), status: "expired", fundingLinks: [links[6]] },
      { id: randomUUID(), status: "purchased", fundingLinks: [links[2]] },
      { id: randomUUID(), status: "draft", fundingLinks: [] },
    ] })]);
    const inventory = (await db.query(preview)).rows[0];
    expect(inventory).toMatchObject({
      ledgers: "1", saved_ai_credentials: "1", flagged_accounts: "1", requests: "5",
      funding_links: "7", return_links: "2", schedules_to_disable: "2", schedules_to_delete: "5",
    });
    expect(inventory.disabled_schedule_list).toHaveLength(2);
    expect(inventory.deleted_schedule_list).toHaveLength(5);
    await db.query(migration);

    const rows = await db.query("SELECT id::text, enabled, deleted_at FROM recurring_items ORDER BY id");
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows).toEqual(expect.arrayContaining([
      { id: confirmed, enabled: false, deleted_at: null },
      { id: confirmedReturn, enabled: false, deleted_at: null },
      { id: manual, enabled: true, deleted_at: null },
    ]));
    expect((await db.query("SELECT recurring_item_id::text FROM recurring_item_amount_changes")).rows)
      .toEqual(expect.arrayContaining([{ recurring_item_id: manual }, { recurring_item_id: confirmed }]));
    const transactions = (await db.query("SELECT id::text, forecast_event_id, amount, description, deleted_at FROM transactions ORDER BY id")).rows;
    expect(transactions).toHaveLength(2);
    expect(transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: actualId, forecast_event_id: originalLink.eventId,
        amount: 8000, description: "支出決裁による振替", deleted_at: null }),
      expect.objectContaining({ id: deletedActualId, forecast_event_id: links[5].eventId,
        amount: 2000, description: "支出決裁による返却", deleted_at: expect.any(Date) }),
    ]));
    expect((await db.query("SELECT balance, balance_offset FROM accounts WHERE id = $1", [account])).rows[0])
      .toEqual({ balance: 125000, balance_offset: 25000 });
    expect((await db.query("SELECT to_regclass('spending_ledgers') AS ledger, to_regclass('spending_ai_credentials') AS credentials")).rows[0])
      .toEqual({ ledger: null, credentials: null });
    expect((await db.query(`SELECT count(*)::integer AS count FROM information_schema.columns
      WHERE table_schema = current_schema() AND column_name = 'supplemental_budget_enabled'`)).rows[0].count).toBe(0);
  });
});

it("applies to an empty ledger database", async () => {
  await fixture(async (db) => {
    await db.query(migration);
    expect((await db.query("SELECT count(*)::integer AS count FROM recurring_items")).rows[0].count).toBe(0);
  });
});

it.each(["missing", "duplicate", "shape"])("stops before changing data for %s funding", async (kind) => {
  await fixture(async (db) => {
    const id = randomUUID();
    if (kind !== "missing") await schedule(db, id);
    const item = link(id);
    const requests = kind === "shape" ? [{ id: randomUUID(), fundingLinks: {} }]
      : [{ id: randomUUID(), fundingLinks: kind === "duplicate" ? [item, item] : [item] }];
    await db.query("INSERT INTO spending_ledgers VALUES (1, $1)", [JSON.stringify({ schemaVersion: 1, requests })]);
    await expect(db.query(migration)).rejects.toThrow();
    await db.query("ROLLBACK");
    expect((await db.query("SELECT count(*)::integer AS count FROM spending_ledgers")).rows[0].count).toBe(1);
    expect((await db.query("SELECT count(*)::integer AS count FROM recurring_items")).rows[0].count)
      .toBe(kind === "missing" ? 0 : 1);
    expect((await db.query("SELECT to_regclass('spending_ai_credentials') AS credentials")).rows[0].credentials)
      .not.toBeNull();
    expect((await db.query(`SELECT count(*)::integer AS count FROM information_schema.columns
      WHERE table_schema = current_schema() AND column_name = 'supplemental_budget_enabled'`)).rows[0].count).toBe(1);
  });
});
