-- Listing fact corrections from the 1 November 2026 review. NOT APPLIED until
-- Arthur approves the PR. Each row is guarded on its current values, so a
-- listing that staff have edited since is skipped, not overwritten.
--   0C0E8C  price is UGX 65,000,000 (caption "Ugx 65 million"); it was read
--           from "$15,324" in the YouTube title and converted at 3,800.
--   BE17A0  UGX 16,000,000 is per acre (period already 'acre'): set price_unit.
--   C95C82  USh 24,000,000/acre stored as a once-off total: period 'acre',
--           and close the integrity review staff already corrected.
--   46B103  area 'Nakwero' -> 'Nakweru' (the title and the source say Nakweru),
--           and repair the blank area_highlights.
--   19F6B4  close the integrity review left open after staff approval.
-- Rollback: scripts/rollback-195-listing-correction-1101.sql.
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS listing_correction_195_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text NOT NULL,
  before_row jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT NOW(),
  rolled_back_at timestamptz
);

DO $correction$
DECLARE
  p properties%ROWTYPE;
  resolved jsonb;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'listing_correction_195 skipped country_not_ug';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM listing_correction_195_backup) THEN
    RAISE NOTICE 'listing_correction_195 skipped already_recorded';
    RETURN;
  END IF;

  -- 0C0E8C
  SELECT * INTO p FROM properties WHERE inquiry_reference = 'MK-20261031-0C0E8C' FOR UPDATE;
  IF p.id IS NOT NULL AND p.price = 58231200 AND p.price_original = 15324
     AND p.price_original_currency = 'USD' AND p.price_fx_rate_ugx = 3800 THEN
    INSERT INTO listing_correction_195_backup (property_id, inquiry_reference, before_row) VALUES (p.id, p.inquiry_reference, to_jsonb(p));
    UPDATE properties SET price = 65000000, price_currency = 'UGX', price_original = 65000000,
      price_original_currency = 'UGX', price_fx_rate_ugx = NULL, price_fx_as_of = NULL,
      extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
        'price_original', 65000000, 'price_original_currency', 'UGX',
        'source_price_label', 'USh 65,000,000',
        'listing_correction_195', jsonb_build_object('applied_at', NOW(), 'fix', 'ugx_price_from_caption')),
      updated_at = NOW()
     WHERE id = p.id;
  ELSE
    RAISE NOTICE 'listing_correction_195 skipped 0C0E8C guard';
  END IF;

  -- BE17A0
  p := NULL;
  SELECT * INTO p FROM properties WHERE inquiry_reference = 'MK-20261031-BE17A0' FOR UPDATE;
  IF p.id IS NOT NULL AND p.price = 16000000 AND p.price_period = 'acre'
     AND p.price_unit IS NULL AND p.listing_type = 'land' THEN
    INSERT INTO listing_correction_195_backup (property_id, inquiry_reference, before_row) VALUES (p.id, p.inquiry_reference, to_jsonb(p));
    UPDATE properties SET price_unit = 'per_acre',
      extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
        'price_unit', 'per_acre',
        'listing_correction_195', jsonb_build_object('applied_at', NOW(), 'fix', 'per_acre_unit')),
      updated_at = NOW()
     WHERE id = p.id;
  ELSE
    RAISE NOTICE 'listing_correction_195 skipped BE17A0 guard';
  END IF;

  -- C95C82
  p := NULL;
  SELECT * INTO p FROM properties WHERE inquiry_reference = 'MK-20261030-C95C82' FOR UPDATE;
  IF p.id IS NOT NULL AND p.price = 24000000 AND p.price_period = 'once'
     AND p.price_unit = 'per_acre' AND p.listing_type = 'land' THEN
    INSERT INTO listing_correction_195_backup (property_id, inquiry_reference, before_row) VALUES (p.id, p.inquiry_reference, to_jsonb(p));
    resolved := jsonb_build_object('ok', true, 'issues', '[]'::jsonb, 'issue_codes', '[]'::jsonb,
      'resolved_issues', COALESCE(p.extra_fields->'data_integrity_review'->'issues', '[]'::jsonb),
      'resolved_at', NOW(), 'resolved_by', 'migration_195_arthur_approved');
    UPDATE properties SET price_period = 'acre',
      extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
        'data_integrity_review', COALESCE(extra_fields->'data_integrity_review', '{}'::jsonb) || resolved,
        'data_integrity_issue_codes', '[]'::jsonb,
        'listing_correction_195', jsonb_build_object('applied_at', NOW(), 'fix', 'per_acre_period')),
      updated_at = NOW()
     WHERE id = p.id;
  ELSE
    RAISE NOTICE 'listing_correction_195 skipped C95C82 guard';
  END IF;

  -- 46B103
  p := NULL;
  SELECT * INTO p FROM properties WHERE inquiry_reference = 'MK-20261031-46B103' FOR UPDATE;
  IF p.id IS NOT NULL AND p.area = 'Nakwero' AND p.title = 'House for sale in Nakweru'
     AND p.district = 'Wakiso' THEN
    INSERT INTO listing_correction_195_backup (property_id, inquiry_reference, before_row) VALUES (p.id, p.inquiry_reference, to_jsonb(p));
    UPDATE properties SET area = 'Nakweru',
      extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
        'area_highlights', 'Nakweru is a Uganda property search area.',
        'listing_correction_195', jsonb_build_object('applied_at', NOW(), 'fix', 'nakweru_spelling')),
      updated_at = NOW()
     WHERE id = p.id;
  ELSE
    RAISE NOTICE 'listing_correction_195 skipped 46B103 guard';
  END IF;

  -- 19F6B4
  p := NULL;
  SELECT * INTO p FROM properties WHERE inquiry_reference = 'MK-20261031-19F6B4' FOR UPDATE;
  IF p.id IS NOT NULL AND p.status = 'approved' AND p.price = 1500000000
     AND (p.extra_fields->'data_integrity_review'->>'ok') = 'false' THEN
    INSERT INTO listing_correction_195_backup (property_id, inquiry_reference, before_row) VALUES (p.id, p.inquiry_reference, to_jsonb(p));
    resolved := jsonb_build_object('ok', true, 'issues', '[]'::jsonb, 'issue_codes', '[]'::jsonb,
      'resolved_issues', COALESCE(p.extra_fields->'data_integrity_review'->'issues', '[]'::jsonb),
      'resolved_at', NOW(), 'resolved_by', 'migration_195_arthur_approved');
    UPDATE properties SET
      extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object(
        'data_integrity_review', COALESCE(extra_fields->'data_integrity_review', '{}'::jsonb) || resolved,
        'data_integrity_issue_codes', '[]'::jsonb,
        'listing_correction_195', jsonb_build_object('applied_at', NOW(), 'fix', 'resolved_stale_review')),
      updated_at = NOW()
     WHERE id = p.id;
  ELSE
    RAISE NOTICE 'listing_correction_195 skipped 19F6B4 guard';
  END IF;
END;
$correction$;
