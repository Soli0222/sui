-- Stop all old API processes and take both an export and a DB backup before applying.
-- All validation runs before the first persistent write. A failed check rolls back the migration.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM spending_ledgers
    WHERE jsonb_typeof(data->'requests') IS DISTINCT FROM 'array'
  ) THEN
    RAISE EXCEPTION 'Spending ledger has an unexpected requests shape';
  END IF;
  IF EXISTS (
    SELECT 1 FROM spending_ledgers AS ledger,
      jsonb_array_elements(ledger.data->'requests') AS request
    WHERE jsonb_typeof(request->'fundingLinks') IS DISTINCT FROM 'array'
  ) THEN
    RAISE EXCEPTION 'Spending ledger has an unexpected fundingLinks shape';
  END IF;
END $$;

CREATE TEMP TABLE _spending_links ON COMMIT DROP AS
SELECT request->>'id' AS request_id, link->>'id' AS link_id,
       link->>'recurringId' AS recurring_id, link->>'eventId' AS event_id,
       link->>'returnOf' AS return_of, link ? 'returnOf' AS has_return_of,
       link->'expected' AS link_expected
FROM spending_ledgers AS ledger,
     jsonb_array_elements(ledger.data->'requests') AS request,
     jsonb_array_elements(request->'fundingLinks') AS link;

DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(request_id || '/' || coalesce(link_id, '<missing>'), ', ')
  INTO bad FROM _spending_links
  WHERE request_id IS NULL OR link_id IS NULL OR recurring_id IS NULL OR event_id IS NULL
     OR has_return_of IS NOT TRUE
     OR jsonb_typeof(link_expected) IS DISTINCT FROM 'object'
     OR link_expected->>'date' IS NULL OR link_expected->>'amount' IS NULL
     OR link_expected->>'sourceId' IS NULL OR link_expected->>'destinationId' IS NULL
     OR recurring_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR link_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR event_id <> 'recurring:' || recurring_id || ':' || right(event_id, 7)
     OR right(event_id, 7) !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     OR event_id <> 'recurring:' || recurring_id || ':' || left(link_expected->>'date', 7);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Invalid spending funding links: %', bad; END IF;

  SELECT string_agg(request_id || '/' || link_id, ', ') INTO bad
  FROM _spending_links AS link
  WHERE EXISTS (SELECT 1 FROM _spending_links AS other
                WHERE other.ctid <> link.ctid AND
                  (other.link_id = link.link_id OR other.recurring_id = link.recurring_id OR other.event_id = link.event_id))
     OR (return_of IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM _spending_links AS original
       WHERE original.request_id = link.request_id AND original.link_id = link.return_of
         AND original.return_of IS NULL
     ));
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Duplicate or broken spending funding links: %', bad; END IF;

  SELECT string_agg(link.request_id || '/' || link.link_id, ', ') INTO bad
  FROM _spending_links AS link
  LEFT JOIN recurring_items AS item ON item.id::text = link.recurring_id
  WHERE item.id IS NULL OR item.type <> 'transfer' OR item.recurrence <> 'monthly'
     OR item.start_date IS NULL OR item.end_date IS NULL
     OR item.start_date <> item.end_date OR item.interval <> 1
     OR to_char(item.start_date, 'YYYY-MM') <> right(link.event_id, 7)
     OR to_char(item.start_date, 'YYYY-MM-DD') <> (link.link_expected->>'date')
     OR item.amount::text <> (link.link_expected->>'amount')
     OR item.account_id::text IS DISTINCT FROM (link.link_expected->>'sourceId')
     OR item.transfer_to_account_id::text IS DISTINCT FROM (link.link_expected->>'destinationId');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Missing or unexpected spending schedules: %', bad; END IF;

  SELECT string_agg(link.request_id || '/' || link.link_id, ', ') INTO bad
  FROM _spending_links AS link
  JOIN transactions AS actual
    ON actual.forecast_event_id LIKE 'recurring:' || link.recurring_id || ':%'
   AND actual.forecast_event_id <> link.event_id;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'Unexpected spending event references: %', bad; END IF;

END $$;

-- Both live and soft-deleted actual transactions preserve their source schedule.
UPDATE recurring_items AS item SET enabled = false, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
FROM _spending_links AS link
WHERE item.id::text = link.recurring_id
  AND EXISTS (SELECT 1 FROM transactions AS actual WHERE actual.forecast_event_id = link.event_id);

-- Unconfirmed schedules and their amount changes have no historical transaction to retain.
DELETE FROM recurring_items AS item USING _spending_links AS link
WHERE item.id::text = link.recurring_id
  AND NOT EXISTS (SELECT 1 FROM transactions AS actual WHERE actual.forecast_event_id = link.event_id);

DROP TABLE spending_ai_credentials;
DROP TABLE spending_ledgers;
ALTER TABLE accounts DROP COLUMN supplemental_budget_enabled;
COMMIT;
