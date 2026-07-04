ALTER TYPE "RecurringItemType" ADD VALUE 'transfer';

ALTER TABLE "recurring_items"
  ADD COLUMN "transfer_to_account_id" UUID;

ALTER TABLE "recurring_items"
  ADD CONSTRAINT "recurring_items_transfer_to_account_id_fkey"
  FOREIGN KEY ("transfer_to_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
