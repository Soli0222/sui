CREATE TABLE "subscriptions" (
  "id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "amount" INTEGER NOT NULL,
  "interval_months" INTEGER NOT NULL,
  "start_date" DATE NOT NULL,
  "day_of_month" INTEGER NOT NULL,
  "end_date" DATE,
  "payment_source" VARCHAR(100),
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);
