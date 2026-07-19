-- The stored price period is the authoritative transaction signal for legacy rows.
-- Source captions often contain generic "property for sale" wording even when the
-- individual commercial listing is priced monthly.
UPDATE properties
SET transaction_type = CASE
  WHEN LOWER(COALESCE(price_period, '')) IN ('month', 'monthly', 'mo', 'per_month', 'week', 'weekly', 'per_week', 'night', 'daily') THEN 'rent'
  WHEN LOWER(COALESCE(price_period, '')) IN ('once', 'one_off', 'total', 'sale', 'cash', 'plot', 'acre') THEN 'sale'
  ELSE transaction_type
END
WHERE listing_type IN ('commercial', 'land')
  AND LOWER(COALESCE(price_period, '')) IN (
    'month', 'monthly', 'mo', 'per_month', 'week', 'weekly', 'per_week', 'night', 'daily',
    'once', 'one_off', 'total', 'sale', 'cash', 'plot', 'acre'
  );

ANALYZE properties;
