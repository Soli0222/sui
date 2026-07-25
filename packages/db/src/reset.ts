import { DEFAULT_SETTINGS } from "@sui/shared";

import type { PrismaClient } from "./generated/prisma/client.mts";

const TRUNCATE_TABLES_SQL = `
  TRUNCATE TABLE
    "transactions",
    "credit_card_items",
    "credit_card_billings",
    "recurring_items",
    "subscriptions",
    "credit_cards",
    "loans",
    "accounts",
    "audit_logs",
    "auth_sessions",
    "api_tokens",
    "settings"
  RESTART IDENTITY CASCADE
`;

const TRUNCATE_DATA_TABLES_SQL = `
  TRUNCATE TABLE
    "transactions",
    "credit_card_items",
    "credit_card_billings",
    "recurring_items",
    "subscriptions",
    "credit_cards",
    "loans",
    "accounts",
    "audit_logs",
    "settings"
  RESTART IDENTITY CASCADE
`;

export async function resetDatabase(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(TRUNCATE_TABLES_SQL);
  await prisma.setting.createMany({
    data: Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({
      key,
      value,
    })),
  });
}

export async function resetDatabaseForE2e(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(TRUNCATE_DATA_TABLES_SQL);
  await prisma.setting.createMany({
    data: Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({
      key,
      value,
    })),
  });
}

export async function resetAuth(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "auth_sessions",
      "api_tokens"
    RESTART IDENTITY CASCADE
  `);
}
