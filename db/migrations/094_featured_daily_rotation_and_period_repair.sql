CREATE TABLE IF NOT EXISTS featured_rotation_runs (
  rotation_date DATE PRIMARY KEY,
  status TEXT NOT NULL CHECK (
    status IN ('completed', 'insufficient_clean_inventory', 'failed')
  ),
  selected_count INTEGER NOT NULL DEFAULT 0,
  selected_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  rejection_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_featured_rotation_runs_completed
  ON featured_rotation_runs (completed_at DESC);

COMMENT ON TABLE featured_rotation_runs IS
  'One auditable daily selection of two clean approved listings per public category.';

WITH evidence AS (
  SELECT
    id,
    LOWER(CONCAT_WS(
      ' ',
      title,
      description,
      property_type,
      extra_fields->>'source_title',
      extra_fields->>'source_caption',
      extra_fields->>'source_text',
      extra_fields->>'source_visual_text',
      extra_fields->>'source_card_description'
    )) AS source_text
  FROM properties
  WHERE listing_type IN ('commercial', 'land')
)
UPDATE properties p
SET
  price_period = 'once',
  transaction_type = 'sale',
  commercial_intent = CASE
    WHEN p.listing_type = 'commercial' THEN 'sale'
    ELSE p.commercial_intent
  END,
  extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
    'price_period_repaired_at', NOW()::text,
    'price_period_repair_marker', 'featured-daily-rotation-20260725',
    'price_period_repair_basis', 'explicit_source_sale_language'
  ),
  updated_at = NOW()
FROM evidence e
WHERE p.id = e.id
  AND e.source_text ~ '\m(for sale|on sale|available for sale|selling|asking price)\M'
  AND (
    p.listing_type = 'land'
    OR COALESCE(p.price, 0) >= 400000000
  )
  AND LOWER(COALESCE(p.price_period, '')) IN (
    'month', 'monthly', 'mo', 'per_month',
    'week', 'weekly', 'per_week',
    'night', 'nightly', 'day', 'daily'
  );

WITH evidence AS (
  SELECT
    id,
    LOWER(CONCAT_WS(
      ' ',
      title,
      description,
      property_type,
      extra_fields->>'source_title',
      extra_fields->>'source_caption',
      extra_fields->>'source_text',
      extra_fields->>'source_visual_text',
      extra_fields->>'source_card_description'
    )) AS source_text
  FROM properties
  WHERE listing_type = 'commercial'
)
UPDATE properties p
SET
  price_period = 'month',
  transaction_type = 'rent',
  commercial_intent = 'rent',
  extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
    'price_period_repaired_at', NOW()::text,
    'price_period_repair_marker', 'featured-daily-rotation-20260725',
    'price_period_repair_basis', 'explicit_source_rent_language'
  ),
  updated_at = NOW()
FROM evidence e
WHERE p.id = e.id
  AND e.source_text ~ '\m(for rent|to rent|to let|for lease|monthly rent|per month)\M'
  AND e.source_text !~ '\m(for sale|on sale|available for sale|selling|asking price)\M'
  AND LOWER(COALESCE(p.price_period, '')) IN ('once', 'one_off', 'total', 'sale', 'cash');

UPDATE properties
SET
  transaction_type = 'sale',
  extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
    'transaction_type_repaired_at', NOW()::text,
    'transaction_type_repair_marker', 'featured-daily-rotation-20260725'
  ),
  updated_at = NOW()
WHERE listing_type = 'land'
  AND LOWER(COALESCE(price_period, '')) IN ('once', 'one_off', 'total', 'sale', 'cash')
  AND transaction_type IS DISTINCT FROM 'sale';

UPDATE properties
SET
  price_period = 'once',
  transaction_type = 'sale',
  commercial_intent = 'sale',
  extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
    'price_period_repaired_at', NOW()::text,
    'price_period_repair_marker', 'featured-daily-rotation-20260725',
    'price_period_repair_basis', 'verified_source_video_says_on_sale'
  ),
  updated_at = NOW()
WHERE id::text LIKE 'b345d8e9%';

UPDATE properties
SET
  listing_type = 'sale',
  title = 'Rental property for sale in Fort Portal',
  district = 'Kabarole',
  area = 'Fort Portal',
  address = 'Fort Portal, Kabarole',
  price_period = 'once',
  transaction_type = NULL,
  property_type = 'Rental property',
  students_welcome = FALSE,
  nearest_university = NULL,
  distance_to_uni_km = NULL,
  extra_fields = COALESCE(extra_fields, '{}'::jsonb)
    - 'student_portal'
    - 'nearest_university'
    - 'student_campus'
    - 'student_university'
    || jsonb_build_object(
      'city', 'Fort Portal',
      'resolved_location_label', 'Fort Portal, Kabarole',
      'price_period_repaired_at', NOW()::text,
      'price_period_repair_marker', 'featured-daily-rotation-20260725',
      'price_period_repair_basis', 'verified_source_post_says_rental_property_for_sale',
      'classification_repaired_from', 'student'
    ),
  updated_at = NOW()
WHERE id::text LIKE '956ce9d6%';

UPDATE properties
SET
  district = 'Wakiso',
  extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
    'location_repaired_at', NOW()::text,
    'location_repair_marker', 'featured-daily-rotation-20260725',
    'location_repair_basis', 'Entebbe_is_in_Wakiso'
  ),
  updated_at = NOW()
WHERE id::text LIKE '39e9513e%';

ANALYZE properties;
