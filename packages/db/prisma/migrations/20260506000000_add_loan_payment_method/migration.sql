CREATE TYPE "LoanPaymentMethod" AS ENUM ('account_withdrawal', 'credit_card');

ALTER TABLE "loans"
  ADD COLUMN "payment_method" "LoanPaymentMethod" NOT NULL DEFAULT 'account_withdrawal';
