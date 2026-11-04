-- Partial index for the live half of the public inventory count.
-- services/publicInventoryMetricsService.js splits the count WHERE into a
-- live-status half and a sold-in-7-days half. This predicate is the live half
-- word for word (has_public_media, live status, NOT test listing), so the
-- planner drops the whole test-listing filter and reads only the four bucket
-- columns instead of de-TOASTing description and extra_fields on every row.
-- Keep it in sync with publicLaunchTestListingFastCondition('').
-- CONCURRENTLY: scripts/migrate.js runs this outside a transaction.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_public_live_bucket_count_v3
  ON properties (listing_type, students_welcome, property_type, price_period)
  WHERE has_public_media
    AND LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published')
    AND NOT (
    COALESCE(title, '') ILIKE '%SOFT LAUNCH TEST - DELETE%' OR COALESCE(title, '') ILIKE '%QA TEST - DELETE%' OR COALESCE(title, '') ILIKE '%MAKAUG TRAINING%' OR COALESCE(title, '') ILIKE '%REMOVE AFTER QA%'
    OR COALESCE(description, '') ~* '(SOFT LAUNCH TEST - DELETE|QA TEST - DELETE|MAKAUG TRAINING|REMOVE AFTER QA)'
    OR LOWER(TRIM(COALESCE(title, ''))) IN ('sdgsdgd', 'sgsgsgsgs')
    OR COALESCE(source, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(listed_via, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(lister_name, '') ~* '(qa test delete|qa owner|dummy|sample)'
    OR COALESCE(lister_email, '') ~* '(makaug\.invalid|test@|qa@|dummy|sample)'
    OR COALESCE(inquiry_reference, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
    OR (
      extra_fields ?| ARRAY['qa_test_delete', 'soft_launch_test', 'is_test', 'launch_proof', 'non_public_test']::text[]
      AND (
      COALESCE(extra_fields->>'qa_test_delete', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'soft_launch_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'is_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'launch_proof', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'non_public_test', '') ~* '^(true|1|yes)$'
      )
    )
  );
