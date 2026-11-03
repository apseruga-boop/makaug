-- Listing MK-20261031-0C0E8C: price UGX 65,000,000 (caption "Ugx 65 million").
-- Approved by Arthur on 3 Nov 2026. Migration 195 set this, but the row was
-- written back to 58,231,200 (the "$15,324" x 3,800 conversion) on 2 Nov.
-- Guarded on the current value; the row is backed up first.
-- Rollback: scripts/rollback-200-0c0e8c-price.sql.
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS listing_0c0e8c_price_200_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text NOT NULL,
  before_row jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT NOW(),
  rolled_back_at timestamptz
);

DO $fix$
DECLARE
  p properties%ROWTYPE;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'listing_0c0e8c_price_200 skipped country_not_ug';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM listing_0c0e8c_price_200_backup) THEN
    RAISE NOTICE 'listing_0c0e8c_price_200 skipped already_recorded';
    RETURN;
  END IF;
  SELECT * INTO p FROM properties WHERE inquiry_reference = 'MK-20261031-0C0E8C' FOR UPDATE;
  IF p.id IS NOT NULL AND p.price = 58231200 THEN
    INSERT INTO listing_0c0e8c_price_200_backup (property_id, inquiry_reference, before_row)
      VALUES (p.id, p.inquiry_reference, to_jsonb(p));
    UPDATE properties SET price = 65000000, price_currency = 'UGX',
      price_original = 65000000, price_original_currency = 'UGX',
      price_fx_rate_ugx = NULL, price_fx_as_of = NULL,
      extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
        'price_original', 65000000, 'price_original_currency', 'UGX',
        'listing_0c0e8c_price_200', jsonb_build_object('applied_at', NOW())),
      updated_at = NOW()
     WHERE id = p.id;
  ELSE
    RAISE NOTICE 'listing_0c0e8c_price_200 skipped guard';
  END IF;
END
$fix$;
