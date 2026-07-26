-- Make transaction_splits independent of bank account transactions.
-- Each split transaction has its own date, description, memo, and total amount.

ALTER TABLE "transaction_splits"
  ADD COLUMN "date" DATE,
  ADD COLUMN "description" VARCHAR(200),
  ADD COLUMN "memo" VARCHAR(200),
  ADD COLUMN "amount" INTEGER;

-- Backfill existing rows from the linked bank transaction.
UPDATE "transaction_splits" ts
SET
  "date" = t.date,
  "description" = t.description,
  "amount" = t.amount
FROM "transactions" t
WHERE ts.transaction_id = t.id;

ALTER TABLE "transaction_splits"
  ALTER COLUMN "date" SET NOT NULL,
  ALTER COLUMN "description" SET NOT NULL,
  ALTER COLUMN "amount" SET NOT NULL;

-- Remove the link to bank transactions.
ALTER TABLE "transaction_splits" DROP CONSTRAINT IF EXISTS "transaction_splits_transaction_id_fkey";
DROP INDEX IF EXISTS "transaction_splits_transaction_id_key";
ALTER TABLE "transaction_splits" DROP COLUMN IF EXISTS "transaction_id";
