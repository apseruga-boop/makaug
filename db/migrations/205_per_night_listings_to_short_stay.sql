-- Move the 4 approved per-night listings from properties to short stay (st_listing).
-- Approved by Arthur on 4 Nov 2026 (07:06 widget approval; 08:08 decisions).
--
-- * The two Kisaasi UGX 400k/night rows are duplicates (same agent, same
--   video tour, same price). The older, longer one (MK-20261013-C57C88) is
--   kept; the newer one (MK-20261014-F0A954) is merged into it: its property
--   type, video and its different phone number (kept as a non-public
--   alt_host_phone in extra_fields) are carried over. Result: 3 short stays.
-- * Contact details, photos and nightly price are copied DB-to-DB; no phone
--   number appears in this file.
-- * KING SIGN-OFF OVERRIDE: migration 132 says a migration must not make a
--   short stay live by setting king_facts_confirmed. Arthur explicitly
--   approved doing so for exactly these moved rows (4 Nov 08:08), so they show
--   straight away. Fee is marked waived. This applies only to these rows.
-- * The old properties rows are archived (not deleted); /property/<id>
--   redirects to the new /short-term/<slug> via extra_fields.moved_from_property_ids.
-- Backup: per_night_short_stay_205_backup. Rollback:
-- scripts/rollback-205-per-night-listings-to-short-stay.sql
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS per_night_short_stay_205_backup (
  property_id uuid PRIMARY KEY,
  inquiry_reference text NOT NULL,
  role text NOT NULL,
  st_listing_id uuid,
  before_row jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT NOW(),
  rolled_back_at timestamptz
);

DO $move$
DECLARE
  r record;
  p properties%ROWTYPE;
  dup properties%ROWTYPE;
  ref text;
  new_id uuid;
  new_slug text;
  phone text;
  alt_phone text;
  videos jsonb;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'per_night_205 skipped country_not_ug';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM per_night_short_stay_205_backup) THEN
    RAISE NOTICE 'per_night_205 skipped already_recorded';
    RETURN;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      ('e47c491e-0954-4ca3-8119-17ce8cfbcae4'::uuid, 'fa0290bd-532b-4263-be1a-0cc8465f68e3'::uuid, 'kisaasi-short-stay'),
      ('ad90c43d-211f-4f4f-b66b-0ac87765e510'::uuid, NULL::uuid, 'bunga-one-bedroom-stay'),
      ('1437befb-895e-4d30-b8d9-9776c21a6b8e'::uuid, NULL::uuid, 'mutungo-apartment-stay')
    ) AS v(keep_id, dup_id, slug_base)
  LOOP
    SELECT * INTO p FROM properties
     WHERE id = r.keep_id AND status = 'approved' AND price_period = 'night' FOR UPDATE;
    IF p.id IS NULL THEN
      RAISE NOTICE 'per_night_205 % skipped not_approved_per_night', r.keep_id;
      CONTINUE;
    END IF;
    dup := NULL;
    IF r.dup_id IS NOT NULL THEN
      SELECT * INTO dup FROM properties
       WHERE id = r.dup_id AND status = 'approved' AND price_period = 'night' FOR UPDATE;
    END IF;

    phone := COALESCE(NULLIF(btrim(p.lister_phone), ''), NULLIF(btrim(p.extra_fields->>'contact_phone'), ''),
                      NULLIF(btrim(dup.lister_phone), ''));
    IF phone IS NULL THEN
      RAISE NOTICE 'per_night_205 % skipped no_phone', p.inquiry_reference;
      CONTINUE;
    END IF;
    alt_phone := NULLIF(btrim(dup.lister_phone), '');
    IF alt_phone = phone THEN alt_phone := NULL; END IF;
    videos := COALESCE(p.extra_fields->'video_urls', '[]'::jsonb);
    IF dup.id IS NOT NULL AND jsonb_typeof(dup.extra_fields->'video_urls') = 'array' THEN
      videos := videos || (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb)
                             FROM jsonb_array_elements(dup.extra_fields->'video_urls') x
                            WHERE NOT videos @> jsonb_build_array(x));
    END IF;

    ref := 'ST-' || lpad(nextval('st_listing_reference_seq')::text, 6, '0');
    new_slug := r.slug_base || '-' || lower(ref);

    INSERT INTO st_listing (
      reference, slug, title, description, district, area, address, latitude, longitude,
      place_type, property_type, bedrooms, beds, bathrooms, max_guests,
      base_nightly_ugx, host_name, host_phone, host_type,
      status, reviewed_at, moderation_stage, moderation_notes,
      king_reviewed_by, king_reviewed_at, king_facts_confirmed,
      listing_fee_ugx, listing_fee_status, listed_at, expires_at,
      source, extra_fields, created_at, updated_at
    ) VALUES (
      ref, new_slug, p.title, COALESCE(NULLIF(p.description, ''), p.title),
      p.district, COALESCE(NULLIF(p.area, ''), p.district), p.address, p.latitude, p.longitude,
      'entire_place', COALESCE(p.property_type, dup.property_type),
      GREATEST(COALESCE(p.bedrooms, 1), 1), GREATEST(COALESCE(p.bedrooms, 1), 1),
      GREATEST(COALESCE(p.bathrooms, 1), 1), 2,
      p.price, COALESCE(NULLIF(p.lister_name, ''), 'Host'), phone,
      CASE WHEN p.lister_type IN ('owner','manager','agent') THEN p.lister_type ELSE 'agent' END,
      'approved', NOW(), 'approved',
      'Moved from properties by migration 205 (Arthur approval 4 Nov 2026).',
      'Arthur (migration 205, approved 4 Nov 2026 08:08)', NOW(), TRUE,
      0, 'waived', NOW(), NULL,
      'imported',
      jsonb_strip_nulls(jsonb_build_object(
        'migration_205', true,
        'moved_from_property_ids', to_jsonb(array_remove(ARRAY[p.id::text, dup.id::text], NULL)),
        'moved_from_references', to_jsonb(array_remove(ARRAY[p.inquiry_reference, dup.inquiry_reference], NULL)),
        'source_platform', p.extra_fields->>'source_platform',
        'source_url', p.extra_fields->>'source_url',
        'video_urls', CASE WHEN jsonb_array_length(videos) > 0 THEN videos END,
        'alt_host_phone', alt_phone
      )),
      p.created_at, NOW()
    ) RETURNING id INTO new_id;

    INSERT INTO st_listing_media (listing_id, url, is_primary, sort_order)
    SELECT new_id, m.url, (m.rn = 1), m.rn - 1
      FROM (SELECT url, row_number() OVER (ORDER BY is_primary DESC, owner_rank, url) rn
              FROM (SELECT DISTINCT ON (i.url) i.url, i.is_primary, CASE WHEN i.property_id = p.id THEN 0 ELSE 1 END owner_rank
                      FROM property_images i
                     WHERE i.property_id = p.id OR i.property_id = dup.id
                     ORDER BY i.url, (i.property_id = p.id) DESC) d) m;

    INSERT INTO per_night_short_stay_205_backup (property_id, inquiry_reference, role, st_listing_id, before_row)
      VALUES (p.id, p.inquiry_reference, 'moved', new_id, to_jsonb(p));
    UPDATE properties SET status = 'archived',
      extra_fields = extra_fields || jsonb_build_object('moved_to_short_stay_slug', new_slug, 'migration_205', true),
      updated_at = NOW()
     WHERE id = p.id;

    IF dup.id IS NOT NULL THEN
      INSERT INTO per_night_short_stay_205_backup (property_id, inquiry_reference, role, st_listing_id, before_row)
        VALUES (dup.id, dup.inquiry_reference, 'merged_duplicate', new_id, to_jsonb(dup));
      UPDATE properties SET status = 'archived',
        extra_fields = extra_fields || jsonb_build_object('moved_to_short_stay_slug', new_slug, 'migration_205', true),
        updated_at = NOW()
       WHERE id = dup.id;
    END IF;
    RAISE NOTICE 'per_night_205 % -> %', p.inquiry_reference, ref;
  END LOOP;
END
$move$;
