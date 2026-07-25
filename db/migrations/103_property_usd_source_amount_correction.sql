WITH usd_source_text AS (
  SELECT
    id,
    CONCAT_WS(
      ' ',
      NULLIF(extra_fields->>'source_price_label', ''),
      NULLIF(extra_fields->>'price_label', ''),
      NULLIF(title, ''),
      NULLIF(extra_fields->>'source_caption', ''),
      NULLIF(extra_fields->>'source_text', ''),
      NULLIF(extra_fields->>'source_description', ''),
      NULLIF(description, '')
    ) AS raw_text
  FROM properties
  WHERE price_currency = 'USD'
),
usd_matches AS (
  SELECT
    id,
    regexp_match(
      raw_text,
      '(USD|US[$]|[$])[[:space:]]*([0-9][0-9,]*([.][0-9]+)?)[[:space:]]*(THOUSAND|THOUSANDS|K|MILLION|MILLIONS|MN|M|BILLION|BILLIONS|BN|B)?',
      'i'
    ) AS prefix_parts,
    regexp_match(
      raw_text,
      '([0-9][0-9,]*([.][0-9]+)?)[[:space:]]*(THOUSAND|THOUSANDS|K|MILLION|MILLIONS|MN|M|BILLION|BILLIONS|BN|B)?[[:space:]]*(USD|US[$])',
      'i'
    ) AS suffix_parts
  FROM usd_source_text
),
usd_amounts AS (
  SELECT
    id,
    REPLACE(COALESCE(prefix_parts[2], suffix_parts[1]), ',', '')::numeric
      * CASE UPPER(COALESCE(prefix_parts[4], suffix_parts[3], ''))
          WHEN 'THOUSAND' THEN 1000
          WHEN 'THOUSANDS' THEN 1000
          WHEN 'K' THEN 1000
          WHEN 'MILLION' THEN 1000000
          WHEN 'MILLIONS' THEN 1000000
          WHEN 'MN' THEN 1000000
          WHEN 'M' THEN 1000000
          WHEN 'BILLION' THEN 1000000000
          WHEN 'BILLIONS' THEN 1000000000
          WHEN 'BN' THEN 1000000000
          WHEN 'B' THEN 1000000000
          ELSE 1
        END AS original_amount
  FROM usd_matches
  WHERE prefix_parts IS NOT NULL OR suffix_parts IS NOT NULL
)
UPDATE properties p
SET price = ROUND(a.original_amount * 3800),
    price_original = ROUND(a.original_amount),
    price_fx_rate_ugx = 3800,
    price_fx_as_of = COALESCE(p.price_fx_as_of, NOW()),
    extra_fields = COALESCE(p.extra_fields, '{}'::jsonb)
      || jsonb_build_object(
        'price_currency', 'USD',
        'price_original', ROUND(a.original_amount),
        'price_fx_rate_ugx', 3800,
        'price_fx_as_of', COALESCE(p.price_fx_as_of, NOW()),
        'price_conversion_basis', 'Original public USD amount parsed from source evidence and converted to canonical UGX for search and valuation.',
        'price_source_amount_corrected', TRUE
      )
FROM usd_amounts a
WHERE p.id = a.id
  AND a.original_amount > 0;

ANALYZE properties;
