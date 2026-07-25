-- K18c final repair: use original source evidence for price-period decisions.
-- Generated descriptions contain generic "guide price" boilerplate, so they
-- must not override explicit rent/sale/night wording in titles and captions.

CREATE TEMP TABLE k18c_period_evidence ON COMMIT DROP AS
SELECT
  p.id,
  LOWER(CONCAT_WS(
    ' ',
    p.title,
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
WHERE LOWER(TRIM(COALESCE(p.status, ''))) IN ('approved', 'live', 'published')
  AND LOWER(TRIM(COALESCE(p.listing_type, ''))) = 'rent'
  AND LOWER(TRIM(COALESCE(p.price_period, ''))) IN ('once', 'one_off', 'total', 'sale', 'cash');

ALTER TABLE k18c_period_evidence
  ADD COLUMN has_rent_evidence boolean NOT NULL DEFAULT false,
  ADD COLUMN has_sale_evidence boolean NOT NULL DEFAULT false,
  ADD COLUMN has_nightly_evidence boolean NOT NULL DEFAULT false;

UPDATE k18c_period_evidence
SET
  has_rent_evidence = (
    source_text LIKE ANY (ARRAY[
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
    OR source_text ~ '(^|[^a-z0-9])rent(al|als)?([^a-z0-9]|$)'
  ),
  has_sale_evidence = source_text LIKE ANY (ARRAY[
    '%for sale%',
    '%on sale%',
    '%available for sale%',
    '%selling%',
    '%guide price%',
    '%asking price%',
    '%cash price%',
    '%purchase price%'
  ]),
  has_nightly_evidence = source_text LIKE ANY (ARRAY[
    '%per night%',
    '%/night%',
    '%nightly%',
    '%per day%',
    '%/day%',
    '%daily rate%'
  ]);

UPDATE properties p
SET
  price_period = 'night',
  transaction_type = 'rent',
  extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
    'price_period_repaired_at', NOW()::text,
    'price_period_repaired_by', 'k18c-source-evidence-precedence-20260725',
    'price_period_previous_value', p.price_period,
    'price_period_repair_basis', 'explicit_nightly_source_evidence'
  ),
  updated_at = NOW()
FROM k18c_period_evidence e
WHERE p.id = e.id
  AND e.has_nightly_evidence;

UPDATE properties p
SET
  listing_type = 'sale',
  transaction_type = 'sale',
  price_period = 'once',
  students_welcome = false,
  extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
    'listing_type_repaired_at', NOW()::text,
    'listing_type_repaired_by', 'k18c-source-evidence-precedence-20260725',
    'listing_type_previous_value', p.listing_type,
    'price_period_previous_value', p.price_period,
    'listing_type_repair_basis', 'explicit_sale_source_evidence_without_rent'
  ),
  updated_at = NOW()
FROM k18c_period_evidence e
WHERE p.id = e.id
  AND e.has_sale_evidence
  AND NOT e.has_rent_evidence
  AND NOT e.has_nightly_evidence;

UPDATE properties p
SET
  price_period = 'month',
  transaction_type = 'rent',
  extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
    'price_period_repaired_at', NOW()::text,
    'price_period_repaired_by', 'k18c-source-evidence-precedence-20260725',
    'price_period_previous_value', p.price_period,
    'price_period_repair_basis', 'explicit_rent_source_evidence_without_sale'
  ),
  updated_at = NOW()
FROM k18c_period_evidence e
WHERE p.id = e.id
  AND e.has_rent_evidence
  AND NOT e.has_sale_evidence
  AND NOT e.has_nightly_evidence;

-- A rent-category row with a one-off period and no unambiguous source basis
-- must not remain public. Preserve it for staff review instead of guessing.
UPDATE properties p
SET
  status = 'pending',
  moderation_stage = 'source_review',
  moderation_reason = 'Rent transaction or price period needs staff verification.',
  extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
    'price_period_review_held_at', NOW()::text,
    'price_period_review_held_by', 'k18c-source-evidence-precedence-20260725',
    'price_period_previous_value', p.price_period,
    'price_period_review_reason', CASE
      WHEN e.has_rent_evidence AND e.has_sale_evidence THEN 'conflicting_rent_sale_source_evidence'
      ELSE 'missing_explicit_price_period_source_evidence'
    END
  ),
  updated_at = NOW()
FROM k18c_period_evidence e
WHERE p.id = e.id
  AND LOWER(TRIM(COALESCE(p.listing_type, ''))) = 'rent'
  AND LOWER(TRIM(COALESCE(p.price_period, ''))) IN ('once', 'one_off', 'total', 'sale', 'cash');

ANALYZE properties;
