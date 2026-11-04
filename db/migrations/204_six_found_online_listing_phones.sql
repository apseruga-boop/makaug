-- Six pending found-online TikTok listings (2D131C, 3CF4A3, 6C5834, 803233,
-- 95DBD6, EC06BB): add the poster's phone, and correct area/price.
-- Approved by Arthur on 4 Nov 2026.
-- The repo is public, so phones are NOT in this file. They could not be
-- derived from stored data (stored captions are truncated before the number),
-- so they come from the one-off Render env var MIGRATION_SECRET_JSON
-- ({"<ref>": "+2567XXXXXXXX"}), exposed by scripts/migrate.js as the
-- transaction-local setting app.migration_secret_json. Each phone must be a
-- +2567XXXXXXXX number whose sha256 matches the hash below; otherwise that
-- listing's phone is skipped (NOTICE). Never raises, so startup is safe.
-- Phones are only written where lister_phone/contact_phone are empty.
-- Prices follow #650: USD kept as price_original/_currency, price in UGX at the
-- row's existing fx rate (3800).
-- Rollback: scripts/rollback-204-six-found-online-listing-phones.sql.
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS listing_phones_204_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text NOT NULL,
  before_row jsonb NOT NULL,
  phone_written boolean NOT NULL DEFAULT false,
  applied_at timestamptz NOT NULL DEFAULT NOW(),
  rolled_back_at timestamptz
);

DO $fix$
DECLARE
  r record;
  p properties%ROWTYPE;
  secret jsonb;
  ph text;
  ok_phone boolean;
  new_price numeric;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'listing_phones_204 skipped country_not_ug';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM listing_phones_204_backup) THEN
    RAISE NOTICE 'listing_phones_204 skipped already_recorded';
    RETURN;
  END IF;
  BEGIN
    secret := NULLIF(current_setting('app.migration_secret_json', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    secret := NULL;
  END;
  IF secret IS NULL THEN
    RAISE NOTICE 'listing_phones_204 no secret: phones skipped, area/price still applied';
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('MK-20261103-2D131C', 'b535506f646a21c539d8d77e344bc90708e34b4e47065b58a7e971b09a7ba359', NULL::text, 700000000::numeric, 'UGX'),
      ('MK-20261103-3CF4A3', 'b535506f646a21c539d8d77e344bc90708e34b4e47065b58a7e971b09a7ba359', NULL, 335000, 'USD'),
      ('MK-20261103-6C5834', '40299f84104a0967b8023d39d1976a8b6ca86e5ae6868fde9f3ce1f624b9fbf0', NULL, NULL, NULL),
      ('MK-20261103-803233', '46bad1b710af80e93a6606e4785d3001a04437557350fdd2a8ee1102427d1f46', 'Arkright, Bwebajja, Entebbe Road', 1100000, 'USD'),
      ('MK-20261103-95DBD6', '71de7f00c5b9a5818a317602e2b1408780639e84e2fae7c1e5e8f68a79090897', NULL, 385000, 'USD'),
      ('MK-20261103-EC06BB', '6d59cc060073ca5218b84ba2b707b3586e520d52f6e275994c2fbb059960a127', NULL, 15000000, 'UGX')
    ) AS v(ref, phone_sha, address, orig_price, orig_cur)
  LOOP
    SELECT * INTO p FROM properties WHERE inquiry_reference = r.ref AND status = 'pending' FOR UPDATE;
    IF p.id IS NULL THEN
      RAISE NOTICE 'listing_phones_204 % skipped not_pending', r.ref;
      CONTINUE;
    END IF;
    ph := secret ->> right(r.ref, 6);
    ok_phone := ph ~ '^\+2567\d{8}$'
      AND encode(sha256(convert_to(ph, 'UTF8')), 'hex') = r.phone_sha
      AND COALESCE(NULLIF(btrim(p.lister_phone), ''), NULLIF(btrim(p.extra_fields->>'contact_phone'), '')) IS NULL;
    IF NOT COALESCE(ok_phone, false) THEN
      RAISE NOTICE 'listing_phones_204 % phone skipped (missing, hash mismatch or already set)', r.ref;
    END IF;
    new_price := CASE
      WHEN r.orig_cur = 'USD' THEN r.orig_price * COALESCE(p.price_fx_rate_ugx, 3800)
      WHEN r.orig_cur = 'UGX' THEN r.orig_price END;

    INSERT INTO listing_phones_204_backup (property_id, inquiry_reference, before_row, phone_written)
      VALUES (p.id, p.inquiry_reference, to_jsonb(p), COALESCE(ok_phone, false));

    UPDATE properties SET
      lister_phone = CASE WHEN ok_phone THEN ph ELSE lister_phone END,
      address = COALESCE(r.address, address),
      price = COALESCE(new_price, price),
      price_currency = CASE WHEN new_price IS NOT NULL THEN 'UGX' ELSE price_currency END,
      price_original = COALESCE(r.orig_price, price_original),
      price_original_currency = COALESCE(r.orig_cur, price_original_currency),
      price_fx_rate_ugx = CASE WHEN r.orig_cur = 'USD' THEN COALESCE(price_fx_rate_ugx, 3800)
                               WHEN r.orig_cur = 'UGX' THEN NULL ELSE price_fx_rate_ugx END,
      price_fx_as_of = CASE WHEN r.orig_cur = 'USD' THEN COALESCE(price_fx_as_of, NOW())
                            WHEN r.orig_cur = 'UGX' THEN NULL ELSE price_fx_as_of END,
      extra_fields = COALESCE(extra_fields, '{}'::jsonb)
        || CASE WHEN ok_phone THEN jsonb_build_object('contact_phone', ph, 'public_contact_phone', ph) ELSE '{}'::jsonb END
        || CASE WHEN r.orig_cur IS NOT NULL THEN jsonb_build_object('price_original', r.orig_price, 'price_original_currency', r.orig_cur) ELSE '{}'::jsonb END
        || jsonb_build_object('listing_phones_204', jsonb_build_object('phone_written', COALESCE(ok_phone, false), 'applied_at', NOW())),
      updated_at = NOW()
     WHERE id = p.id;
  END LOOP;
END
$fix$;
