DO $$
DECLARE
  active_country_code TEXT := UPPER(COALESCE(NULLIF(current_setting('app.country_code', TRUE), ''), 'UG'));
BEGIN
  IF active_country_code = 'ZA' THEN
    ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_price_currency_supported;
    ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_price_original_currency_supported;

    ALTER TABLE properties
      ALTER COLUMN price_currency SET DEFAULT 'ZAR',
      ADD CONSTRAINT properties_price_currency_supported CHECK (
        status NOT IN ('approved', 'pending')
        OR price_currency IS NOT DISTINCT FROM 'ZAR'
      ),
      ADD CONSTRAINT properties_price_original_currency_supported CHECK (
        status NOT IN ('approved', 'pending')
        OR price_original_currency IS NULL
        OR price_original_currency IN ('ZAR', 'USD', 'EUR', 'GBP')
      );
  END IF;
END
$$;
