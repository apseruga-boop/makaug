-- Master property data-integrity guardrails.
--
-- Canonical monetary values are always UGX. Source amount/currency remain
-- separate provenance. This migration never publishes inventory: any row that
-- needs judgement is returned to source review with its previous state and
-- proposed repair recorded for a human moderator.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS price_original_currency TEXT,
  ADD COLUMN IF NOT EXISTS price_on_application BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TEMP TABLE price_snapshot_116 ON COMMIT DROP AS
SELECT
  id,
  status AS previous_status,
  UPPER(TRIM(COALESCE(price_currency, ''))) AS previous_price_currency,
  price AS previous_price,
  price_original AS previous_price_original,
  price_fx_rate_ugx AS previous_price_fx_rate_ugx
FROM properties
WHERE status IN ('approved', 'pending')
  AND status NOT IN ('rejected', 'deleted');

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
WHERE status IN ('approved', 'pending')
  AND status NOT IN ('rejected', 'deleted')
  AND (
    price_original_currency IS NULL
    OR price_currency IS DISTINCT FROM 'UGX'
    OR price_on_application IS DISTINCT FROM (
      CASE WHEN price IS NOT NULL AND price > 0 THEN FALSE ELSE
        COALESCE(price_on_application, FALSE)
        OR LOWER(COALESCE(extra_fields->>'price_on_application', '')) IN ('true', '1', 'yes')
        OR LOWER(COALESCE(extra_fields->>'price_upon_application', '')) IN ('true', '1', 'yes')
        OR CONCAT_WS(' ', extra_fields->>'price_label', extra_fields->>'source_price_label')
          ~* '(^|[^a-z])(poa|price[[:space:]]+(upon[[:space:]]+application|on[[:space:]]+request))([^a-z]|$)'
      END
    )
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
  AND status IN ('approved', 'pending')
  AND status NOT IN ('rejected', 'deleted')
  AND price_original > 0
  AND price_fx_rate_ugx BETWEEN 1000 AND 10000
  AND ROUND(price_original * price_fx_rate_ugx) BETWEEN 1 AND 100000000000
  AND price IS DISTINCT FROM ROUND(price_original * price_fx_rate_ugx);

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_price_currency_supported;
ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_price_original_currency_supported;

ALTER TABLE properties
  ALTER COLUMN price_currency SET DEFAULT 'UGX',
  ADD CONSTRAINT properties_price_currency_supported CHECK (
    status NOT IN ('approved', 'pending')
    OR price_currency IS NOT DISTINCT FROM 'UGX'
  ),
  ADD CONSTRAINT properties_price_original_currency_supported
    CHECK (
      status NOT IN ('approved', 'pending')
      OR price_original_currency IS NULL
      OR price_original_currency IN ('UGX', 'USD')
    );

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
    LOWER(CONCAT_WS(' ', p.title,
      p.extra_fields->>'source_title', p.extra_fields->>'source_caption')) AS title_evidence,
    LOWER(CONCAT_WS(' ', p.title,
      p.extra_fields->>'source_title', p.extra_fields->>'source_caption',
      p.extra_fields->>'source_text', p.extra_fields->>'source_visual_text')) AS source_evidence,
    CASE WHEN LOWER(TRIM(COALESCE(p.listing_type, ''))) = 'students' THEN 'student'
      ELSE LOWER(TRIM(COALESCE(p.listing_type, ''))) END AS stored_type,
    LOWER(TRIM(COALESCE(p.price_period, ''))) AS stored_period,
    LOWER(TRIM(COALESCE(p.transaction_type, ''))) AS stored_transaction
  FROM properties p
  WHERE p.status IN ('approved', 'pending')
    AND p.status NOT IN ('rejected', 'deleted')
), signals AS (
  SELECT e.*,
    COALESCE(e.bedrooms, 0) > 0
      OR COALESCE(e.bathrooms, 0) > 0
      OR e.title_evidence ~ '(^|[^a-z0-9])[0-9]+[[:space:]]*(bed(room)?s?|bath(room)?s?)([^a-z]|$)' AS bedroom_bathroom_evidence,
    e.title_evidence ~ '((prime|vacant|bare|titled)[[:space:]]+land|(land|plots?|ettaka|kibanja|bibanja)[[:space:]]+(is[[:space:]]+)?(for|on)[[:space:]]+sale|[0-9]+([.][0-9]+)?[[:space:]]*(acres?|decimals?|square[[:space:]]+(miles?|kilomet(er|re)s?))([[:space:]]+of[[:space:]]+land)?[[:space:]]+(for|on)[[:space:]]+sale|square[[:space:]]+(miles?|kilomet(er|re)s?)[[:space:]]+of[[:space:]]+land)' AS title_strong_land,
    (
      e.title_evidence ~ '(plots?|acres?|decimals?|farmland|bare[-[:space:]]+land|vacant[[:space:]]+land|prime[[:space:]]+land|square[[:space:]]+(miles?|kilomet(er|re)s?)([[:space:]]+of[[:space:]]+land)?|ettaka|kibanja|bibanja)'
      OR (
        REGEXP_REPLACE(e.title_evidence, '((private|milo|mailo|freehold|leasehold|kabaka)[[:space:]]+)?land[[:space:]]+title', ' ', 'g') ~ '(^|[^a-z])land([^a-z]|$)'
      )
    ) AS title_land,
    e.title_evidence ~ '(bed(room)?s?|bath(room)?s?|house|home|apartment([[:space:]]+block)?|flat|villa|bungalow|mansion|duplex|condo|townhouse|residence|residential|self[-[:space:]]*contained|rentals?|rental[[:space:]]+units?)' AS title_dwelling,
    e.title_evidence ~ '(office|shop|retail|warehouse|industrial|factory|arcade|showroom|business[[:space:]]+premises|commercial[[:space:]]+(building|property|premises|space|land|plot))' AS title_commercial,
    e.source_evidence ~ '((prime|vacant|bare|titled)[[:space:]]+land|(land|plots?|ettaka|kibanja|bibanja)[[:space:]]+(is[[:space:]]+)?(for|on)[[:space:]]+sale|[0-9]+([.][0-9]+)?[[:space:]]*(acres?|decimals?|square[[:space:]]+(miles?|kilomet(er|re)s?))([[:space:]]+of[[:space:]]+land)?[[:space:]]+(for|on)[[:space:]]+sale|square[[:space:]]+(miles?|kilomet(er|re)s?)[[:space:]]+of[[:space:]]+land)' AS source_strong_land,
    e.source_evidence ~ '(bed(room)?s?|bath(room)?s?|house|home|apartment([[:space:]]+block)?|flat|villa|bungalow|mansion|duplex|condo|townhouse|residence|residential|self[-[:space:]]*contained|rentals?|rental[[:space:]]+units?)' AS source_dwelling,
    e.source_evidence ~ '(office|shop|retail|warehouse|industrial|factory|arcade|showroom|business[[:space:]]+premises|commercial[[:space:]]+(building|property|premises|space|land|plot))' AS source_commercial,
    (
      e.source_evidence ~ '(plots?|acres?|decimals?|farmland|bare[-[:space:]]+land|vacant[[:space:]]+land|prime[[:space:]]+land|square[[:space:]]+(miles?|kilomet(er|re)s?)([[:space:]]+of[[:space:]]+land)?|ettaka|kibanja|bibanja)'
      OR (
        REGEXP_REPLACE(e.source_evidence, '((private|milo|mailo|freehold|leasehold|kabaka)[[:space:]]+)?land[[:space:]]+title', ' ', 'g') ~ '(^|[^a-z])land([^a-z]|$)'
      )
    ) AS source_land,
    e.source_evidence ~ '(student[[:space:]]+(accommodation|hostel|room)|hostel[[:space:]]+(room|bed|space)|campus|university|college|per[[:space:]]+semester)' AS student_evidence,
    e.title_evidence ~ '(for[[:space:]]+(sale|sell)|on[[:space:]]+sale|available[[:space:]]+for[[:space:]]+sale|selling|asking[[:space:]]+price|guide[[:space:]]+price|purchase[[:space:]]+price)' AS title_sale,
    e.title_evidence ~ '(for[[:space:]]*rent|to[[:space:]]*rent|to[[:space:]]*let|for[[:space:]]+lease|available[[:space:]]+to[[:space:]]*rent|monthly[[:space:]]+rent|forrent|housesforrent|propertiesforrent|apartmentsforrent|rooms?forrent)' AS title_direct_rent,
    e.title_evidence ~ '((per|a)[[:space:]]+month|/month|/mo|monthly)'
      AND e.title_evidence !~ '((monthly|rental)[[:space:]]+income|(collects?|generates?|earns?|brings?|making).{0,80}(income|monthly|per[[:space:]]+month|/month))' AS title_periodic_rent,
    e.source_evidence ~ '(for[[:space:]]+(sale|sell)|on[[:space:]]+sale|available[[:space:]]+for[[:space:]]+sale|selling|asking[[:space:]]+price|guide[[:space:]]+price|purchase[[:space:]]+price)' AS source_sale,
    e.source_evidence ~ '(for[[:space:]]*rent|to[[:space:]]*rent|to[[:space:]]*let|for[[:space:]]+lease|available[[:space:]]+to[[:space:]]*rent|monthly[[:space:]]+rent|forrent|housesforrent|propertiesforrent|apartmentsforrent|rooms?forrent)' AS source_direct_rent,
    e.source_evidence ~ '((per|a)[[:space:]]+month|/month|/mo|monthly)'
      AND e.source_evidence !~ '((monthly|rental)[[:space:]]+income|(collects?|generates?|earns?|brings?|making).{0,80}(income|monthly|per[[:space:]]+month|/month))' AS source_periodic_rent
  FROM evidence e
), classified AS (
  SELECT s.*,
    CASE
      WHEN s.student_evidence AND NOT s.source_sale THEN 'student'
      WHEN s.bedroom_bathroom_evidence THEN 'residential'
      WHEN s.title_strong_land OR s.title_land THEN 'land'
      WHEN s.title_dwelling THEN 'residential'
      WHEN s.title_commercial THEN 'commercial'
      WHEN s.source_strong_land OR s.source_land THEN 'land'
      WHEN s.source_dwelling THEN 'residential'
      WHEN s.source_commercial THEN 'commercial'
      ELSE NULL
    END AS physical_type,
    CASE
      WHEN s.title_sale AND s.title_direct_rent THEN NULL
      WHEN s.title_sale THEN 'sale'
      WHEN s.title_direct_rent OR s.title_periodic_rent THEN 'rent'
      WHEN s.source_sale AND s.source_direct_rent THEN NULL
      WHEN s.source_sale THEN 'sale'
      WHEN s.source_direct_rent OR s.source_periodic_rent THEN 'rent'
      ELSE NULL
    END AS transaction_intent,
    (s.title_sale AND s.title_direct_rent)
      OR (NOT s.title_sale AND NOT s.title_direct_rent AND s.source_sale AND s.source_direct_rent) AS transaction_ambiguous,
    CASE
      WHEN s.source_evidence ~ '(air[[:space:]&]*(bnb|b[[:space:]]*&[[:space:]]*b)|short[-[:space:]]*(stay|term[[:space:]]+stay)|per[[:space:]]+night|nightly|guest[[:space:]]*house|hotel[[:space:]]+room|lodge[[:space:]]+room)' THEN TRUE
      WHEN s.stored_period IN ('night', 'nightly', 'day', 'daily') THEN TRUE
      ELSE FALSE
    END AS hospitality
  FROM signals s
), proposed AS (
  SELECT c.*,
    CASE
      WHEN c.transaction_ambiguous THEN c.stored_type
      WHEN c.physical_type = 'student' THEN 'student'
      WHEN c.physical_type = 'land' THEN 'land'
      WHEN c.physical_type = 'commercial' THEN 'commercial'
      WHEN c.physical_type = 'residential' AND c.transaction_intent IN ('sale', 'rent') THEN c.transaction_intent
      ELSE c.stored_type
    END AS proposed_type,
    c.transaction_ambiguous
      OR (c.physical_type = 'residential' AND c.transaction_intent IS NULL) AS category_ambiguous
  FROM classified c
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
      CASE WHEN c.category_ambiguous THEN 'category_ambiguous' END,
      CASE WHEN NOT c.category_ambiguous AND c.proposed_type IS NOT NULL AND c.proposed_type <> c.stored_type
        THEN 'category_conflicts_with_source_evidence' END,
      CASE WHEN c.stored_type = 'land' AND COALESCE(c.bedrooms, 0) > 0 THEN 'bedrooms_on_land_category' END,
      CASE WHEN c.stored_type = 'commercial'
        AND LOWER(COALESCE(c.property_type, c.extra_fields->>'commercial_type', '')) ~ '(land|office|warehouse|industrial)'
        AND COALESCE(c.bedrooms, 0) > 0 THEN 'bedrooms_on_non_residential_commercial_category' END,
      CASE WHEN c.stored_type IN ('sale', 'land') AND c.stored_period NOT IN ('', 'once', 'one_off', 'total', 'sale', 'cash')
        THEN 'price_period_conflicts_with_category' END,
      CASE WHEN c.stored_type IN ('rent', 'student', 'students') AND c.stored_period NOT IN ('', 'month', 'monthly', 'mo', 'per_month', 'sem', 'semester', 'term')
        THEN 'price_period_conflicts_with_category' END,
      CASE WHEN NOT c.category_ambiguous AND c.transaction_intent = 'sale' AND c.stored_transaction = 'rent'
        THEN 'transaction_conflicts_with_sale_evidence' END,
      CASE WHEN NOT c.category_ambiguous AND c.transaction_intent = 'rent' AND c.stored_transaction = 'sale'
        THEN 'transaction_conflicts_with_rent_evidence' END
    ], NULL) AS issue_codes
  FROM proposed c
)
INSERT INTO integrity_review_116 (id, previous_status, issue_codes, proposed_listing_type, proposed_price_period)
SELECT id, previous_status, issue_codes, proposed_type, proposed_period
FROM issues
WHERE CARDINALITY(issue_codes) > 0;

-- A currency label can be normalised in place when the stored source amount
-- and FX basis already prove the canonical UGX value. Actual magnitude repairs
-- and unsupported/unproven conversions remain review work.
WITH currency_issues AS (
  SELECT
    p.id,
    s.previous_status,
    ARRAY_REMOVE(ARRAY[
      CASE
        WHEN p.extra_fields->>'price_fx_magnitude_repaired' = 'true'
          THEN 'fx_magnitude_repaired_requires_review'
      END,
      CASE
        WHEN s.previous_price_currency NOT IN ('', 'UGX')
          AND NOT (
            s.previous_price_currency = 'USD'
            AND s.previous_price_original > 0
            AND s.previous_price_fx_rate_ugx BETWEEN 1000 AND 10000
            AND p.price IS NOT DISTINCT FROM ROUND(s.previous_price_original * s.previous_price_fx_rate_ugx)
          )
          THEN 'currency_conversion_requires_review'
      END
    ], NULL) AS issue_codes
  FROM properties p
  JOIN price_snapshot_116 s ON s.id = p.id
  WHERE p.status IN ('approved', 'pending')
    AND p.status NOT IN ('rejected', 'deleted')
), flagged AS (
  SELECT id, previous_status, issue_codes
  FROM currency_issues
  WHERE CARDINALITY(issue_codes) > 0
)
INSERT INTO integrity_review_116 (id, previous_status, issue_codes)
SELECT id, previous_status, issue_codes
FROM flagged
ON CONFLICT (id) DO UPDATE
SET issue_codes = ARRAY(
  SELECT DISTINCT unnest(integrity_review_116.issue_codes || EXCLUDED.issue_codes)
);

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
  WHERE status IN ('approved', 'pending')
    AND status NOT IN ('rejected', 'deleted')
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
  SET status = CASE WHEN p.status = 'approved' THEN 'pending' ELSE p.status END,
      moderation_stage = CASE WHEN p.status = 'approved' THEN 'source_review' ELSE p.moderation_stage END,
      moderation_reason = CASE
        WHEN p.status = 'approved' THEN 'Master data-integrity review required before publication.'
        ELSE p.moderation_reason
      END,
      moderation_notes = CONCAT_WS(' ', NULLIF(p.moderation_notes, ''),
        'Migration 116 issues: ' || ARRAY_TO_STRING(q.issue_codes, ', ') || '.'),
      reviewed_at = CASE WHEN p.status = 'approved' THEN NOW() ELSE p.reviewed_at END,
      approved_at = CASE WHEN p.status = 'approved' THEN NULL ELSE p.approved_at END,
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
    AND p.status IN ('approved', 'pending')
    AND p.status NOT IN ('rejected', 'deleted')
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
FROM queued
WHERE previous_status = 'approved';

ANALYZE properties;
