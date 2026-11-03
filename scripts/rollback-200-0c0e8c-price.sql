-- Rollback for db/migrations/200_listing_0c0e8c_price_ugx.sql.
-- Restores 0C0E8C's price fields from the backup row.
BEGIN;
UPDATE properties p SET
  price = (b.before_row->>'price')::numeric,
  price_currency = b.before_row->>'price_currency',
  price_original = (b.before_row->>'price_original')::numeric,
  price_original_currency = b.before_row->>'price_original_currency',
  price_fx_rate_ugx = (b.before_row->>'price_fx_rate_ugx')::numeric,
  price_fx_as_of = (b.before_row->>'price_fx_as_of')::timestamptz,
  extra_fields = b.before_row->'extra_fields',
  updated_at = NOW()
FROM listing_0c0e8c_price_200_backup b
WHERE p.id = b.property_id AND b.rolled_back_at IS NULL;
UPDATE listing_0c0e8c_price_200_backup SET rolled_back_at = NOW() WHERE rolled_back_at IS NULL;
COMMIT;
