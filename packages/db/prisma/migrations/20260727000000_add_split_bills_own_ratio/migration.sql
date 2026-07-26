-- Ensure transaction_splits.own_ratio exists for deployments that applied an earlier version of the split_bills migration.
ALTER TABLE "transaction_splits" ADD COLUMN IF NOT EXISTS "own_ratio" INTEGER;
