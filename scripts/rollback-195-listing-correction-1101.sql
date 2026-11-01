-- Run manually in a transaction with app.country_code='UG'. Not a deploy migration.
-- Restores each corrected listing from listing_correction_195_backup, but only
-- when nobody has edited it since (updated_at still equals applied_at).
SET LOCAL lock_timeout = '8s';
DO $rollback$
DECLARE
  backup record;
  b properties;
  has_trigger boolean;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN RETURN; END IF;
  SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_properties_updated_at'
    AND tgrelid = 'properties'::regclass AND NOT tgisinternal) INTO has_trigger;
  IF has_trigger THEN ALTER TABLE properties DISABLE TRIGGER trg_properties_updated_at; END IF;
  FOR backup IN SELECT k.* FROM listing_correction_195_backup k JOIN properties p ON p.id = k.property_id
      WHERE k.rolled_back_at IS NULL AND p.extra_fields ? 'listing_correction_195'
        AND p.updated_at = k.applied_at
      ORDER BY p.id FOR UPDATE OF p LOOP
    SELECT * INTO b FROM jsonb_populate_record(NULL::properties, backup.before_row);
    UPDATE properties SET price = b.price, price_currency = b.price_currency,
      price_original = b.price_original, price_original_currency = b.price_original_currency,
      price_fx_rate_ugx = b.price_fx_rate_ugx, price_fx_as_of = b.price_fx_as_of,
      price_unit = b.price_unit, price_period = b.price_period, area = b.area,
      extra_fields = b.extra_fields, updated_at = b.updated_at
     WHERE id = backup.property_id;
    UPDATE listing_correction_195_backup SET rolled_back_at = NOW() WHERE property_id = backup.property_id;
    RAISE NOTICE 'listing_correction_195 rolled_back %', backup.inquiry_reference;
  END LOOP;
  IF has_trigger THEN ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at; END IF;
END;
$rollback$;
