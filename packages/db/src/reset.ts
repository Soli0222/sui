import { DEFAULT_SETTINGS } from "@sui/shared";

import type { PrismaClient } from "./generated/prisma/client.mts";

const DATA_TABLES = [
  "transactions",
  "settlement_allocations",
  "settlements",
  "split_shares",
  "transaction_splits",
  "people",
  "credit_card_items",
  "credit_card_billings",
  "recurring_items",
  "subscriptions",
  "credit_cards",
  "loans",
  "accounts",
  "audit_logs",
  "settings",
];

const AUTH_TABLES = ["auth_sessions", "api_tokens"];

function buildTruncateSql(tables: string[]) {
  const joined = tables.map((table) => `"${table}"`).join(",\n    ");
  return `
  TRUNCATE TABLE
    ${joined}
  RESTART IDENTITY CASCADE
`;
}

const TRUNCATE_DATA_TABLES_SQL = buildTruncateSql(DATA_TABLES);
const TRUNCATE_TABLES_SQL = buildTruncateSql([
  ...DATA_TABLES.slice(0, DATA_TABLES.length - 1),
  ...AUTH_TABLES,
  DATA_TABLES[DATA_TABLES.length - 1],
]);

async function seedDefaultSettings(prisma: PrismaClient) {
  await prisma.setting.createMany({
    data: Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({
      key,
      value,
    })),
  });
}

export async function resetDatabase(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(TRUNCATE_TABLES_SQL);
  await seedDefaultSettings(prisma);
}

export async function resetDatabaseForE2e(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(TRUNCATE_DATA_TABLES_SQL);
  await seedDefaultSettings(prisma);
}

export async function resetAuth(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(buildTruncateSql(AUTH_TABLES));
}
