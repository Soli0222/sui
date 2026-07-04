ALTER TYPE "TransactionType" ADD VALUE 'adjustment';

ALTER TABLE "accounts"
  ADD COLUMN "last_reconciled_at" TIMESTAMP(3);
