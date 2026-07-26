CREATE TYPE "SplitMethod" AS ENUM ('equal', 'ratio', 'amount');

CREATE TYPE "SettlementKind" AS ENUM ('transaction', 'offset');

CREATE TABLE "people" (
  "id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "memo" VARCHAR(200),
  "sort_order" INTEGER NOT NULL,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transaction_splits" (
  "id" UUID NOT NULL,
  "transaction_id" UUID NOT NULL,
  "method" "SplitMethod" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transaction_splits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "split_shares" (
  "id" UUID NOT NULL,
  "split_id" UUID NOT NULL,
  "person_id" UUID NOT NULL,
  "ratio" INTEGER,
  "amount" INTEGER NOT NULL,
  CONSTRAINT "split_shares_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "settlements" (
  "id" UUID NOT NULL,
  "kind" "SettlementKind" NOT NULL,
  "person_id" UUID NOT NULL,
  "transaction_id" UUID,
  "date" DATE NOT NULL,
  "note" VARCHAR(200),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "settlement_allocations" (
  "id" UUID NOT NULL,
  "settlement_id" UUID NOT NULL,
  "share_id" UUID NOT NULL,
  "amount" INTEGER NOT NULL,
  CONSTRAINT "settlement_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "transaction_splits_transaction_id_key" ON "transaction_splits"("transaction_id");
CREATE UNIQUE INDEX "split_shares_split_id_person_id_key" ON "split_shares"("split_id", "person_id");
CREATE UNIQUE INDEX "settlement_allocations_settlement_id_share_id_key" ON "settlement_allocations"("settlement_id", "share_id");

ALTER TABLE "transaction_splits"
  ADD CONSTRAINT "transaction_splits_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "split_shares"
  ADD CONSTRAINT "split_shares_split_id_fkey"
  FOREIGN KEY ("split_id") REFERENCES "transaction_splits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "split_shares"
  ADD CONSTRAINT "split_shares_person_id_fkey"
  FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_person_id_fkey"
  FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_transaction_id_fkey"
  FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "settlement_allocations"
  ADD CONSTRAINT "settlement_allocations_settlement_id_fkey"
  FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "settlement_allocations"
  ADD CONSTRAINT "settlement_allocations_share_id_fkey"
  FOREIGN KEY ("share_id") REFERENCES "split_shares"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
