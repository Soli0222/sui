-- AddRecurrence

-- Create the shared recurrence enum
CREATE TYPE "Recurrence" AS ENUM ('monthly', 'weekly');

-- Add recurrence fields to recurring_items and subscriptions
ALTER TABLE "recurring_items"
  ADD COLUMN "recurrence" "Recurrence" NOT NULL DEFAULT 'monthly',
  ADD COLUMN "day_of_week" INTEGER,
  ALTER COLUMN "day_of_month" DROP NOT NULL;

ALTER TABLE "subscriptions"
  ADD COLUMN "recurrence" "Recurrence" NOT NULL DEFAULT 'monthly',
  ADD COLUMN "day_of_week" INTEGER,
  ALTER COLUMN "day_of_month" DROP NOT NULL,
  ALTER COLUMN "interval_months" DROP NOT NULL;

-- Existing rows are treated as monthly, so keep their values and clear day_of_week
UPDATE "recurring_items" SET "day_of_week" = NULL WHERE "recurrence" = 'monthly';
UPDATE "subscriptions" SET "day_of_week" = NULL WHERE "recurrence" = 'monthly';

-- Ensure subscriptions with monthly recurrence have a valid interval_months
UPDATE "subscriptions" SET "interval_months" = 1 WHERE "interval_months" IS NULL AND "recurrence" = 'monthly';

-- CHECK constraints to keep recurrence and its fields consistent
ALTER TABLE "recurring_items"
  ADD CONSTRAINT "recurring_items_recurrence_check"
  CHECK (
    ("recurrence" = 'monthly' AND "day_of_month" IS NOT NULL AND "day_of_week" IS NULL)
    OR ("recurrence" = 'weekly' AND "day_of_week" IS NOT NULL AND "day_of_month" IS NULL)
  );

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_recurrence_check"
  CHECK (
    ("recurrence" = 'monthly' AND "day_of_month" IS NOT NULL AND "day_of_week" IS NULL AND "interval_months" IS NOT NULL)
    OR ("recurrence" = 'weekly' AND "day_of_week" IS NOT NULL AND "day_of_month" IS NULL AND "interval_months" IS NULL)
  );

-- Range checks for the new fields
ALTER TABLE "recurring_items"
  ADD CONSTRAINT "recurring_items_day_of_month_check"
  CHECK ("day_of_month" IS NULL OR ("day_of_month" >= 1 AND "day_of_month" <= 31)),
  ADD CONSTRAINT "recurring_items_day_of_week_check"
  CHECK ("day_of_week" IS NULL OR ("day_of_week" >= 0 AND "day_of_week" <= 6));

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_day_of_month_check"
  CHECK ("day_of_month" IS NULL OR ("day_of_month" >= 1 AND "day_of_month" <= 31)),
  ADD CONSTRAINT "subscriptions_day_of_week_check"
  CHECK ("day_of_week" IS NULL OR ("day_of_week" >= 0 AND "day_of_week" <= 6));

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_interval_months_check"
  CHECK ("interval_months" IS NULL OR "interval_months" > 0);
