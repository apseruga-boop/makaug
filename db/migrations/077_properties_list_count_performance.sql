-- Finish the public inventory performance work for the legacy list/count paths.
-- Migration 076 covered /api/properties/search; these indexes cover the older
-- /api/properties list/count and admin summary count predicates.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_properties_public_visible_created_id
  ON properties (created_at DESC, id DESC)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published')
    AND NOT (
      COALESCE(source, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
      OR COALESCE(listed_via, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
      OR COALESCE(lister_name, '') ~* '(qa test delete|qa owner|dummy|sample)'
      OR COALESCE(lister_email, '') ~* '(makaug\.invalid|test@|qa@|dummy|sample)'
      OR COALESCE(inquiry_reference, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
      OR COALESCE(extra_fields->>'qa_test_delete', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'soft_launch_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'is_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'launch_proof', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'non_public_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(title, '') ILIKE '%SOFT LAUNCH TEST - DELETE%'
      OR COALESCE(description, '') ILIKE '%SOFT LAUNCH TEST - DELETE%'
      OR COALESCE(title, '') ILIKE '%QA TEST - DELETE%'
      OR COALESCE(description, '') ILIKE '%QA TEST - DELETE%'
      OR LOWER(TRIM(COALESCE(title, ''))) IN ('sdgsdgd', 'sgsgsgsgs')
    );

CREATE INDEX IF NOT EXISTS idx_properties_public_visible_type_created_id
  ON properties (listing_type, created_at DESC, id DESC)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published')
    AND NOT (
      COALESCE(source, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
      OR COALESCE(listed_via, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
      OR COALESCE(lister_name, '') ~* '(qa test delete|qa owner|dummy|sample)'
      OR COALESCE(lister_email, '') ~* '(makaug\.invalid|test@|qa@|dummy|sample)'
      OR COALESCE(inquiry_reference, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
      OR COALESCE(extra_fields->>'qa_test_delete', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'soft_launch_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'is_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'launch_proof', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'non_public_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(title, '') ILIKE '%SOFT LAUNCH TEST - DELETE%'
      OR COALESCE(description, '') ILIKE '%SOFT LAUNCH TEST - DELETE%'
      OR COALESCE(title, '') ILIKE '%QA TEST - DELETE%'
      OR COALESCE(description, '') ILIKE '%QA TEST - DELETE%'
      OR LOWER(TRIM(COALESCE(title, ''))) IN ('sdgsdgd', 'sgsgsgsgs')
    );

CREATE INDEX IF NOT EXISTS idx_properties_public_visible_bucket_created_id
  ON properties (listing_type, students_welcome, property_type, price_period, created_at DESC, id DESC)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published')
    AND NOT (
      COALESCE(source, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
      OR COALESCE(listed_via, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
      OR COALESCE(lister_name, '') ~* '(qa test delete|qa owner|dummy|sample)'
      OR COALESCE(lister_email, '') ~* '(makaug\.invalid|test@|qa@|dummy|sample)'
      OR COALESCE(inquiry_reference, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
      OR COALESCE(extra_fields->>'qa_test_delete', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'soft_launch_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'is_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'launch_proof', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'non_public_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(title, '') ILIKE '%SOFT LAUNCH TEST - DELETE%'
      OR COALESCE(description, '') ILIKE '%SOFT LAUNCH TEST - DELETE%'
      OR COALESCE(title, '') ILIKE '%QA TEST - DELETE%'
      OR COALESCE(description, '') ILIKE '%QA TEST - DELETE%'
      OR LOWER(TRIM(COALESCE(title, ''))) IN ('sdgsdgd', 'sgsgsgsgs')
    );

CREATE INDEX IF NOT EXISTS idx_properties_public_visible_price_created_id
  ON properties (listing_type, price, created_at DESC, id DESC)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published')
    AND price IS NOT NULL
    AND price > 0
    AND price <= 100000000000
    AND NOT (
      COALESCE(source, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
      OR COALESCE(listed_via, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
      OR COALESCE(lister_name, '') ~* '(qa test delete|qa owner|dummy|sample)'
      OR COALESCE(lister_email, '') ~* '(makaug\.invalid|test@|qa@|dummy|sample)'
      OR COALESCE(inquiry_reference, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
      OR COALESCE(extra_fields->>'qa_test_delete', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'soft_launch_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'is_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'launch_proof', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'non_public_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(title, '') ILIKE '%SOFT LAUNCH TEST - DELETE%'
      OR COALESCE(description, '') ILIKE '%SOFT LAUNCH TEST - DELETE%'
      OR COALESCE(title, '') ILIKE '%QA TEST - DELETE%'
      OR COALESCE(description, '') ILIKE '%QA TEST - DELETE%'
      OR LOWER(TRIM(COALESCE(title, ''))) IN ('sdgsdgd', 'sgsgsgsgs')
    );

CREATE INDEX IF NOT EXISTS idx_properties_public_visible_district_created_id
  ON properties (LOWER(TRIM(COALESCE(district, ''))), created_at DESC, id DESC)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published')
    AND NOT (
      COALESCE(source, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
      OR COALESCE(listed_via, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
      OR COALESCE(lister_name, '') ~* '(qa test delete|qa owner|dummy|sample)'
      OR COALESCE(lister_email, '') ~* '(makaug\.invalid|test@|qa@|dummy|sample)'
      OR COALESCE(inquiry_reference, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
      OR COALESCE(extra_fields->>'qa_test_delete', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'soft_launch_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'is_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'launch_proof', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'non_public_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(title, '') ILIKE '%SOFT LAUNCH TEST - DELETE%'
      OR COALESCE(description, '') ILIKE '%SOFT LAUNCH TEST - DELETE%'
      OR COALESCE(title, '') ILIKE '%QA TEST - DELETE%'
      OR COALESCE(description, '') ILIKE '%QA TEST - DELETE%'
      OR LOWER(TRIM(COALESCE(title, ''))) IN ('sdgsdgd', 'sgsgsgsgs')
    );

CREATE INDEX IF NOT EXISTS idx_properties_public_visible_area_created_id
  ON properties (LOWER(TRIM(COALESCE(area, ''))), created_at DESC, id DESC)
  WHERE LOWER(COALESCE(status, '')) IN ('approved', 'live', 'published')
    AND NOT (
      COALESCE(source, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
      OR COALESCE(listed_via, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
      OR COALESCE(lister_name, '') ~* '(qa test delete|qa owner|dummy|sample)'
      OR COALESCE(lister_email, '') ~* '(makaug\.invalid|test@|qa@|dummy|sample)'
      OR COALESCE(inquiry_reference, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
      OR COALESCE(extra_fields->>'qa_test_delete', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'soft_launch_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'is_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'launch_proof', '') ~* '^(true|1|yes)$'
      OR COALESCE(extra_fields->>'non_public_test', '') ~* '^(true|1|yes)$'
      OR COALESCE(title, '') ILIKE '%SOFT LAUNCH TEST - DELETE%'
      OR COALESCE(description, '') ILIKE '%SOFT LAUNCH TEST - DELETE%'
      OR COALESCE(title, '') ILIKE '%QA TEST - DELETE%'
      OR COALESCE(description, '') ILIKE '%QA TEST - DELETE%'
      OR LOWER(TRIM(COALESCE(title, ''))) IN ('sdgsdgd', 'sgsgsgsgs')
    );

ANALYZE properties;
