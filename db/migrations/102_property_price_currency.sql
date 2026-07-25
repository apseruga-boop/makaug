ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS price_currency TEXT,
  ADD COLUMN IF NOT EXISTS price_original NUMERIC,
  ADD COLUMN IF NOT EXISTS price_fx_rate_ugx NUMERIC,
  ADD COLUMN IF NOT EXISTS price_fx_as_of TIMESTAMPTZ;

UPDATE properties
SET price_currency = 'UGX'
WHERE price_currency IS NULL OR BTRIM(price_currency) = '';

WITH usd_rows AS (
  SELECT id
  FROM properties
  WHERE price IS NOT NULL
    AND price > 0
    AND (
      COALESCE(extra_fields->>'source_price_label', '') ~* '(USD|US[$]|[$])[[:space:]]*[0-9]'
      OR COALESCE(extra_fields->>'price_label', '') ~* '(USD|US[$]|[$])[[:space:]]*[0-9]'
      OR COALESCE(extra_fields->>'source_caption', '') ~* '(USD|US[$]|[$])[[:space:]]*[0-9]'
      OR COALESCE(extra_fields->>'source_text', '') ~* '(USD|US[$]|[$])[[:space:]]*[0-9]'
      OR COALESCE(extra_fields->>'source_description', '') ~* '(USD|US[$]|[$])[[:space:]]*[0-9]'
      OR COALESCE(description, '') ~* '(USD|US[$]|[$])[[:space:]]*[0-9]'
    )
)
UPDATE properties p
SET price_currency = 'USD',
    price_original = ROUND(p.price::numeric / 3800),
    price_fx_rate_ugx = 3800,
    price_fx_as_of = COALESCE(p.price_fx_as_of, NOW()),
    extra_fields = COALESCE(p.extra_fields, '{}'::jsonb)
      || jsonb_build_object(
        'price_currency', 'USD',
        'price_original', ROUND(p.price::numeric / 3800),
        'price_fx_rate_ugx', 3800,
        'price_fx_as_of', COALESCE(p.price_fx_as_of, NOW()),
        'price_conversion_basis', 'Original public USD guide converted to canonical UGX for search and valuation.'
      )
FROM usd_rows
WHERE p.id = usd_rows.id;

ALTER TABLE properties
  ALTER COLUMN price_currency SET DEFAULT 'UGX',
  ALTER COLUMN price_currency SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'properties_price_currency_supported'
  ) THEN
    ALTER TABLE properties
      ADD CONSTRAINT properties_price_currency_supported
      CHECK (price_currency IN ('UGX', 'USD'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_properties_price_currency_status
  ON properties (price_currency, status)
  WHERE price_currency <> 'UGX';

ANALYZE properties;
