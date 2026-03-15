CREATE TYPE "RecurringItemType" AS ENUM ('income', 'expense');
CREATE TYPE "TransactionType" AS ENUM ('income', 'expense', 'transfer');

CREATE TABLE "accounts" (
  "id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "balance" INTEGER NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recurring_items" (
  "id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "type" "RecurringItemType" NOT NULL,
  "amount" INTEGER NOT NULL,
  "day_of_month" INTEGER NOT NULL,
  "account_id" UUID,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "start_date" DATE,
  "end_date" DATE,
  "sort_order" INTEGER NOT NULL,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recurring_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_cards" (
  "id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "settlement_day" INTEGER,
  "account_id" UUID,
  "assumption_amount" INTEGER NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_cards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_card_billings" (
  "id" UUID NOT NULL,
  "year_month" VARCHAR(7) NOT NULL,
  "settlement_date" DATE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_card_billings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "credit_card_items" (
  "id" UUID NOT NULL,
  "billing_id" UUID NOT NULL,
  "credit_card_id" UUID NOT NULL,
  "amount" INTEGER NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_card_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "loans" (
  "id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "total_amount" INTEGER NOT NULL,
  "start_date" DATE NOT NULL,
  "payment_count" INTEGER NOT NULL,
  "account_id" UUID,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transactions" (
  "id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "transfer_to_account_id" UUID,
  "forecast_event_id" VARCHAR(100),
  "date" DATE NOT NULL,
  "type" "TransactionType" NOT NULL,
  "description" VARCHAR(200) NOT NULL,
  "amount" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "settings" (
  "key" VARCHAR(100) NOT NULL,
  "value" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "credit_card_billings_year_month_key" ON "credit_card_billings"("year_month");
CREATE UNIQUE INDEX "credit_card_items_billing_id_credit_card_id_key" ON "credit_card_items"("billing_id", "credit_card_id");
CREATE UNIQUE INDEX "transactions_forecast_event_id_key" ON "transactions"("forecast_event_id");

ALTER TABLE "credit_card_items"
  ADD CONSTRAINT "credit_card_items_billing_id_fkey"
  FOREIGN KEY ("billing_id") REFERENCES "credit_card_billings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "credit_card_items"
  ADD CONSTRAINT "credit_card_items_credit_card_id_fkey"
  FOREIGN KEY ("credit_card_id") REFERENCES "credit_cards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_transfer_to_account_id_fkey"
  FOREIGN KEY ("transfer_to_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "recurring_items"
  ADD CONSTRAINT "recurring_items_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "credit_cards"
  ADD CONSTRAINT "credit_cards_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "loans"
  ADD CONSTRAINT "loans_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
