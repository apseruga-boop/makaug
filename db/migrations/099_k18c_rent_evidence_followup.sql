-- K18c follow-up: migration 098's grouped word-boundary expression did not
-- match many caption phrases in PostgreSQL. Re-run the repair with explicit
-- phrase matching while keeping sale evidence as a hard exclusion.

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
    'price_period_repaired_by', 'k18c-rent-evidence-followup-20260725',
    'price_period_previous_value', p.price_period,
    'price_period_repair_basis', 'explicit_rent_source_evidence_v2'
  ),
  updated_at = NOW()
FROM rent_period_repairs r
WHERE p.id = r.id;

ANALYZE properties;
