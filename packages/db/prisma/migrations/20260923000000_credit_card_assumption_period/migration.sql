CREATE TABLE "credit_card_assumptions" (
  "id" UUID NOT NULL,
  "credit_card_id" UUID NOT NULL,
  "amount" INTEGER NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "start_month" VARCHAR(7),
  "end_month" VARCHAR(7),
  CONSTRAINT "credit_card_assumptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "credit_card_assumptions_credit_card_id_idx" ON "credit_card_assumptions"("credit_card_id");
ALTER TABLE "credit_card_assumptions" ADD CONSTRAINT "credit_card_assumptions_credit_card_id_fkey"
  FOREIGN KEY ("credit_card_id") REFERENCES "credit_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "credit_card_assumptions" ("id", "credit_card_id", "amount", "sort_order", "start_month", "end_month")
SELECT gen_random_uuid(), "id", "assumption_amount", 0, NULL, NULL FROM "credit_cards";
