-- Clear a mixed-use bedroom count and move one Kigo pin off Hoima.
--
-- 173 and 174 are already used. This file is 175.
--
-- Two rows, each guarded on the facts that were still true on the public API
-- on 24 Oct 2026. A row that no longer matches is left alone and logged.
-- A second run finds the target state and logs skipped. Idempotent.
--
-- 1. Seeta 496006a9-d203-437c-a722-d99fe7d8df03.
--    Migration 172 retitled it to "Mixed-use building for sale in Seeta" and
--    kept bedrooms at 3, because the caption says each residential unit is a
--    3-bedroom, not that the building has 3 bedrooms. Now that the stored
--    title or property type is mixed-use, this migration sets properties.bedrooms
--    to NULL and removes bedroom keys from extra_fields, only while the column
--    is still 3 (or already NULL with a leftover bedroom key). A different
--    bedroom count, or a title that is no longer mixed-use, is not touched.
--    Bedroom keys are names that contain bedroom, or beds as its own word
--    (bedrooms, bedroom, beds, source_bedrooms, bedroom_count). Bathrooms and
--    unrelated keys such as oembed stay.
--
-- 2. Kigo b1014d2d-ec8c-4127-b898-0207a573e959.
--    The public area, neighbourhood and canonical location are Kigo
--    (wakiso:kigo). The pin is the Hoima district centroid, about 1.434, 31.352,
--    which is far outside Kigo. Migration 171 left this id out: the 24 Oct pin
--    audit treated the Hoima pin as the place named in the title ("Land in
--    Hoima") and did not move it. This migration moves only this id, and only
--    while the stored pin is still that Hoima point and the row is still
--    labelled Kigo, to the Kigo centroid migration 171 and the registry use:
--    0.2052, 32.5967. The title, area and price are not written.
--
-- Each applied row is copied to listing_correction_175_backup and stamped
-- extra_fields.listing_correction_175. One NOTICE per id.
-- Uganda only (app.country_code = UG).
-- Manual rollback: scripts/rollback-175-listing-corrections.sql
-- That file is not a migration and does not run on deploy.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL client_min_messages = NOTICE;

CREATE TABLE IF NOT EXISTS listing_correction_175_backup (
  property_id UUID PRIMARY KEY,
  action TEXT NOT NULL,
  before_row JSONB NOT NULL,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $do_175$
DECLARE
  seeta_id uuid := '496006a9-d203-437c-a722-d99fe7d8df03';
  kigo_id uuid := 'b1014d2d-ec8c-4127-b898-0207a573e959';
  kigo_lat numeric := 0.2052;
  kigo_lng numeric := 32.5967;
  hoima_lat numeric := 1.434;
  hoima_lng numeric := 31.352;
  p properties%ROWTYPE;
  v_now timestamptz;
  bedroom_keys int;
  mixed_use boolean;
  labelled_kigo boolean;
  at_kigo boolean;
  at_hoima boolean;
  changed int;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'listing_correction_175 % skipped country_not_ug', seeta_id;
    RAISE NOTICE 'listing_correction_175 % skipped country_not_ug', kigo_id;
    RETURN;
  END IF;

  SELECT * INTO p FROM properties WHERE id = seeta_id;
  IF NOT FOUND OR lower(btrim(coalesce(p.status, ''))) IN ('deleted', 'purged') THEN
    RAISE NOTICE 'listing_correction_175 % skipped missing', seeta_id;
  ELSE
    SELECT count(*)::int INTO bedroom_keys
    FROM jsonb_each(COALESCE(p.extra_fields, '{}'::jsonb)) AS e(key, value)
    WHERE e.key ~* '(^|_)(bedrooms?|beds)($|_)';

    mixed_use := lower(coalesce(p.property_type, '')) LIKE '%mixed-use%'
      OR lower(coalesce(p.property_type, '')) LIKE '%mixed use%'
      OR lower(coalesce(p.title, '')) LIKE '%mixed-use%'
      OR lower(coalesce(p.title, '')) LIKE '%mixed use%';

    IF p.bedrooms IS NOT NULL AND p.bedrooms IS DISTINCT FROM 3 THEN
      RAISE NOTICE 'listing_correction_175 % skipped bedrooms_not_3', seeta_id;
    ELSIF NOT mixed_use THEN
      RAISE NOTICE 'listing_correction_175 % skipped not_mixed_use', seeta_id;
    ELSIF p.bedrooms IS NULL AND bedroom_keys = 0 THEN
      RAISE NOTICE 'listing_correction_175 % skipped already_clear', seeta_id;
    ELSE
      v_now := clock_timestamp();
      INSERT INTO listing_correction_175_backup (property_id, action, before_row)
      VALUES (p.id, 'clear_bedrooms', to_jsonb(p))
      ON CONFLICT (property_id) DO NOTHING;

      UPDATE properties AS target
      SET
        bedrooms = NULL,
        extra_fields = (
          SELECT COALESCE(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
          FROM jsonb_each(COALESCE(target.extra_fields, '{}'::jsonb)) AS e(key, value)
          WHERE e.key !~* '(^|_)(bedrooms?|beds)($|_)'
        ) || jsonb_build_object(
          'listing_correction_175', jsonb_build_object(
            'action', 'clear_bedrooms',
            'applied_at', v_now
          )
        ),
        updated_at = v_now
      WHERE target.id = p.id
        AND (target.bedrooms IS NOT DISTINCT FROM 3 OR target.bedrooms IS NULL);

      GET DIAGNOSTICS changed = ROW_COUNT;
      IF changed = 0 THEN
        RAISE NOTICE 'listing_correction_175 % skipped bedrooms_not_3', seeta_id;
      ELSE
        RAISE NOTICE 'listing_correction_175 % applied clear_bedrooms', seeta_id;
      END IF;
    END IF;
  END IF;

  SELECT * INTO p FROM properties WHERE id = kigo_id;
  IF NOT FOUND OR lower(btrim(coalesce(p.status, ''))) IN ('deleted', 'purged') THEN
    RAISE NOTICE 'listing_correction_175 % skipped missing', kigo_id;
  ELSE
    at_kigo := p.latitude IS NOT NULL
      AND p.longitude IS NOT NULL
      AND abs(p.latitude - kigo_lat) <= 0.0000005
      AND abs(p.longitude - kigo_lng) <= 0.0000005;
    at_hoima := p.latitude IS NOT NULL
      AND p.longitude IS NOT NULL
      AND abs(p.latitude - hoima_lat) <= 0.0005
      AND abs(p.longitude - hoima_lng) <= 0.0005;
    labelled_kigo := lower(btrim(coalesce(p.area, ''))) = 'kigo'
      OR coalesce(p.extra_fields->>'canonical_location_id', '') = 'wakiso:kigo'
      OR lower(btrim(coalesce(p.extra_fields->>'neighborhood', ''))) = 'kigo';

    IF at_kigo THEN
      RAISE NOTICE 'listing_correction_175 % skipped already_at_kigo', kigo_id;
    ELSIF NOT labelled_kigo THEN
      RAISE NOTICE 'listing_correction_175 % skipped not_labelled_kigo', kigo_id;
    ELSIF NOT at_hoima THEN
      RAISE NOTICE 'listing_correction_175 % skipped pin_changed', kigo_id;
    ELSE
      v_now := clock_timestamp();
      INSERT INTO listing_correction_175_backup (property_id, action, before_row)
      VALUES (p.id, 'move_pin', to_jsonb(p))
      ON CONFLICT (property_id) DO NOTHING;

      UPDATE properties AS target
      SET
        latitude = kigo_lat,
        longitude = kigo_lng,
        extra_fields = COALESCE(target.extra_fields, '{}'::jsonb) || jsonb_build_object(
          'listing_correction_175', jsonb_build_object(
            'action', 'move_pin',
            'applied_at', v_now,
            'old_latitude', target.latitude,
            'old_longitude', target.longitude,
            'new_latitude', kigo_lat,
            'new_longitude', kigo_lng
          )
        ),
        updated_at = v_now
      WHERE target.id = p.id
        AND abs(target.latitude - hoima_lat) <= 0.0005
        AND abs(target.longitude - hoima_lng) <= 0.0005;

      GET DIAGNOSTICS changed = ROW_COUNT;
      IF changed = 0 THEN
        RAISE NOTICE 'listing_correction_175 % skipped pin_changed', kigo_id;
      ELSE
        RAISE NOTICE 'listing_correction_175 % applied move_pin', kigo_id;
      END IF;
    END IF;
  END IF;
END
$do_175$;
