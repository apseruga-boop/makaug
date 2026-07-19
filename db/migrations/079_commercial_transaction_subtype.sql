ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS transaction_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'properties_transaction_type_check'
  ) THEN
    ALTER TABLE properties
      ADD CONSTRAINT properties_transaction_type_check
      CHECK (transaction_type IS NULL OR transaction_type IN ('rent', 'sale'));
  END IF;
END $$;

UPDATE properties
SET transaction_type = CASE
  WHEN LOWER(COALESCE(price_period, '')) IN ('month', 'monthly', 'mo', 'per_month', 'week', 'weekly', 'per_week', 'night', 'daily') THEN 'rent'
  WHEN LOWER(COALESCE(price_period, '')) IN ('once', 'one_off', 'total', 'sale', 'cash', 'plot', 'acre') THEN 'sale'
  WHEN LOWER(CONCAT_WS(' ', title, description, extra_fields->>'source_title', extra_fields->>'source_caption', extra_fields->>'source_text'))
    ~ '(for rent|to rent|to let|for lease|available to rent|rental)' THEN 'rent'
  WHEN LOWER(CONCAT_WS(' ', title, description, extra_fields->>'source_title', extra_fields->>'source_caption', extra_fields->>'source_text'))
    ~ '(for sale|on sale|available for sale|selling|purchase)' THEN 'sale'
  ELSE transaction_type
END
WHERE listing_type IN ('commercial', 'land')
  AND transaction_type IS NULL;

UPDATE properties
SET property_type = CASE
  WHEN LOWER(CONCAT_WS(' ', property_type, title, description, extra_fields->>'source_title', extra_fields->>'source_caption', extra_fields->>'source_text'))
    ~ '(commercial land|commercial plot|\mland\M|\mplot(s)?\M|\macre(s)?\M|\mdecimal(s)?\M)' THEN 'commercial_land'
  WHEN LOWER(CONCAT_WS(' ', property_type, title, description, extra_fields->>'source_title', extra_fields->>'source_caption', extra_fields->>'source_text'))
    ~ '(warehouse|industrial|factory|workshop|storage|depot|logistics|distribution cent(re|er))' THEN 'warehouse_industrial'
  WHEN LOWER(CONCAT_WS(' ', property_type, title, description, extra_fields->>'source_title', extra_fields->>'source_caption', extra_fields->>'source_text'))
    ~ '(office|business cent(re|er)|coworking|co-working)' THEN 'office'
  WHEN LOWER(CONCAT_WS(' ', property_type, title, description, extra_fields->>'source_title', extra_fields->>'source_caption', extra_fields->>'source_text'))
    ~ '(shop|retail|showroom|mall|store|boutique|market stall)' THEN 'shop_retail'
  WHEN LOWER(CONCAT_WS(' ', property_type, title, description, extra_fields->>'source_title', extra_fields->>'source_caption', extra_fields->>'source_text'))
    ~ '(hotel|hospitality|restaurant|lodge|guest ?house|leisure|bar|resort)' THEN 'hospitality'
  ELSE NULL
END
WHERE listing_type = 'commercial';

CREATE INDEX IF NOT EXISTS idx_properties_transaction_type
  ON properties (transaction_type)
  WHERE transaction_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_properties_commercial_transaction_subtype
  ON properties (listing_type, transaction_type, property_type, created_at DESC)
  WHERE listing_type IN ('commercial', 'land');

COMMENT ON COLUMN properties.transaction_type IS
  'Transaction axis independent of category: rent or sale. Commercial and land retain listing_type as their category.';
