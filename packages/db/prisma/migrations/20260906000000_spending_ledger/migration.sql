ALTER TABLE "accounts" ADD COLUMN "supplemental_budget_enabled" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "spending_ledgers" (
  "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
  "version" INTEGER NOT NULL DEFAULT 0,
  "data" JSONB NOT NULL CHECK ("data"->>'schemaVersion' = '1'),
  "updated_at" TIMESTAMP(3) NOT NULL
);
