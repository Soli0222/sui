ALTER TABLE "recurring_items" ADD COLUMN "interval" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "subscriptions" ADD COLUMN "interval" INTEGER NOT NULL DEFAULT 1;

UPDATE "subscriptions" SET "interval" = COALESCE("interval_months", 1);

ALTER TABLE "subscriptions" DROP COLUMN "interval_months";

ALTER TABLE "recurring_items"
  DROP CONSTRAINT IF EXISTS "recurring_items_recurrence_check",
  ADD CONSTRAINT "recurring_items_recurrence_check"
  CHECK (
    ("recurrence" = 'monthly' AND "day_of_month" IS NOT NULL AND "day_of_week" IS NULL)
    OR ("recurrence" = 'weekly' AND "day_of_week" IS NOT NULL AND "day_of_month" IS NULL)
  );

ALTER TABLE "subscriptions"
  DROP CONSTRAINT IF EXISTS "subscriptions_recurrence_check",
  ADD CONSTRAINT "subscriptions_recurrence_check"
  CHECK (
    ("recurrence" = 'monthly' AND "day_of_month" IS NOT NULL AND "day_of_week" IS NULL)
    OR ("recurrence" = 'weekly' AND "day_of_week" IS NOT NULL AND "day_of_month" IS NULL)
  );

ALTER TABLE "recurring_items"
  ADD CONSTRAINT "recurring_items_interval_check"
  CHECK ("interval" >= 1);

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_interval_check"
  CHECK ("interval" >= 1);

ALTER TABLE "recurring_items"
  ADD CONSTRAINT "recurring_items_interval_start_check"
  CHECK ("interval" = 1 OR "start_date" IS NOT NULL);

ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_interval_months_check";
