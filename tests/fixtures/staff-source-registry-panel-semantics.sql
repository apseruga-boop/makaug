-- Synthetic source-registry fixture: shadows production rows, reads only.
WITH source_values(id,status,last_seen_at,last_checked_at,created_at) AS (
 VALUES
 ('fixture-a','active','2026-10-12T12:00:00Z'::timestamptz,'2026-10-15T12:00:00Z'::timestamptz,'2026-10-16T12:00:00Z'::timestamptz),
 ('fixture-b','candidate',NULL::timestamptz,'2026-10-14T12:00:00Z'::timestamptz,'2026-10-10T12:00:00Z'::timestamptz),
 ('fixture-c','review_needed',NULL::timestamptz,NULL::timestamptz,'2026-10-13T10:00:00Z'::timestamptz),
 ('fixture-d','active','2026-10-13T09:00:00Z'::timestamptz,'2026-10-15T12:00:00Z'::timestamptz,'2026-10-10T12:00:00Z'::timestamptz),
 ('fixture-e','paused','2026-10-17T12:00:00Z'::timestamptz,NULL::timestamptz,'2026-10-17T12:00:00Z'::timestamptz),
 ('fixture-f','blocked',NULL::timestamptz,'2026-10-18T12:00:00Z'::timestamptz,'2026-10-18T12:00:00Z'::timestamptz)
),
property_source_registry AS (
 SELECT id,id AS source_name,'fixture'::text AS platform,'fixture'::text AS source_type,
        NULL::text AS source_url,NULL::text AS handle,NULL::text AS contact_phone,
        NULL::text AS contact_phone_alt,NULL::text AS contact_email,
        ARRAY['fixture']::text[] AS districts,ARRAY['rent']::text[] AS listing_types,
        status,'fixture'::text AS trust_level,'fixture'::text AS consent_status,
        'fixture'::text AS scrape_policy,false AS can_contact_directly,
        last_seen_at,last_checked_at,'fixture only'::text AS notes,created_at
 FROM source_values
),
limited_panel AS (SELECT id, source_name, platform, source_type, source_url, handle, contact_phone, contact_phone_alt,
            contact_email, districts, listing_types, status, trust_level, consent_status, scrape_policy,
            can_contact_directly, last_seen_at, last_checked_at, notes
     FROM property_source_registry
     WHERE status IN ('active','candidate','review_needed')
     ORDER BY COALESCE(last_seen_at, last_checked_at, created_at) DESC
     LIMIT 3),
all_panel AS (SELECT id, source_name, platform, source_type, source_url, handle, contact_phone, contact_phone_alt,
            contact_email, districts, listing_types, status, trust_level, consent_status, scrape_policy,
            can_contact_directly, last_seen_at, last_checked_at, notes
     FROM property_source_registry
     WHERE status IN ('active','candidate','review_needed')
     ORDER BY COALESCE(last_seen_at, last_checked_at, created_at) DESC
     LIMIT 8),
index_eligible AS (SELECT id FROM property_source_registry WHERE status IN ('active', 'candidate', 'review_needed')),
eligibility_difference AS (
 (SELECT id FROM all_panel EXCEPT ALL SELECT id FROM index_eligible)
 UNION ALL (SELECT id FROM index_eligible EXCEPT ALL SELECT id FROM all_panel)
)
SELECT
 (SELECT COUNT(*)::int FROM limited_panel) AS limited_rows,
 ARRAY(SELECT id FROM limited_panel)=ARRAY['fixture-b','fixture-c','fixture-d'] AS exact_fallback_order_matches,
 ARRAY(SELECT id FROM all_panel)=ARRAY['fixture-b','fixture-c','fixture-d','fixture-a'] AS all_eligible_order_matches,
 (SELECT COUNT(*)::int FROM eligibility_difference) AS index_query_membership_difference,
 NOT EXISTS(SELECT 1 FROM all_panel WHERE id IN('fixture-e','fixture-f')) AS inactive_rows_excluded,
 (SELECT COUNT(*)::int FROM all_panel) AS eligible_rows;

