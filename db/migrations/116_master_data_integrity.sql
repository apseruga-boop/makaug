-- Master property data-integrity guardrails.
--
-- Canonical monetary values are always UGX. Source amount/currency remain
-- separate provenance. This migration never publishes inventory: any row that
-- needs judgement is returned to source review with its previous state and
-- proposed repair recorded for a human moderator.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS price_original_currency TEXT,
  ADD COLUMN IF NOT EXISTS price_on_application BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE properties
SET price_original_currency = CASE
      WHEN UPPER(COALESCE(price_currency, '')) = 'USD' THEN 'USD'
      WHEN UPPER(COALESCE(extra_fields->>'price_original_currency', '')) IN ('UGX', 'USD')
        THEN UPPER(extra_fields->>'price_original_currency')
      WHEN UPPER(COALESCE(extra_fields->>'source_price_currency', '')) IN ('UGX', 'USD')
        THEN UPPER(extra_fields->>'source_price_currency')
      ELSE 'UGX'
    END,
    price_currency = 'UGX',
    price_on_application = CASE
      WHEN price IS NOT NULL AND price > 0 THEN FALSE
      ELSE COALESCE(price_on_application, FALSE)
        OR LOWER(COALESCE(extra_fields->>'price_on_application', '')) IN ('true', '1', 'yes')
        OR LOWER(COALESCE(extra_fields->>'price_upon_application', '')) IN ('true', '1', 'yes')
        OR CONCAT_WS(' ', extra_fields->>'price_label', extra_fields->>'source_price_label')
          ~* '(^|[^a-z])(poa|price[[:space:]]+(upon[[:space:]]+application|on[[:space:]]+request))([^a-z]|$)'
    END,
    extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
      'price_currency', 'UGX',
      'price_original_currency', CASE
        WHEN UPPER(COALESCE(price_currency, '')) = 'USD' THEN 'USD'
        WHEN UPPER(COALESCE(extra_fields->>'price_original_currency', '')) IN ('UGX', 'USD')
          THEN UPPER(extra_fields->>'price_original_currency')
        WHEN UPPER(COALESCE(extra_fields->>'source_price_currency', '')) IN ('UGX', 'USD')
          THEN UPPER(extra_fields->>'source_price_currency')
        ELSE 'UGX'
      END,
      'price_on_application', CASE
        WHEN price IS NOT NULL AND price > 0 THEN FALSE
        ELSE COALESCE(price_on_application, FALSE)
          OR LOWER(COALESCE(extra_fields->>'price_on_application', '')) IN ('true', '1', 'yes')
          OR LOWER(COALESCE(extra_fields->>'price_upon_application', '')) IN ('true', '1', 'yes')
          OR CONCAT_WS(' ', extra_fields->>'price_label', extra_fields->>'source_price_label')
            ~* '(^|[^a-z])(poa|price[[:space:]]+(upon[[:space:]]+application|on[[:space:]]+request))([^a-z]|$)'
      END,
      'price_integrity_marker', 'master-data-integrity-116'
    )
WHERE price_original_currency IS NULL
   OR price_currency IS DISTINCT FROM 'UGX'
   OR price_on_application IS DISTINCT FROM (
     CASE WHEN price IS NOT NULL AND price > 0 THEN FALSE ELSE
       COALESCE(price_on_application, FALSE)
       OR LOWER(COALESCE(extra_fields->>'price_on_application', '')) IN ('true', '1', 'yes')
       OR LOWER(COALESCE(extra_fields->>'price_upon_application', '')) IN ('true', '1', 'yes')
       OR CONCAT_WS(' ', extra_fields->>'price_label', extra_fields->>'source_price_label')
         ~* '(^|[^a-z])(poa|price[[:space:]]+(upon[[:space:]]+application|on[[:space:]]+request))([^a-z]|$)'
     END
   );

-- Correct repeated FX multiplication only when the preserved source amount and
-- rate produce a positive canonical value inside the safety clamp.
UPDATE properties
SET price = ROUND(price_original * price_fx_rate_ugx),
    extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
      'price_fx_magnitude_repaired', TRUE,
      'price_fx_magnitude_repaired_at', NOW(),
      'price_fx_magnitude_previous_value', price,
      'price_conversion_basis', 'Original USD amount multiplied once by the stored UGX FX rate.'
    ),
    updated_at = NOW()
WHERE price_original_currency = 'USD'
  AND price_original > 0
  AND price_fx_rate_ugx BETWEEN 1000 AND 10000
  AND ROUND(price_original * price_fx_rate_ugx) BETWEEN 1 AND 100000000000
  AND price IS DISTINCT FROM ROUND(price_original * price_fx_rate_ugx);

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_price_currency_supported;
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_price_original_currency_supported;

ALTER TABLE properties
  ALTER COLUMN price_currency SET DEFAULT 'UGX',
  ALTER COLUMN price_currency SET NOT NULL,
  ADD CONSTRAINT properties_price_currency_supported CHECK (price_currency = 'UGX'),
  ADD CONSTRAINT properties_price_original_currency_supported
    CHECK (price_original_currency IS NULL OR price_original_currency IN ('UGX', 'USD'));

CREATE INDEX IF NOT EXISTS idx_properties_price_on_application_status
  ON properties (price_on_application, status, created_at DESC);

CREATE TEMP TABLE integrity_review_116 (
  id UUID PRIMARY KEY,
  previous_status TEXT,
  issue_codes TEXT[],
  proposed_listing_type TEXT,
  proposed_price_period TEXT
) ON COMMIT DROP;

WITH evidence AS (
  SELECT
    p.*,
    LOWER(CONCAT_WS(' ', p.title, p.description, p.property_type, p.address, p.area,
      p.extra_fields->>'source_title', p.extra_fields->>'source_caption',
      p.extra_fields->>'source_text', p.extra_fields->>'source_visual_text')) AS source_evidence,
    LOWER(TRIM(COALESCE(p.listing_type, ''))) AS stored_type,
    LOWER(TRIM(COALESCE(p.price_period, ''))) AS stored_period,
    LOWER(TRIM(COALESCE(p.transaction_type, ''))) AS stored_transaction
  FROM properties p
  WHERE COALESCE(p.status, '') NOT IN ('deleted', 'rejected', 'declined', 'fraud', 'archived')
), classified AS (
  SELECT e.*,
    CASE
      WHEN source_evidence ~ '(student[[:space:]]+(accommodation|hostel|room)|hostel[[:space:]]+(room|bed|space)|campus|university|college)'
        AND source_evidence !~ '(for[[:space:]]+sale|selling|asking[[:space:]]+price)' THEN 'student'
      WHEN source_evidence ~ '(office|shop|retail|warehouse|industrial|factory|arcade|showroom|business[[:space:]]+premises|commercial[[:space:]]+(space|land|plot))' THEN 'commercial'
      WHEN source_evidence ~ '(bed(room)?s?|house|home|apartment|flat|villa|bungalow|mansion|duplex|condo|townhouse)'
        THEN CASE WHEN source_evidence ~ '(for[[:space:]]+rent|to[[:space:]]+let|for[[:space:]]+lease|per[[:space:]]+month|/month)' THEN 'rent' ELSE 'sale' END
      WHEN source_evidence ~ '(land[[:space:]]+for[[:space:]]+sale|plots?[[:space:]]+for[[:space:]]+sale|vacant[[:space:]]+land|titled[[:space:]]+land|[0-9]+([.][0-9]+)?[[:space:]]*(acres?|decimals?))' THEN 'land'
      ELSE NULL
    END AS proposed_type,
    CASE
      WHEN source_evidence ~ '(air[[:space:]&]*(bnb|b[[:space:]]*&[[:space:]]*b)|short[-[:space:]]*(stay|term[[:space:]]+stay)|per[[:space:]]+night|nightly|guest[[:space:]]*house|hotel[[:space:]]+room|lodge[[:space:]]+room)' THEN TRUE
      WHEN stored_period IN ('night', 'nightly', 'day', 'daily') THEN TRUE
      ELSE FALSE
    END AS hospitality
  FROM evidence e
), issues AS (
  SELECT c.id, c.status AS previous_status, c.proposed_type,
    CASE c.proposed_type WHEN 'sale' THEN 'once' WHEN 'land' THEN 'once'
      WHEN 'rent' THEN 'month' WHEN 'student' THEN 'month' ELSE NULL END AS proposed_period,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN c.hospitality THEN 'unsupported_hospitality_or_nightly' END,
      CASE WHEN c.price > 100000000000 THEN 'price_above_100bn_ugx' END,
      CASE WHEN (c.price IS NULL OR c.price <= 0) AND NOT c.price_on_application THEN 'missing_price_without_poa' END,
      CASE WHEN c.price > 0 AND c.price_on_application THEN 'price_and_poa_conflict' END,
      CASE WHEN c.stored_type IN ('sale', 'land') AND c.price > 0 AND c.price < 1000000 THEN 'whole_property_price_below_1m' END,
      CASE WHEN c.stored_type IN ('rent', 'student', 'students') AND c.price > 0 AND c.price < 30000 THEN 'recurring_price_below_30k' END,
      CASE WHEN c.price > 0 AND REGEXP_REPLACE(ROUND(c.price)::text, '[^0-9]', '', 'g') IN (
        REGEXP_REPLACE(COALESCE(c.lister_phone, ''), '[^0-9]', '', 'g'),
        REGEXP_REPLACE(COALESCE(c.extra_fields->>'contact_phone', ''), '[^0-9]', '', 'g'),
        REGEXP_REPLACE(COALESCE(c.extra_fields->>'public_contact_phone', ''), '[^0-9]', '', 'g')
      ) THEN 'phone_number_stored_as_price' END,
      CASE WHEN c.proposed_type IS NOT NULL AND c.proposed_type <> CASE WHEN c.stored_type = 'students' THEN 'student' ELSE c.stored_type END
        THEN 'category_conflicts_with_source_evidence' END,
      CASE WHEN c.stored_type = 'land' AND COALESCE(c.bedrooms, 0) > 0 THEN 'bedrooms_on_land_category' END,
      CASE WHEN c.stored_type = 'commercial'
        AND LOWER(COALESCE(c.property_type, c.extra_fields->>'commercial_type', '')) ~ '(land|office|warehouse|industrial)'
        AND COALESCE(c.bedrooms, 0) > 0 THEN 'bedrooms_on_non_residential_commercial_category' END,
      CASE WHEN c.stored_type IN ('sale', 'land') AND c.stored_period NOT IN ('', 'once', 'one_off', 'total', 'sale', 'cash')
        THEN 'price_period_conflicts_with_category' END,
      CASE WHEN c.stored_type IN ('rent', 'student', 'students') AND c.stored_period NOT IN ('', 'month', 'monthly', 'mo', 'per_month', 'sem', 'semester', 'term')
        THEN 'price_period_conflicts_with_category' END,
      CASE WHEN c.source_evidence ~ '(for[[:space:]]+sale|selling|asking[[:space:]]+price)' AND c.stored_transaction = 'rent'
        THEN 'transaction_conflicts_with_sale_evidence' END,
      CASE WHEN c.source_evidence ~ '(for[[:space:]]+rent|to[[:space:]]+let|for[[:space:]]+lease)' AND c.stored_transaction = 'sale'
        THEN 'transaction_conflicts_with_rent_evidence' END
    ], NULL) AS issue_codes
  FROM classified c
)
INSERT INTO integrity_review_116 (id, previous_status, issue_codes, proposed_listing_type, proposed_price_period)
SELECT id, previous_status, issue_codes, proposed_type, proposed_period
FROM issues
WHERE CARDINALITY(issue_codes) > 0;

-- Duplicate source URLs and exact property fingerprints: keep the earliest row
-- as the review candidate and demote every other non-deleted copy.
WITH duplicate_candidates AS (
  SELECT id, status,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(
        NULLIF(LOWER(TRIM(extra_fields->>'source_url')), ''),
        NULLIF(LOWER(TRIM(extra_fields->>'source_post_url')), ''),
        MD5(LOWER(CONCAT_WS('|', TRIM(title), price::text, TRIM(area), bedrooms::text, TRIM(description))))
      )
      ORDER BY created_at NULLS LAST, id
    ) AS duplicate_rank
  FROM properties
  WHERE COALESCE(status, '') NOT IN ('deleted', 'rejected', 'declined', 'fraud', 'archived')
), duplicate_rows AS (
  SELECT id, status FROM duplicate_candidates WHERE duplicate_rank > 1
)
INSERT INTO integrity_review_116 (id, previous_status, issue_codes)
SELECT id, status, ARRAY['duplicate_property_fingerprint']::TEXT[]
FROM duplicate_rows
ON CONFLICT (id) DO UPDATE
SET issue_codes = ARRAY(SELECT DISTINCT unnest(integrity_review_116.issue_codes || EXCLUDED.issue_codes));

WITH queued AS (
  UPDATE properties p
  SET status = 'pending',
      moderation_stage = 'source_review',
      moderation_reason = 'Master data-integrity review required before publication.',
      moderation_notes = CONCAT_WS(' ', NULLIF(p.moderation_notes, ''),
        'Migration 116 issues: ' || ARRAY_TO_STRING(q.issue_codes, ', ') || '.'),
      reviewed_at = NOW(),
      approved_at = NULL,
      price_on_application = CASE WHEN p.price IS NOT NULL AND p.price > 0 THEN FALSE ELSE p.price_on_application END,
      extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
        'data_integrity_review_required', TRUE,
        'data_integrity_review_marker', 'master-data-integrity-116',
        'data_integrity_issue_codes', TO_JSONB(q.issue_codes),
        'data_integrity_previous_status', q.previous_status,
        'data_integrity_proposed_listing_type', q.proposed_listing_type,
        'data_integrity_proposed_price_period', q.proposed_price_period,
        'automatic_publish', FALSE
      ),
      updated_at = NOW()
  FROM integrity_review_116 q
  WHERE p.id = q.id
    AND COALESCE(p.extra_fields->>'data_integrity_review_marker', '') <> 'master-data-integrity-116'
  RETURNING p.id, q.previous_status, q.issue_codes
)
INSERT INTO property_moderation_events (
  property_id, actor_id, action, status_from, status_to, reason, notes, delivery
)
SELECT id, 'migration-116', 'master_data_integrity_source_review', previous_status, 'pending',
  'Master data-integrity review required before publication.',
  'Issues: ' || ARRAY_TO_STRING(issue_codes, ', '),
  jsonb_build_object('marker', 'master-data-integrity-116', 'automatic_publish', false)
FROM queued;

ANALYZE properties;
