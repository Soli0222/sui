CREATE TABLE "subscription_amount_changes" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscription_amount_changes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscription_amount_changes_subscription_id_effective_from_key" ON "subscription_amount_changes"("subscription_id", "effective_from");
ALTER TABLE "subscription_amount_changes" ADD CONSTRAINT "subscription_amount_changes_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
