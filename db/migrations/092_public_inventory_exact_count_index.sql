-- Match the complete public-inventory predicate used by the count service.
-- Migration 077 predated two launch-marker exclusions, so PostgreSQL could not
-- reliably use its partial bucket index for the stricter current predicate.

CREATE INDEX IF NOT EXISTS idx_properties_public_visible_bucket_count_v2
  ON properties (listing_type, students_welcome, property_type, price_period)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published')
    AND NOT (
      (COALESCE(title, '') ILIKE '%SOFT LAUNCH TEST - DELETE%' OR COALESCE(description, '') ILIKE '%SOFT LAUNCH TEST - DELETE%')
      OR (COALESCE(title, '') ILIKE '%QA TEST - DELETE%' OR COALESCE(description, '') ILIKE '%QA TEST - DELETE%')
      OR (COALESCE(title, '') ILIKE '%MAKAUG TRAINING%' OR COALESCE(description, '') ILIKE '%MAKAUG TRAINING%')
      OR (COALESCE(title, '') ILIKE '%REMOVE AFTER QA%' OR COALESCE(description, '') ILIKE '%REMOVE AFTER QA%')
      OR LOWER(TRIM(COALESCE(title, ''))) IN ('sdgsdgd', 'sgsgsgsgs')
      OR COALESCE(source, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
      OR COALESCE(listed_via, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
      OR COALESCE(lister_name, '') ~* '(qa test delete|qa owner|dummy|sample)'
      OR COALESCE(lister_email, '') ~* '(makaug\.invalid|test@|qa@|dummy|sample)'
      OR COALESCE(inquiry_reference, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
      OR COALESCE(extra_fields->>'qa_test_delete', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'soft_launch_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'is_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'launch_proof', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'non_public_test', '') ~* '^(true|1|yes)$'
    );

ANALYZE properties;
