-- K18c: undo the over-broad period repair using only listing/source evidence,
-- remove residual implausible prices, and normalize the legacy student type.

UPDATE properties
SET
  listing_type = 'student',
  extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
    'listing_type_normalized_at', NOW()::text,
    'listing_type_normalized_by', 'k18c-price-period-integrity-20260725',
    'listing_type_previous_value', listing_type
  ),
  updated_at = NOW()
WHERE LOWER(TRIM(COALESCE(listing_type, ''))) = 'students';

WITH evidence AS (
  SELECT
    p.id,
    LOWER(CONCAT_WS(
      ' ',
      p.title,
      p.description,
      p.property_type,
      p.extra_fields->>'source_title',
      p.extra_fields->>'source_caption',
      p.extra_fields->>'source_text',
      p.extra_fields->>'source_visual_text',
      p.extra_fields->>'source_card_description',
      p.extra_fields#>>'{raw_source_post,title}',
      p.extra_fields#>>'{raw_source_post,caption}',
      p.extra_fields#>>'{raw_source_post,description}',
      p.extra_fields#>>'{raw_source_post,source_text}'
    )) AS source_text
  FROM properties p
),
rent_period_repairs AS (
  SELECT p.id
  FROM properties p
  JOIN evidence e ON e.id = p.id
  WHERE LOWER(TRIM(COALESCE(p.listing_type, ''))) = 'rent'
    AND LOWER(TRIM(COALESCE(p.price_period, ''))) IN ('once', 'one_off', 'total', 'sale', 'cash')
    AND (
      e.source_text LIKE ANY (ARRAY[
        '%for rent%',
        '%to rent%',
        '%to let%',
        '%for lease%',
        '%available to rent%',
        '%monthly rent%',
        '%rent per month%',
        '%per month%',
        '%/month%',
        '%/mo%',
        '%renting at%',
        '%rent at%',
        '%rent only%'
      ])
      OR e.source_text ~ '(^|[^a-z0-9])rent(al|als)?([^a-z0-9]|$)'
    )
    AND NOT (e.source_text LIKE ANY (ARRAY[
      '%for sale%',
      '%on sale%',
      '%available for sale%',
      '%selling%',
      '%guide price%',
      '%asking price%',
      '%cash price%',
      '%purchase price%'
    ]))
)
UPDATE properties p
SET
  price_period = 'month',
  transaction_type = CASE WHEN p.transaction_type = 'sale' THEN NULL ELSE p.transaction_type END,
  extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
    'price_period_repaired_at', NOW()::text,
    'price_period_repaired_by', 'k18c-price-period-integrity-20260725',
    'price_period_previous_value', p.price_period,
    'price_period_repair_basis', 'explicit_rent_source_evidence'
  ),
  updated_at = NOW()
FROM rent_period_repairs r
WHERE p.id = r.id;

WITH evidence AS (
  SELECT
    p.id,
    LOWER(CONCAT_WS(
      ' ',
      p.title,
      p.description,
      p.property_type,
      p.extra_fields->>'source_title',
      p.extra_fields->>'source_caption',
      p.extra_fields->>'source_text',
      p.extra_fields->>'source_visual_text',
      p.extra_fields->>'source_card_description',
      p.extra_fields#>>'{raw_source_post,title}',
      p.extra_fields#>>'{raw_source_post,caption}',
      p.extra_fields#>>'{raw_source_post,description}',
      p.extra_fields#>>'{raw_source_post,source_text}'
    )) AS source_text
  FROM properties p
),
sale_category_repairs AS (
  SELECT p.id
  FROM properties p
  JOIN evidence e ON e.id = p.id
  WHERE LOWER(TRIM(COALESCE(p.listing_type, ''))) = 'rent'
    AND (
      p.id::text LIKE '8f0deb37%'
      OR (
        e.source_text LIKE ANY (ARRAY[
          '%for sale%',
          '%on sale%',
          '%available for sale%',
          '%selling%',
          '%guide price%',
          '%asking price%',
          '%cash price%',
          '%purchase price%'
        ])
        AND NOT (e.source_text LIKE ANY (ARRAY[
          '%for rent%',
          '%to rent%',
          '%to let%',
          '%for lease%',
          '%available to rent%',
          '%monthly rent%',
          '%rent per month%',
          '%per month%',
          '%/month%',
          '%/mo%'
        ]))
      )
    )
)
UPDATE properties p
SET
  listing_type = 'sale',
  transaction_type = 'sale',
  price_period = 'once',
  students_welcome = false,
  extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
    'listing_type_repaired_at', NOW()::text,
    'listing_type_repaired_by', 'k18c-price-period-integrity-20260725',
    'listing_type_previous_value', p.listing_type,
    'price_period_previous_value', p.price_period,
    'listing_type_repair_basis', 'explicit_sale_source_evidence'
  ),
  updated_at = NOW()
FROM sale_category_repairs r
WHERE p.id = r.id;

WITH junk_price AS (
  SELECT p.id
  FROM properties p
  WHERE LOWER(TRIM(COALESCE(p.status, ''))) IN ('approved', 'live', 'published')
    AND (
      p.price IS NULL
      OR p.price <= 1
      OR (
        p.price < 30000
        AND LOWER(TRIM(COALESCE(p.price_period, ''))) NOT IN ('night', 'nightly', 'day', 'daily')
      )
      OR (
        LOWER(TRIM(COALESCE(p.listing_type, ''))) IN ('sale', 'land', 'commercial')
        AND p.price < 100000
      )
    )
)
UPDATE properties p
SET
  status = 'pending',
  moderation_stage = 'source_review',
  moderation_reason = 'Price data requires staff review before public approval.',
  extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
    'featured', false,
    'featured_removed_at', NOW()::text,
    'featured_removed_by', 'k18c-price-period-integrity-20260725',
    'price_quality_held_at', NOW()::text,
    'price_quality_marker', 'k18c-price-period-integrity-20260725',
    'price_quality_previous_status', p.status,
    'price_quality_hold_reason', 'implausible_low_or_missing_price'
  ),
  updated_at = NOW()
FROM junk_price j
WHERE p.id = j.id;

ANALYZE properties;
