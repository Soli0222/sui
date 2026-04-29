CREATE TYPE "DateShiftPolicy" AS ENUM ('none', 'previous', 'next');

ALTER TABLE "recurring_items"
  ADD COLUMN "date_shift_policy" "DateShiftPolicy" NOT NULL DEFAULT 'none';

ALTER TABLE "credit_cards"
  ADD COLUMN "date_shift_policy" "DateShiftPolicy" NOT NULL DEFAULT 'none';

ALTER TABLE "loans"
  ADD COLUMN "date_shift_policy" "DateShiftPolicy" NOT NULL DEFAULT 'none';
