-- Read-only inventory before the irreversible spending removal migration.
-- Run against a backed-up, stopped deployment: psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f scripts/spending-removal-preview.sql
WITH links AS (
  SELECT request->>'id' AS request_id,
         link->>'recurringId' AS recurring_id, link->>'eventId' AS event_id,
         link->>'returnOf' AS return_of, request->>'status' AS request_status,
         request->>'deletedAt' AS request_deleted_at,
         link->'expected'->>'amount' AS expected_amount,
         link->'expected'->>'date' AS expected_date
  FROM spending_ledgers AS ledger,
    jsonb_array_elements(CASE WHEN jsonb_typeof(ledger.data->'requests') = 'array'
      THEN ledger.data->'requests' ELSE '[]'::jsonb END) AS request,
    jsonb_array_elements(CASE WHEN jsonb_typeof(request->'fundingLinks') = 'array'
      THEN request->'fundingLinks' ELSE '[]'::jsonb END) AS link
), classified AS (
  SELECT links.*, item.id IS NOT NULL AS schedule_exists,
         EXISTS (SELECT 1 FROM transactions AS actual
                 WHERE actual.forecast_event_id = links.event_id) AS has_actual
  FROM links LEFT JOIN recurring_items AS item ON item.id::text = links.recurring_id
)
SELECT (SELECT count(*) FROM spending_ledgers) AS ledgers,
       (SELECT count(*) FROM spending_ai_credentials) AS saved_ai_credentials,
       (SELECT count(*) FROM accounts WHERE supplemental_budget_enabled) AS flagged_accounts,
       (SELECT coalesce(sum(jsonb_array_length(CASE WHEN jsonb_typeof(data->'requests') = 'array'
         THEN data->'requests' ELSE '[]'::jsonb END)), 0) FROM spending_ledgers) AS requests,
       count(*) AS funding_links,
       count(*) FILTER (WHERE return_of IS NOT NULL) AS return_links,
       count(*) FILTER (WHERE request_status IN ('cancelled', 'expired') OR request_deleted_at IS NOT NULL) AS cancelled_expired_or_deleted_links,
       count(*) FILTER (WHERE NOT schedule_exists) AS missing_schedules,
       count(*) FILTER (WHERE has_actual) AS schedules_to_disable,
       count(*) FILTER (WHERE NOT has_actual) AS schedules_to_delete,
       coalesce(jsonb_agg(jsonb_build_object('requestId', request_id,
         'recurringId', recurring_id, 'eventId', event_id, 'returnOf', return_of,
         'status', request_status, 'expectedAmount', expected_amount,
         'expectedDate', expected_date)) FILTER (WHERE has_actual), '[]'::jsonb) AS disabled_schedule_list,
       coalesce(jsonb_agg(jsonb_build_object('requestId', request_id,
         'recurringId', recurring_id, 'eventId', event_id, 'returnOf', return_of,
         'status', request_status, 'expectedAmount', expected_amount,
         'expectedDate', expected_date)) FILTER (WHERE NOT has_actual), '[]'::jsonb) AS deleted_schedule_list
FROM classified;
