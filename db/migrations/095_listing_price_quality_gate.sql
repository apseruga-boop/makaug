WITH evidence AS (
  SELECT
    id,
    LOWER(CONCAT_WS(
      ' ',
      title,
      description,
      property_type,
      COALESCE(extra_fields, '{}'::jsonb)::text
    )) AS source_text
  FROM properties
),
sale_period_repairs AS (
  SELECT id
  FROM evidence
  WHERE source_text ~ '\m(for sale|on sale|available for sale|selling|guide price|asking price|cash price|purchase price)\M'
)
UPDATE properties p
SET
  price_period = 'once',
  transaction_type = CASE
    WHEN LOWER(COALESCE(p.listing_type, '')) IN ('commercial', 'land') THEN 'sale'
    ELSE p.transaction_type
  END,
  commercial_intent = CASE
    WHEN LOWER(COALESCE(p.listing_type, '')) = 'commercial' THEN 'sale'
    ELSE p.commercial_intent
  END,
  extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
    'price_quality_repaired_at', NOW()::text,
    'price_quality_marker', 'listing-price-quality-gate-20260725',
    'price_quality_repair_basis', 'explicit_source_sale_language'
  ),
  updated_at = NOW()
FROM sale_period_repairs r
WHERE p.id = r.id
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
      COALESCE(extra_fields, '{}'::jsonb)::text
    )) AS source_text
  FROM properties
),
confirmed_junk AS (
  SELECT p.id
  FROM properties p
  JOIN evidence e ON e.id = p.id
  WHERE LOWER(COALESCE(p.status, '')) IN ('approved', 'live', 'published')
    AND (
      (
        (p.price IS NULL OR p.price <= 1)
        AND e.source_text !~ '(ugx|ush|shs|usd|us\$)\s*[0-9]'
        AND e.source_text !~ '\$\s*[0-9]'
        AND e.source_text !~ '[0-9]+(\.[0-9]+)?\s*(bn|billion|billions|m|mn|million|millions|k|thousand|thousands)\M'
      )
      OR (
        LOWER(COALESCE(p.listing_type, '')) IN ('sale', 'land', 'commercial')
        AND COALESCE(p.price, 0) > 1
        AND COALESCE(p.price, 0) < 100000
      )
      OR (
        LOWER(COALESCE(p.listing_type, '')) = 'land'
        AND LOWER(COALESCE(p.price_period, '')) IN (
          'month', 'monthly', 'mo', 'per_month',
          'week', 'weekly', 'per_week',
          'night', 'nightly', 'day', 'daily'
        )
      )
      OR (
        COALESCE(p.price, 0) >= 100000000
        AND LOWER(COALESCE(p.price_period, '')) IN (
          'month', 'monthly', 'mo', 'per_month',
          'week', 'weekly', 'per_week',
          'night', 'nightly', 'day', 'daily'
        )
        AND COALESCE(p.extra_fields->>'price_basis_verified', '') <> 'true'
      )
    )
)
UPDATE properties p
SET
  status = 'pending',
  moderation_stage = 'source_review',
  featured = FALSE,
  moderation_reason = 'Price data requires staff review before public approval.',
  extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
    'price_quality_held_at', NOW()::text,
    'price_quality_marker', 'listing-price-quality-gate-20260725',
    'price_quality_previous_status', p.status,
    'price_quality_hold_reason', 'confirmed_junk_or_implausible_price_basis'
  ),
  updated_at = NOW()
FROM confirmed_junk j
WHERE p.id = j.id;

ANALYZE properties;
