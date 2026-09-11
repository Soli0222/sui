-- Retain approval history, confirmed transfers, and return-funds schedules.
UPDATE "recurring_items" AS item
SET "deleted_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
WHERE item."deleted_at" IS NULL
  AND item."enabled" = false
  AND EXISTS (
    SELECT 1
    FROM "spending_ledgers" AS ledger,
      jsonb_array_elements(ledger."data"->'requests') AS request,
      jsonb_array_elements(request->'fundingLinks') AS link
    WHERE request->>'status' = 'cancelled'
      AND link->>'returnOf' IS NULL
      AND link->>'recurringId' = item."id"::text
      AND NOT EXISTS (
        SELECT 1 FROM "transactions" AS actual
        WHERE actual."forecast_event_id" = link->>'eventId'
          AND actual."deleted_at" IS NULL
      )
  );
