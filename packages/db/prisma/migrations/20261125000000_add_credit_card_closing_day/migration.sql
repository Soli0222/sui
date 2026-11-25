ALTER TABLE "credit_cards" ADD COLUMN "closing_day" INTEGER;

UPDATE "credit_cards" SET "closing_day" = 15 WHERE "name" = 'ANA JCB CARD FIRST';
UPDATE "credit_cards" SET "closing_day" = 31 WHERE "name" IN ('三井住友カード ゴールドNL', 'Amazon Master');
