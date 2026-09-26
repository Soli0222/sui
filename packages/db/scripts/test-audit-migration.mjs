import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const execFileAsync = promisify(execFile);
const dbUrl = process.env.DATABASE_URL;
assert(dbUrl?.includes("sui_test"), "migration rehearsal requires the isolated test database");
const packageDir = fileURLToPath(new URL("../", import.meta.url));
const migrations = path.join(packageDir, "prisma/migrations");
const dropName = "20260926000000_drop_audit_logs";
const temp = await mkdtemp(path.join(packageDir, ".audit-migration-"));
const backup = path.join(temp, "before-drop.dump");
const archive = path.join(temp, "audit-history.csv");
const oldMigrations = path.join(temp, "migrations");
const config = path.join(temp, "prisma.config.ts");
let client = new pg.Client({ connectionString: dbUrl });

async function hasTable(name) {
  const result = await client.query("SELECT to_regclass($1) AS name", [`public.${name}`]);
  return result.rows[0].name !== null;
}

async function migrate(configPath) {
  const args = ["--filter", "@sui/db", "exec", "prisma", "migrate", "deploy"];
  if (configPath) args.push("--config", configPath);
  await execFileAsync("pnpm", args, { cwd: fileURLToPath(new URL("../../../", import.meta.url)) });
}

try {
  const names = (await readdir(migrations)).filter((name) => /^\d{14}_/.test(name)).sort();
  assert(names.includes(dropName));
  for (const name of names.filter((name) => name !== dropName)) {
    await cp(path.join(migrations, name), path.join(oldMigrations, name), { recursive: true });
  }
  await writeFile(config, `import { defineConfig } from "prisma/config";\nexport default defineConfig({ schema: ${JSON.stringify(path.join(packageDir, "prisma/schema.prisma"))}, migrations: { path: ${JSON.stringify(oldMigrations)} }, datasource: { url: process.env.DATABASE_URL } });\n`);
  await migrate(config);
  await client.connect();
  assert(await hasTable("audit_logs"));
  await client.query(`INSERT INTO accounts (id, name, balance, sort_order, created_at, updated_at)
    VALUES ('11111111-1111-4111-8111-111111111111', 'kept-account', 1234, 1, now(), now())`);
  await client.query(`INSERT INTO api_tokens (id, name, token_hash, read_only, created_at)
    VALUES ('22222222-2222-4222-8222-222222222222', 'kept-token', 'test-hash', false, now())`);
  await client.query(`INSERT INTO audit_logs (id, method, path, status, client_source, request_id)
    VALUES ('33333333-3333-4333-8333-333333333333', 'POST', '/api/accounts', 201, 'web', 'old-request')`);
  const before = await client.query("SELECT count(*)::int AS count, min(created_at) AS oldest, max(created_at) AS newest FROM audit_logs");
  assert.equal(before.rows[0].count, 1);
  assert(before.rows[0].oldest && before.rows[0].newest);
  const historyCount = (await client.query("SELECT count(*)::int AS count FROM _prisma_migrations")).rows[0].count;
  assert.equal(historyCount, names.length - 1);
  await execFileAsync("pg_dump", ["--dbname", dbUrl, "--format=custom", "--file", backup]);
  await execFileAsync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-c",
    `\\copy (SELECT * FROM audit_logs ORDER BY created_at, id) TO '${archive}' WITH CSV HEADER`]);
  const csv = await readFile(archive, "utf8");
  assert.equal(csv.trimEnd().split("\n").length - 1, before.rows[0].count);
  assert(csv.includes("old-request"));
  await migrate();
  assert.equal(await hasTable("audit_logs"), false);
  assert.equal((await client.query("SELECT balance FROM accounts WHERE name = 'kept-account'")).rows[0].balance, 1234);
  assert.equal((await client.query("SELECT name FROM api_tokens WHERE token_hash = 'test-hash'")).rows[0].name, "kept-token");
  assert(await hasTable("auth_sessions"));
  assert.equal((await client.query("SELECT count(*)::int AS count FROM _prisma_migrations")).rows[0].count, names.length);
  await client.end();
  await execFileAsync("pg_restore", ["--dbname", dbUrl, "--clean", "--if-exists", "--no-owner", backup]);
  client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  assert(await hasTable("audit_logs"));
  assert.equal((await client.query("SELECT count(*)::int AS count FROM audit_logs")).rows[0].count, 1);
  assert.equal((await client.query("SELECT count(*)::int AS count FROM _prisma_migrations")).rows[0].count, historyCount);
  assert.equal((await client.query("SELECT balance FROM accounts WHERE name = 'kept-account'")).rows[0].balance, 1234);
  await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await migrate();
  assert.equal(await hasTable("audit_logs"), false);
  assert(await hasTable("accounts"));
  assert(await hasTable("auth_sessions"));
  console.log("Migration rehearsal passed: archived 1 row, kept business/auth data, restored DB and Prisma history, applied all migrations to empty DB.");
} finally {
  await client.end().catch(() => {});
  await rm(temp, { recursive: true, force: true });
}
