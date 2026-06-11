CREATE TYPE "PersonalDebtDirection" AS ENUM ('lent', 'borrowed');
CREATE TYPE "PersonalDebtOrigin" AS ENUM ('cash_loan', 'reimbursement');
CREATE TYPE "PersonalDebtStatus" AS ENUM ('open', 'settled', 'canceled');
CREATE TYPE "PersonalDebtSourceType" AS ENUM ('manual', 'split_bill');
CREATE TYPE "SplitBillPayerType" AS ENUM ('self', 'other');
CREATE TYPE "SplitBillMethod" AS ENUM ('equal');
CREATE TYPE "SplitBillStatus" AS ENUM ('open', 'settled', 'canceled');

CREATE TABLE "personal_debts" (
  "id" UUID NOT NULL,
  "direction" "PersonalDebtDirection" NOT NULL,
  "origin" "PersonalDebtOrigin" NOT NULL DEFAULT 'cash_loan',
  "counterparty_name" VARCHAR(100) NOT NULL,
  "title" VARCHAR(100) NOT NULL,
  "principal_amount" INTEGER NOT NULL,
  "opened_date" DATE NOT NULL,
  "due_date" DATE,
  "account_id" UUID NOT NULL,
  "status" "PersonalDebtStatus" NOT NULL DEFAULT 'open',
  "source_type" "PersonalDebtSourceType" NOT NULL DEFAULT 'manual',
  "split_bill_id" UUID,
  "opening_transaction_id" UUID,
  "memo" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_debts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "personal_debt_settlements" (
  "id" UUID NOT NULL,
  "debt_id" UUID NOT NULL,
  "date" DATE NOT NULL,
  "amount" INTEGER NOT NULL,
  "account_id" UUID NOT NULL,
  "transaction_id" UUID NOT NULL,
  "memo" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_debt_settlements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "split_bills" (
  "id" UUID NOT NULL,
  "title" VARCHAR(100) NOT NULL,
  "total_amount" INTEGER NOT NULL,
  "paid_date" DATE NOT NULL,
  "payer_type" "SplitBillPayerType" NOT NULL,
  "payer_name" VARCHAR(100),
  "account_id" UUID NOT NULL,
  "split_method" "SplitBillMethod" NOT NULL DEFAULT 'equal',
  "due_date" DATE,
  "payment_transaction_id" UUID,
  "status" "SplitBillStatus" NOT NULL DEFAULT 'open',
  "memo" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "split_bills_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "split_bill_participants" (
  "id" UUID NOT NULL,
  "split_bill_id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "is_self" BOOLEAN NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "share_amount" INTEGER NOT NULL,
  "personal_debt_id" UUID,
  CONSTRAINT "split_bill_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "personal_debts_opening_transaction_id_key" ON "personal_debts"("opening_transaction_id");
CREATE UNIQUE INDEX "personal_debt_settlements_transaction_id_key" ON "personal_debt_settlements"("transaction_id");
CREATE UNIQUE INDEX "split_bills_payment_transaction_id_key" ON "split_bills"("payment_transaction_id");
CREATE UNIQUE INDEX "split_bill_participants_personal_debt_id_key" ON "split_bill_participants"("personal_debt_id");

ALTER TABLE "personal_debts" ADD CONSTRAINT "personal_debts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "personal_debts" ADD CONSTRAINT "personal_debts_split_bill_id_fkey" FOREIGN KEY ("split_bill_id") REFERENCES "split_bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "personal_debts" ADD CONSTRAINT "personal_debts_opening_transaction_id_fkey" FOREIGN KEY ("opening_transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "personal_debt_settlements" ADD CONSTRAINT "personal_debt_settlements_debt_id_fkey" FOREIGN KEY ("debt_id") REFERENCES "personal_debts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "personal_debt_settlements" ADD CONSTRAINT "personal_debt_settlements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "personal_debt_settlements" ADD CONSTRAINT "personal_debt_settlements_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "split_bills" ADD CONSTRAINT "split_bills_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "split_bills" ADD CONSTRAINT "split_bills_payment_transaction_id_fkey" FOREIGN KEY ("payment_transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "split_bill_participants" ADD CONSTRAINT "split_bill_participants_split_bill_id_fkey" FOREIGN KEY ("split_bill_id") REFERENCES "split_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "split_bill_participants" ADD CONSTRAINT "split_bill_participants_personal_debt_id_fkey" FOREIGN KEY ("personal_debt_id") REFERENCES "personal_debts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
