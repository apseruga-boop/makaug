-- Rollback for migration 204: restore the six listings' changed columns from
-- listing_phones_204_backup. Only rows not edited since (updated_at unchanged
-- from the migration) are restored. Run manually in one transaction.
BEGIN;
UPDATE properties p SET
  lister_phone = b.before_row->>'lister_phone',
  address = b.before_row->>'address',
  price = (b.before_row->>'price')::numeric,
  price_currency = b.before_row->>'price_currency',
  price_original = (b.before_row->>'price_original')::numeric,
  price_original_currency = b.before_row->>'price_original_currency',
  price_fx_rate_ugx = (b.before_row->>'price_fx_rate_ugx')::numeric,
  price_fx_as_of = (b.before_row->>'price_fx_as_of')::timestamptz,
  extra_fields = b.before_row->'extra_fields',
  updated_at = NOW()
FROM listing_phones_204_backup b
WHERE p.id = b.property_id
  AND b.rolled_back_at IS NULL
  AND p.extra_fields ? 'listing_phones_204';
UPDATE listing_phones_204_backup SET rolled_back_at = NOW() WHERE rolled_back_at IS NULL;
COMMIT;
