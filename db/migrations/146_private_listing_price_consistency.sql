-- Correct the original private-listing default from UGX 20,000 to UGX 25,000.
--
-- The exact JSON shape and NULL updated_by value identify the untouched value
-- seeded by migration 141. Any setting saved by an administrator, including a
-- deliberate UGX 20,000 rate, is left unchanged.
DO $$
DECLARE
  active_country_code TEXT := UPPER(COALESCE(NULLIF(current_setting('app.country_code', TRUE), ''), 'UG'));
BEGIN
  IF active_country_code = 'UG' THEN
    UPDATE billing_settings
       SET value = jsonb_set(value, '{monthly_ugx}', '25000'::jsonb, true),
           updated_by = 'migration:146_private_listing_price_consistency',
           updated_at = NOW()
     WHERE key = 'lister_fee'
       AND updated_by IS NULL
       AND value = '{"free_days": 7, "monthly_ugx": 20000, "views_message_day": 3, "start_date": "2026-10-05"}'::jsonb;
  END IF;
END
$$;
