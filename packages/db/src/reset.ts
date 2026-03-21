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
