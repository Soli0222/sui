CREATE TABLE "recurring_item_amount_changes" (
    "id" UUID NOT NULL,
    "recurring_item_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "recurring_item_amount_changes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recurring_item_amount_changes_recurring_item_id_effective_from_key" ON "recurring_item_amount_changes"("recurring_item_id", "effective_from");
ALTER TABLE "recurring_item_amount_changes" ADD CONSTRAINT "recurring_item_amount_changes_recurring_item_id_fkey" FOREIGN KEY ("recurring_item_id") REFERENCES "recurring_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
